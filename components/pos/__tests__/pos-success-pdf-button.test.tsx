// @vitest-environment jsdom
/**
 * Cubre el boton "PDF" agregado al modal de venta exitosa del POS (paridad
 * con lo que ya tiene orden-detail.tsx). Sigue el mismo patron de mounting
 * que pos-terminal-header.test.tsx: PosTerminal completo con los hijos
 * pesados stubbeados, disparando la venta via el pos-checkout-dialog mock.
 *
 * Fix 2 (review): window.open(url, "_blank") corría DESPUÉS de dos await
 * (fetch + res.blob()), lo que en Safari/WebKit (y Chrome fuera de su
 * ventana corta de activación) bloquea el popup en silencio — mismo
 * problema que printTicketHTML. Además createObjectURL nunca se
 * emparejaba con revokeObjectURL (fuga por turno de caja largo). Estos
 * tests pinean: la pestaña se abre de forma síncrona ANTES del fetch, se
 * navega al blob una vez listo, se avisa con showError si el popup queda
 * bloqueado, y el object URL se libera.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { PosTerminal } from "@/components/pos/pos-terminal"

const { showErrorMock } = vi.hoisted(() => ({
  showErrorMock: vi.fn().mockResolvedValue(undefined),
}))

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
  useModal: () => ({ confirm: vi.fn(), showSuccess: vi.fn(), showError: showErrorMock }),
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

function createFakePdfWindow() {
  return {
    location: { href: "" },
    close: vi.fn(),
  }
}

async function completarVenta() {
  render(<PosTerminal />)
  fireEvent.click(await screen.findByRole("button", { name: "mock-complete-venta" }))
}

describe("PosTerminal — boton PDF en el modal de venta exitosa", () => {
  let fakePdfWindow: ReturnType<typeof createFakePdfWindow>
  let revokeObjectURLMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fakePdfWindow = createFakePdfWindow()
    vi.stubGlobal("open", vi.fn().mockReturnValue(fakePdfWindow))
    Object.defineProperty(window.URL, "createObjectURL", {
      value: vi.fn().mockReturnValue("blob:fake-url"),
      writable: true,
      configurable: true,
    })
    revokeObjectURLMock = vi.fn()
    Object.defineProperty(window.URL, "revokeObjectURL", {
      value: revokeObjectURLMock,
      writable: true,
      configurable: true,
    })
    showErrorMock.mockClear()
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

  it("abre la pestana ANTES del fetch y navega al blob una vez listo", async () => {
    const fetchMock = stubFetchPdf()
    await completarVenta()

    fireEvent.click(await screen.findByRole("button", { name: /^pdf$/i }))

    // La pestaña se abre de forma síncrona con el click, sin esperar al
    // fetch: si esto regresa a abrir después de un await, este assert falla.
    expect(window.open).toHaveBeenCalledWith("", "_blank")

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/ventas/venta-1/pdf")
    })
    await waitFor(() => {
      expect(fakePdfWindow.location.href).toBe("blob:fake-url")
    })
  })

  it("libera el object URL del blob una vez que la pestaña tuvo tiempo de cargarlo", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      stubFetchPdf()
      await completarVenta()

      fireEvent.click(await screen.findByRole("button", { name: /^pdf$/i }))

      await vi.waitFor(() => expect(fakePdfWindow.location.href).toBe("blob:fake-url"))
      expect(revokeObjectURLMock).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(60_000)
      expect(revokeObjectURLMock).toHaveBeenCalledWith("blob:fake-url")
    } finally {
      vi.useRealTimers()
    }
  })

  it("si el popup queda bloqueado (window.open devuelve null) avisa con showError y no llega a pedir el PDF", async () => {
    const fetchMock = stubFetchPdf()
    vi.stubGlobal("open", vi.fn().mockReturnValue(null))
    await completarVenta()

    fireEvent.click(await screen.findByRole("button", { name: /^pdf$/i }))

    await waitFor(() => expect(showErrorMock).toHaveBeenCalledTimes(1))
    expect(showErrorMock.mock.calls[0][0]).toMatch(/bloque/i)
    expect(fetchMock).not.toHaveBeenCalledWith("/api/ventas/venta-1/pdf")
  })
})
