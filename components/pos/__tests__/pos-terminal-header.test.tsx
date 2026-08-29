// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { PosTerminal } from "@/components/pos/pos-terminal"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `$${n}`, pais: "AR", timezone: "America/Argentina/Buenos_Aires" }),
}))
vi.mock("@/contexts/modal-context", () => ({
  useModal: () => ({ confirm: vi.fn(), showSuccess: vi.fn(), showError: vi.fn() }),
}))
vi.mock("@/contexts/offline-context", () => ({
  useOffline: () => ({ isOnline: true }),
}))

// Cada hijo pesado se reemplaza por un stub mínimo: lo que estos tests
// verifican vive en pos-terminal.tsx (el shell), no en el contenido real de
// estos componentes.
vi.mock("@/components/pos/pos-product-search", async () => {
  const { forwardRef, useImperativeHandle } = await import("react")
  return {
    PosProductSearch: forwardRef((props: any, ref: any) => {
      useImperativeHandle(ref, () => ({ focusSearch: () => {} }))
      return (
        <div>
          <button
            type="button"
            onClick={() =>
              props.onAddProduct({ id: "p1", codigo: "C1", nombre: "Mouse", stock: 5, precioVenta: 100 })
            }
          >
            mock-add-product
          </button>
          <button type="button" onClick={props.onOpenScanner}>
            mock-open-scanner
          </button>
        </div>
      )
    }),
  }
})
vi.mock("@/components/pos/pos-cart", () => ({
  PosCart: (props: any) => <div data-testid="mock-cart">items:{props.items.length}</div>,
}))
vi.mock("@/components/pos/pos-checkout-dialog", () => ({
  PosCheckoutDialog: (props: any) => (
    <button
      type="button"
      onClick={() =>
        props.onComplete({ numeroVenta: 42, total: 1000, clienteNombre: "", items: [] })
      }
    >
      mock-complete-venta
    </button>
  ),
}))
vi.mock("@/components/pos/pos-held-sales", () => ({ PosHeldSales: () => null }))
vi.mock("@/components/pos/pos-ticket-share", () => ({ PosTicketShare: () => null }))
vi.mock("@/components/pos/pos-devolucion-search", () => ({ PosDevolucionSearch: () => null }))
vi.mock("@/components/ventas/devolucion-form", () => ({ DevolucionForm: () => null }))
vi.mock("@/components/inventario/barcode-scanner", () => ({ BarcodeScanner: () => null }))

function stubFetch() {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }))
}

// useThermalPrinter sólo detecta el botón de impresora si `navigator.usb`
// existe (isSupported). Se fuerza acá para poder llegar a ese botón.
function stubUsb() {
  Object.defineProperty(window.navigator, "usb", {
    value: {
      getDevices: vi.fn().mockResolvedValue([]),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      requestDevice: vi.fn(),
    },
    configurable: true,
  })
}

describe("PosTerminal — atajos bloqueados con el scanner de código de barras abierto", () => {
  beforeEach(() => {
    stubFetch()
  })

  it("F2 sí limpia el carrito cuando el scanner está cerrado (control)", () => {
    render(<PosTerminal />)
    fireEvent.click(screen.getAllByRole("button", { name: "mock-add-product" })[0])
    expect(screen.getAllByTestId("mock-cart")[0]).toHaveTextContent("items:1")

    fireEvent.keyDown(document.body, { key: "F2" })

    expect(screen.getAllByTestId("mock-cart")[0]).toHaveTextContent("items:0")
  })

  it("F2 NO limpia el carrito mientras el scanner de código de barras está abierto", () => {
    render(<PosTerminal />)
    fireEvent.click(screen.getAllByRole("button", { name: "mock-add-product" })[0])
    expect(screen.getAllByTestId("mock-cart")[0]).toHaveTextContent("items:1")

    fireEvent.click(screen.getAllByRole("button", { name: "mock-open-scanner" })[0])
    fireEvent.keyDown(document.body, { key: "F2" })

    expect(screen.getAllByTestId("mock-cart")[0]).toHaveTextContent("items:1")
  })
})

describe("PosTerminal — botones del header con aria-label en mobile", () => {
  beforeEach(() => {
    stubFetch()
    stubUsb()
  })

  it("Salir, Impresora, Reimprimir y Devolución son alcanzables por su etiqueta accesible", async () => {
    render(<PosTerminal />)

    // Reimprimir sólo aparece tras una venta completada.
    fireEvent.click(await screen.findByRole("button", { name: "mock-complete-venta" }))

    expect(screen.getByLabelText("Salir")).toBeInTheDocument()
    expect(screen.getByLabelText("Impresora")).toBeInTheDocument()
    expect(screen.getByLabelText("Reimprimir")).toBeInTheDocument()
    expect(screen.getByLabelText("Devolución")).toBeInTheDocument()
  })
})
