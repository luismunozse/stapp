// @vitest-environment jsdom
/**
 * Cubre las dos invariantes de seguridad sobre las que se apoya el logo del
 * ticket POS (ninguna existía antes de este branch):
 *
 *  1. Un logo que falla (rechaza o resuelve null) NUNCA debe frenar una
 *     venta: ni la impresión térmica (printTicket) ni el fallback por
 *     navegador (printTicketHTML) deben abortar.
 *  2. printTicketHTML debe abrir la ventana de impresión ANTES de esperar el
 *     helper del logo (regresión de popup bloqueado en Safari/iPad — la
 *     población que más depende de este fallback) y avisar en vez de fallar
 *     en silencio cuando el popup queda bloqueado.
 *
 * También pinea que printTicket lee el printerWidth ACTUAL (no uno stale de
 * cuando se montó el callback) al rasterizar el logo.
 *
 * Sigue el mismo patrón de mounting que pos-terminal-header.test.tsx y
 * pos-success-pdf-button.test.tsx: PosTerminal completo con los hijos
 * pesados stubbeados, disparando la venta vía el mock de pos-checkout-dialog.
 * imageUrlToRaster/imageUrlToBinarizedDataUrl son funciones exportadas
 * planas de lib/escpos-image.ts — mockearlas alcanza, no hace falta mockear
 * canvas ni Image.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { PosTerminal } from "@/components/pos/pos-terminal"
import { imageUrlToRaster, imageUrlToBinarizedDataUrl } from "@/lib/escpos-image"

const { printerState, mockPrint, showErrorMock } = vi.hoisted(() => {
  const mockPrint = vi.fn().mockResolvedValue(true)
  // Objeto único y mutable: la referencia se mantiene ESTABLE entre renders
  // (a diferencia del hook real, que devuelve un objeto literal nuevo en
  // cada render vía `{...state, ...}`). Eso es justo lo que hace falta para
  // que el test de deps stale del Fix 3 pueda reproducir el bug de forma
  // controlada: si el useCallback dependiera solo de `[printer]` y `printer`
  // fuera siempre la misma referencia, un printerWidth desactualizado
  // quedaría atrapado en el closure salvo que también esté en la lista de
  // deps.
  const printerState = {
    isSupported: true,
    connected: true,
    connecting: false,
    device: { name: "Test Printer" },
    error: null as string | null,
    connect: vi.fn(),
    disconnect: vi.fn(),
    print: mockPrint,
  }
  const showErrorMock = vi.fn().mockResolvedValue(undefined)
  return { printerState, mockPrint, showErrorMock }
})

vi.mock("@/components/pos/use-thermal-printer", () => ({
  useThermalPrinter: () => printerState,
}))
vi.mock("@/lib/escpos-image", () => ({
  imageUrlToRaster: vi.fn(),
  imageUrlToBinarizedDataUrl: vi.fn(),
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
const VENTA_CON_LOGO = {
  id: "venta-1",
  numeroVenta: 42,
  total: 1000,
  clienteNombre: "",
  items: [],
  metodoPago: "EFECTIVO",
  organizationLogoUrl: "https://cdn.example.com/logo.png",
}
vi.mock("@/components/pos/pos-checkout-dialog", () => ({
  PosCheckoutDialog: (props: any) => (
    <button type="button" onClick={() => props.onComplete(VENTA_CON_LOGO)}>
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

function createFakePrintWindow() {
  return {
    document: {
      write: vi.fn(),
      close: vi.fn(),
      readyState: "complete" as DocumentReadyState,
      fonts: { ready: Promise.resolve() },
      body: {},
    },
    focus: vi.fn(),
    print: vi.fn(),
    onload: null as (() => void) | null,
  }
}

async function completarVenta() {
  render(<PosTerminal />)
  fireEvent.click(await screen.findByRole("button", { name: "mock-complete-venta" }))
}

beforeEach(() => {
  stubFetch()
  localStorage.clear()
  printerState.connected = true
  printerState.connecting = false
  mockPrint.mockClear()
  mockPrint.mockResolvedValue(true)
  showErrorMock.mockClear()
  vi.mocked(imageUrlToRaster).mockReset()
  vi.mocked(imageUrlToBinarizedDataUrl).mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("printTicket (impresora térmica conectada) — un logo que falla nunca frena la venta", () => {
  beforeEach(() => {
    printerState.connected = true
  })

  it("igual imprime cuando imageUrlToRaster rechaza", async () => {
    vi.mocked(imageUrlToRaster).mockRejectedValueOnce(new Error("logo fetch failed"))

    await completarVenta()

    await waitFor(() => expect(mockPrint).toHaveBeenCalledTimes(1))
  })

  it("igual imprime cuando imageUrlToRaster resuelve null", async () => {
    vi.mocked(imageUrlToRaster).mockResolvedValueOnce(null)

    await completarVenta()

    await waitFor(() => expect(mockPrint).toHaveBeenCalledTimes(1))
  })
})

describe("printTicketHTML (fallback por navegador) — un logo que falla nunca frena la impresión", () => {
  beforeEach(() => {
    printerState.connected = false
  })

  it("igual abre el diálogo de impresión cuando imageUrlToBinarizedDataUrl rechaza", async () => {
    vi.mocked(imageUrlToBinarizedDataUrl).mockRejectedValueOnce(new Error("logo fetch failed"))
    const fakeWindow = createFakePrintWindow()
    vi.stubGlobal("open", vi.fn().mockReturnValue(fakeWindow))

    await completarVenta()
    fireEvent.click(await screen.findByRole("button", { name: /imprimir ticket/i }))

    await waitFor(() => expect(fakeWindow.document.write).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(fakeWindow.print).toHaveBeenCalledTimes(1))
  })

  it("igual abre el diálogo de impresión cuando imageUrlToBinarizedDataUrl resuelve null (sin <img> en el HTML)", async () => {
    vi.mocked(imageUrlToBinarizedDataUrl).mockResolvedValueOnce(null)
    const fakeWindow = createFakePrintWindow()
    vi.stubGlobal("open", vi.fn().mockReturnValue(fakeWindow))

    await completarVenta()
    fireEvent.click(await screen.findByRole("button", { name: /imprimir ticket/i }))

    await waitFor(() => expect(fakeWindow.document.write).toHaveBeenCalledTimes(1))
    const [htmlEscrito] = fakeWindow.document.write.mock.calls[0]
    expect(htmlEscrito).not.toContain("<img")
  })
})

describe("printTicketHTML — abre la ventana ANTES de esperar el logo (Fix 1)", () => {
  beforeEach(() => {
    printerState.connected = false
  })

  it("llama a window.open de forma síncrona, sin esperar a que el logo termine de binarizarse", async () => {
    let resolveLogo: (value: string | null) => void = () => {}
    const logoPendiente = new Promise<string | null>((resolve) => {
      resolveLogo = resolve
    })
    vi.mocked(imageUrlToBinarizedDataUrl).mockReturnValue(logoPendiente)

    const fakeWindow = createFakePrintWindow()
    const openMock = vi.fn().mockReturnValue(fakeWindow)
    vi.stubGlobal("open", openMock)

    await completarVenta()
    fireEvent.click(await screen.findByRole("button", { name: /imprimir ticket/i }))

    // La ventana ya se abrió aunque el logo sigue pendiente: si esto
    // regresa a `await` antes de `window.open`, openMock nunca se llama acá.
    expect(openMock).toHaveBeenCalledWith("", "_blank", "width=320,height=600")
    expect(fakeWindow.document.write).not.toHaveBeenCalled()

    resolveLogo(null)
    await waitFor(() => expect(fakeWindow.document.write).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(fakeWindow.print).toHaveBeenCalledTimes(1))
  })

  it("si el popup queda bloqueado (window.open devuelve null) avisa con showError en vez de fallar en silencio", async () => {
    vi.mocked(imageUrlToBinarizedDataUrl).mockResolvedValue(null)
    vi.stubGlobal("open", vi.fn().mockReturnValue(null))

    await completarVenta()
    fireEvent.click(await screen.findByRole("button", { name: /imprimir ticket/i }))

    await waitFor(() => expect(showErrorMock).toHaveBeenCalledTimes(1))
    expect(showErrorMock.mock.calls[0][0]).toMatch(/bloque/i)
    // Nunca debe llegar a intentar binarizar el logo si ni siquiera pudo
    // abrir la ventana.
    expect(imageUrlToBinarizedDataUrl).not.toHaveBeenCalled()
  })
})

describe("printTicket — deps del useCallback (Fix 3: printerWidth no debe quedar stale)", () => {
  it("rasteriza el logo con el printerWidth ACTUAL, no con el de cuando se montó el componente", async () => {
    printerState.connected = true
    vi.mocked(imageUrlToRaster).mockResolvedValue(null)

    render(<PosTerminal />)

    // Default es 58mm; se cambia a 80mm ANTES de cobrar.
    fireEvent.click(screen.getByTitle("Impresora térmica 80mm"))

    fireEvent.click(await screen.findByRole("button", { name: "mock-complete-venta" }))

    await waitFor(() => expect(imageUrlToRaster).toHaveBeenCalledTimes(1))
    expect(imageUrlToRaster).toHaveBeenCalledWith(
      "https://cdn.example.com/logo.png",
      { maxWidth: 576 } // anchoLogoDots(80) — anchoLogoDots(58) sería 384, el valor stale
    )
  })
})
