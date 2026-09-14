// @vitest-environment jsdom
/**
 * Cubre las dos invariantes de seguridad del logo en PosTicketShare (Fix 4 y
 * Fix 5 del review):
 *
 *  - No taint (Fix 4): el <img src> del ticket oculto que usa html2canvas
 *    SIEMPRE es el data: URL binarizado, NUNCA la URL cruda del logo — si
 *    regresara a usar la URL cruda, html2canvas mancha el canvas (taint) y
 *    tanto el share de WhatsApp como la descarga PNG se rompen enteros, algo
 *    peor que la falta de logo que este branch soluciona.
 *  - Sin carrera (Fix 5): generateImage() no está gateado al useEffect que
 *    binariza el logo, así que un cajero que clickea antes de que termine el
 *    fetch+binarizado comparte un ticket sin logo de forma no determinística.
 *    Los botones deben quedar deshabilitados mientras el logo está pendiente.
 *
 * imageUrlToBinarizedDataUrl es una función exportada plana de
 * lib/escpos-image.ts — mockearla alcanza, no hace falta mockear canvas.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, waitFor } from "@testing-library/react"
import { PosTicketShare } from "@/components/pos/pos-ticket-share"
import { imageUrlToBinarizedDataUrl } from "@/lib/escpos-image"

vi.mock("@/lib/escpos-image", () => ({
  imageUrlToBinarizedDataUrl: vi.fn(),
}))
vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({
    formatPrice: (n: number) => `$${n}`,
    timezone: "America/Argentina/Buenos_Aires",
  }),
}))

const LOGO_URL = "https://cdn.example.com/logo.png"
const LOGO_DATA_URL = "data:image/png;base64,ZZZZ"

const baseVenta = {
  id: "venta-1",
  numeroVenta: 42,
  clienteNombre: "Juana Pérez",
  clienteTelefono: "1122334455",
  items: [{ descripcion: "Funda", cantidad: 1, precioUnitario: 500 }],
  total: 500,
  metodoPago: "EFECTIVO",
  organizationName: "Mi Taller",
}

beforeEach(() => {
  vi.mocked(imageUrlToBinarizedDataUrl).mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("PosTicketShare — el <img> del ticket oculto nunca usa la URL cruda del logo (Fix 4)", () => {
  it("usa el data: URL binarizado una vez que termina de cargar", async () => {
    vi.mocked(imageUrlToBinarizedDataUrl).mockResolvedValue(LOGO_DATA_URL)

    const { container } = render(
      <PosTicketShare ventaData={{ ...baseVenta, organizationLogoUrl: LOGO_URL }} />
    )

    await waitFor(() => {
      const img = container.querySelector("img")
      expect(img).not.toBeNull()
      expect(img?.getAttribute("src")).toBe(LOGO_DATA_URL)
    })

    const img = container.querySelector("img")
    expect(img?.getAttribute("src")).not.toBe(LOGO_URL)
  })

  it("no renderiza ningún <img> cuando el binarizado falla (degrada a sin logo)", async () => {
    vi.mocked(imageUrlToBinarizedDataUrl).mockResolvedValue(null)

    const { container } = render(
      <PosTicketShare ventaData={{ ...baseVenta, organizationLogoUrl: LOGO_URL }} />
    )

    await waitFor(() => {
      expect(container.querySelector("img")).toBeNull()
    })
  })
})

describe("PosTicketShare — botones gateados mientras el logo está pendiente (Fix 5)", () => {
  it("deshabilita WhatsApp y descarga mientras el logo todavía se está binarizando, y los habilita al resolver", async () => {
    let resolveLogo: (value: string | null) => void = () => {}
    const pending = new Promise<string | null>((resolve) => {
      resolveLogo = resolve
    })
    vi.mocked(imageUrlToBinarizedDataUrl).mockReturnValue(pending)

    const { getByRole, getByTitle } = render(
      <PosTicketShare ventaData={{ ...baseVenta, organizationLogoUrl: LOGO_URL }} />
    )

    const whatsappBtn = getByRole("button", { name: /whatsapp/i })
    const downloadBtn = getByTitle("Descargar ticket como imagen")

    expect(whatsappBtn).toBeDisabled()
    expect(downloadBtn).toBeDisabled()

    resolveLogo(LOGO_DATA_URL)

    await waitFor(() => expect(whatsappBtn).not.toBeDisabled())
    expect(downloadBtn).not.toBeDisabled()
  })

  it("no gatea nada cuando la venta no tiene logo (sin fetch pendiente)", () => {
    vi.mocked(imageUrlToBinarizedDataUrl).mockResolvedValue(null)

    const { getByRole } = render(
      <PosTicketShare ventaData={{ ...baseVenta, organizationLogoUrl: null }} />
    )

    expect(getByRole("button", { name: /whatsapp/i })).not.toBeDisabled()
    expect(imageUrlToBinarizedDataUrl).not.toHaveBeenCalled()
  })
})
