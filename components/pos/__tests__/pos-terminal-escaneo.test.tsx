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
vi.mock("@/contexts/modal-context", () => ({
  useModal: () => ({ confirm: vi.fn(), showSuccess: vi.fn(), showError }),
}))
vi.mock("@/contexts/offline-context", () => ({
  useOffline: () => ({ isOnline: true }),
}))
vi.mock("@/components/pos/pos-product-search", async () => {
  const { forwardRef, useImperativeHandle } = await import("react")
  return {
    PosProductSearch: forwardRef((_props: any, ref: any) => {
      useImperativeHandle(ref, () => ({ focusSearch: () => {} }))
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

function stubFetch(item: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.startsWith("/api/inventario/barcode")) return { ok: true, json: async () => ({ found: true, item }) }
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
  beforeEach(() => showError.mockClear())

  it("un producto con número de serie entra con series y la garantía del producto", async () => {
    stubFetch({ id: "p1", codigo: "C1", nombre: "Celular", stock: 3, precioVenta: 1000, trackeaSeries: true, diasGarantiaDefault: 90 })
    render(<PosTerminal />)

    escanear("779123")

    await waitFor(() => expect(itemsDelCarrito()).toHaveLength(1))
    expect(itemsDelCarrito()[0]).toMatchObject({ inventarioId: "p1", trackeaSeries: true, diasGarantia: 90 })
  })

  it("avisa cuando ya no hay más stock en vez de mostrar 'agregado'", async () => {
    stubFetch({ id: "p2", codigo: "C2", nombre: "Cable", stock: 1, precioVenta: 50 })
    render(<PosTerminal />)

    escanear("779124")
    await waitFor(() => expect(itemsDelCarrito()[0]?.cantidad).toBe(1))
    escanear("779124")

    await waitFor(() => expect(showError).toHaveBeenCalledWith(expect.stringMatching(/No hay más stock de "Cable"/)))
    expect(itemsDelCarrito()[0].cantidad).toBe(1)
  })

  it("un vendedor no ve el botón de devolución (la API lo rechaza)", () => {
    stubFetch({})
    render(<PosTerminal />)
    expect(screen.queryByRole("button", { name: /devolución/i })).not.toBeInTheDocument()
  })
})
