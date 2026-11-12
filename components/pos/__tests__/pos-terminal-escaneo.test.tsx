// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { PosTerminal } from "@/components/pos/pos-terminal"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "u1", role: "VENDEDOR" } } }),
}))
vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `$${n}`, pais: "AR", timezone: "America/Argentina/Buenos_Aires" }),
}))
const showError = vi.fn().mockResolvedValue(undefined)
const confirm = vi.fn()
vi.mock("@/contexts/modal-context", () => ({
  useModal: () => ({ confirm, showSuccess: vi.fn(), showError }),
}))
const toastError = vi.fn()
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a) } }))
const openManual = vi.fn()
vi.mock("@/contexts/offline-context", () => ({
  useOffline: () => ({ isOnline: true }),
}))
vi.mock("@/components/pos/pos-product-search", async () => {
  const { forwardRef, useImperativeHandle } = await import("react")
  return {
    PosProductSearch: forwardRef((_props: any, ref: any) => {
      useImperativeHandle(ref, () => ({ focusSearch: () => {}, openManual }))
      return null
    }),
  }
})
// El carrito muestra lo que recibe para poder inspeccionar los items
vi.mock("@/components/pos/pos-cart", () => ({
  PosCart: (props: any) => <pre data-testid="cart">{JSON.stringify(props.items)}</pre>,
}))
vi.mock("@/components/pos/pos-checkout-dialog", () => ({ PosCheckoutDialog: () => null }))
vi.mock("@/components/pos/pos-held-sales", () => ({ PosHeldSales: () => null }))
vi.mock("@/components/pos/pos-ticket-share", () => ({ PosTicketShare: () => null }))
vi.mock("@/components/pos/pos-devolucion-search", () => ({ PosDevolucionSearch: () => null }))
vi.mock("@/components/ventas/devolucion-form", () => ({ DevolucionForm: () => null }))
vi.mock("@/components/inventario/barcode-scanner", () => ({ BarcodeScanner: () => null }))

function stubFetch(item: Record<string, unknown>, barcode: { ok: boolean; found?: boolean } = { ok: true, found: true }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.startsWith("/api/inventario/barcode")) {
        return { ok: barcode.ok, json: async () => (barcode.found ? { found: true, item } : { found: false }) }
      }
      return { ok: false, json: async () => ({}) }
    })
  )
}

// Como un lector real: las teclas salen del documento (no de un input) y
// suben hasta los listeners de window.
function escanear(codigo: string) {
  for (const ch of codigo) fireEvent.keyDown(document.body, { key: ch, code: `Digit${ch}` })
  fireEvent.keyDown(document.body, { key: "Enter", code: "Enter" })
}

function itemsDelCarrito(): any[] {
  return JSON.parse(screen.getAllByTestId("cart")[0].textContent || "[]")
}

describe("PosTerminal — escaneo de código de barras", () => {
  beforeEach(() => {
    showError.mockClear()
    toastError.mockClear()
    confirm.mockReset()
    openManual.mockClear()
  })

  it("un producto con número de serie entra con series y la garantía del producto", async () => {
    stubFetch({ id: "p1", codigo: "C1", nombre: "Celular", stock: 3, precioVenta: 1000, trackeaSeries: true, diasGarantiaDefault: 90 })
    render(<PosTerminal />)

    escanear("779123")

    await waitFor(() => expect(itemsDelCarrito()).toHaveLength(1))
    expect(itemsDelCarrito()[0]).toMatchObject({ inventarioId: "p1", trackeaSeries: true, diasGarantia: 90 })
  })

  it("escanear una variante la agrega a ella, con su nombre completo, sin abrir la hoja de variantes", async () => {
    stubFetch({
      id: "azul", codigo: "FX-AZ", nombre: "Funda X - Azul", stock: 4, precioVenta: 12000,
      grupoId: "g-1", etiqueta: "Azul", grupoNombre: "Funda X",
    })
    render(<PosTerminal />)

    escanear("7790001")

    await waitFor(() => expect(itemsDelCarrito()).toHaveLength(1))
    expect(itemsDelCarrito()[0]).toMatchObject({ inventarioId: "azul", nombre: "Funda X - Azul", precioUnitario: 12000, cantidad: 1 })
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("avisa con un toast (no un modal) cuando ya no hay más stock", async () => {
    stubFetch({ id: "p2", codigo: "C2", nombre: "Cable", stock: 1, precioVenta: 50 })
    render(<PosTerminal />)

    escanear("779124")
    await waitFor(() => expect(itemsDelCarrito()[0]?.cantidad).toBe(1))
    escanear("779124")

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/No hay más stock de "Cable"/), expect.anything()))
    expect(showError).not.toHaveBeenCalled()
    expect(itemsDelCarrito()[0].cantidad).toBe(1)
  })

  it("un código desconocido avisa con un toast que ofrece venta manual", async () => {
    stubFetch({}, { ok: true, found: false })
    render(<PosTerminal />)

    escanear("000111")

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    const [mensaje, opciones] = toastError.mock.calls[0]
    expect(mensaje).toMatch(/000111 no está en el inventario/)
    expect(showError).not.toHaveBeenCalled()
    expect(opciones.action.label).toBe("Venta manual")
    opciones.action.onClick()
    expect(openManual).toHaveBeenCalled()
  })

  it("un error del servidor al buscar el código ya no se traga en silencio", async () => {
    stubFetch({}, { ok: false })
    render(<PosTerminal />)

    escanear("000222")

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/No se pudo buscar el código 000222/), expect.anything()))
    expect(showError).not.toHaveBeenCalled()
  })

  it("F2 con productos en el carrito pide confirmación y, si se cancela, no vacía", async () => {
    stubFetch({ id: "p1", codigo: "C1", nombre: "Funda", stock: 3, precioVenta: 1000 })
    confirm.mockResolvedValue(false)
    render(<PosTerminal />)
    escanear("779125")
    await waitFor(() => expect(itemsDelCarrito()).toHaveLength(1))

    fireEvent.keyDown(document.body, { key: "F2" })

    await waitFor(() => expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ variant: "danger" })))
    expect(itemsDelCarrito()).toHaveLength(1)
  })

  it("F2 vacía el carrito si se confirma", async () => {
    stubFetch({ id: "p1", codigo: "C1", nombre: "Funda", stock: 3, precioVenta: 1000 })
    confirm.mockResolvedValue(true)
    render(<PosTerminal />)
    escanear("779126")
    await waitFor(() => expect(itemsDelCarrito()).toHaveLength(1))

    fireEvent.keyDown(document.body, { key: "F2" })

    await waitFor(() => expect(itemsDelCarrito()).toHaveLength(0))
  })

  it("F2 con el carrito vacío no pregunta", () => {
    stubFetch({})
    render(<PosTerminal />)
    fireEvent.keyDown(document.body, { key: "F2" })
    expect(confirm).not.toHaveBeenCalled()
  })

  it("un vendedor no ve el botón de devolución (la API lo rechaza)", () => {
    stubFetch({})
    render(<PosTerminal />)
    expect(screen.queryByRole("button", { name: /devolución/i })).not.toBeInTheDocument()
  })
})
