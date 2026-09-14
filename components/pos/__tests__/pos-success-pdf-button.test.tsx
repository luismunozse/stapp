// @vitest-environment jsdom
/**
 * Cubre el boton "PDF" agregado al modal de venta exitosa del POS (paridad
 * con lo que ya tiene orden-detail.tsx). Sigue el mismo patron de mounting
 * que pos-terminal-header.test.tsx: PosTerminal completo con los hijos
 * pesados stubbeados, disparando la venta via el pos-checkout-dialog mock.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { PosTerminal } from "@/components/pos/pos-terminal"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({
    formatPrice: (n: number) => `$${n}`,
    pais: "AR",
    timezone: "America/Argentina/Buenos_Aires",
  }),
}))
vi.mock("@/contexts/modal-context", () => ({
  useModal: () => ({ confirm: vi.fn(), showSuccess: vi.fn(), showError: vi.fn() }),
}))
vi.mock("@/contexts/offline-context", () => ({
  useOffline: () => ({ isOnline: true }),
}))

vi.mock("@/components/pos/pos-product-search", async () => {
  const { forwardRef, useImperativeHandle } = await import("react")
  return {
    PosProductSearch: forwardRef((_props: any, ref: any) => {
      useImperativeHandle(ref, () => ({ focusSearch: () => {} }))
      return <div />
    }),
  }
})
vi.mock("@/components/pos/pos-cart", () => ({
  PosCart: () => <div data-testid="mock-cart" />,
}))
vi.mock("@/components/pos/pos-checkout-dialog", () => ({
  PosCheckoutDialog: (props: any) => (
    <button
      type="button"
      onClick={() =>
        props.onComplete({ id: "venta-1", numeroVenta: 42, total: 1000, clienteNombre: "", items: [] })
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

function stubFetchPdf(ok = true) {
  const blob = new Blob(["fake-pdf"], { type: "application/pdf" })
  const fetchMock = vi.fn().mockImplementation((url: any) => {
    if (typeof url === "string" && url.includes("/pdf")) {
      return Promise.resolve({ ok, blob: async () => blob })
    }
    return Promise.resolve({ ok: false, json: async () => ({}) })
  })
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

async function completarVenta() {
  render(<PosTerminal />)
  fireEvent.click(await screen.findByRole("button", { name: "mock-complete-venta" }))
}

describe("PosTerminal — boton PDF en el modal de venta exitosa", () => {
  beforeEach(() => {
    vi.stubGlobal("open", vi.fn())
    Object.defineProperty(window.URL, "createObjectURL", {
      value: vi.fn().mockReturnValue("blob:fake-url"),
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("aparece junto a los botones de impresion tras completar la venta", async () => {
    stubFetchPdf()
    await completarVenta()

    expect(await screen.findByRole("button", { name: /^pdf$/i })).toBeInTheDocument()
  })

  it("al hacer click pide /api/ventas/{id}/pdf y abre el blob en una pestana nueva", async () => {
    const fetchMock = stubFetchPdf()
    await completarVenta()

    fireEvent.click(await screen.findByRole("button", { name: /^pdf$/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/ventas/venta-1/pdf")
    })
    await waitFor(() => {
      expect(window.open).toHaveBeenCalledWith("blob:fake-url", "_blank")
    })
  })
})
