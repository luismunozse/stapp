/**
 * Order screen: the paper size of ONE print.
 *
 * Next to "PDF" and "Imprimir" there is a selector that starts on the workshop's default size and
 * only changes what this print asks the server for (?papel=). Choosing nothing asks for nothing,
 * so the server uses the default; choosing a size sends it, even if it equals the default.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { OrdenDetail } from "@/components/ordenes/orden-detail"

let orgDefault = "A4"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}))
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { role: "ADMIN", organizationId: "org-1", name: "Ana" } } }),
}))
vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({
    formatPrice: (n: number) => `$${n}`,
    formatDate: () => "11/10/2026",
    currency: "ARS",
    timezone: "America/Argentina/Buenos_Aires",
    pais: "AR",
    ordenFormatoPapel: orgDefault,
  }),
  useTerminologia: () => (key: string) => key,
}))
vi.mock("@/contexts/modal-context", () => ({
  useModal: () => ({ confirm: vi.fn(), alert: vi.fn(), showError: vi.fn() }),
}))
vi.mock("@/hooks/use-visibility-polling", () => ({ useVisibilityPolling: () => {} }))
vi.mock("@/components/ordenes/use-etiqueta-size", () => ({
  useEtiquetaSize: () => ({ size: "62x29", ready: true, update: vi.fn() }),
}))
vi.mock("@/components/ordenes/print-label", () => ({ printDeviceLabel: vi.fn(), LABEL_SIZE_OPTIONS: [] }))
vi.mock("@/components/ordenes/orden-estado-card", () => ({ OrdenEstadoCard: () => <div /> }))
vi.mock("@/components/ordenes/orden-tecnico-card", () => ({ OrdenTecnicoCard: () => <div /> }))
vi.mock("@/components/ordenes/orden-costos-card", () => ({ OrdenCostosCard: () => <div /> }))
vi.mock("@/components/ordenes/orden-comision-card", () => ({ OrdenComisionCard: () => <div /> }))
vi.mock("@/components/ordenes/orden-repuestos-tab", () => ({ OrdenRepuestosTab: () => <div /> }))
vi.mock("@/components/ordenes/orden-servicios-tab", () => ({ OrdenServiciosTab: () => <div /> }))
vi.mock("@/components/ordenes/cobrar-orden-dialog", () => ({ CobrarOrdenDialog: () => <div /> }))
vi.mock("@/components/ordenes/confirmar-reparado-dialog", () => ({ ConfirmarReparadoDialog: () => <div /> }))
vi.mock("@/components/ordenes/entrega-dialog", () => ({ EntregaDialog: () => <div /> }))
vi.mock("@/components/ordenes/whatsapp-dialog", () => ({ WhatsAppDialog: () => <div /> }))
vi.mock("@/components/ordenes/thermal-print-orden", () => ({ ThermalPrintOrden: () => <div /> }))
vi.mock("@/components/ordenes/notification-history", () => ({ NotificationHistory: () => <div /> }))
vi.mock("@/components/notas-credito/nota-credito-dialog", () => ({ NotaCreditoDialog: () => <div /> }))
vi.mock("@/components/cotizaciones/cotizacion-list", () => ({ CotizacionList: () => <div /> }))
vi.mock("@/components/garantias/garantia-card", () => ({ GarantiaCard: () => <div /> }))
vi.mock("@/components/fotos/foto-gallery", () => ({ FotoGallery: () => <div /> }))
vi.mock("@/components/checklist/checklist-card", () => ({ ChecklistCard: () => <div /> }))

const ORDEN = {
  id: "ord-1",
  numeroOrden: 1,
  codigoOrden: "HEL0001",
  estado: "REPARADO",
  dispositivo: "Gafa HGF-357",
  tipoDispositivo: "HELADERA",
  problemaReportado: "No enfría",
  costoFinal: 15000,
  fechaIngreso: "2026-10-11",
  publicToken: "tok-123",
  totalCobrado: 0,
  sena: 0,
  descuentoCobro: 0,
  estadoCobro: "PENDIENTE",
  metadata: {},
  esPractica: false,
  cliente: { id: "cli-1", nombre: "Ana Pérez", telefono: "", email: "ana@taller.test" },
}

const fetchMock = vi.fn()

function pdfRequests() {
  return fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("/pdf"))
}

async function renderOrden() {
  render(<OrdenDetail ordenId="ord-1" />)
  return screen.findByRole("combobox", { name: /Tamaño de hoja para imprimir/i }) as Promise<HTMLSelectElement>
}

beforeEach(() => {
  vi.clearAllMocks()
  orgDefault = "A4"
  fetchMock.mockImplementation(async (url: string) => {
    if (url === "/api/ordenes/ord-1") return { ok: true, status: 200, json: async () => ORDEN }
    if (url.includes("/pdf")) return { ok: true, status: 200, blob: async () => new Blob(["pdf"]) }
    return { ok: true, status: 200, json: async () => [] }
  })
  vi.stubGlobal("fetch", fetchMock)
  vi.stubGlobal("open", vi.fn(() => ({ addEventListener: vi.fn() })))
  window.URL.createObjectURL = vi.fn(() => "blob:test")
})

describe("OrdenDetail: paper size of this print", () => {
  it("shows a native selector that starts on the workshop's size and says which one it is", async () => {
    orgDefault = "A5"
    const select = await renderOrden()

    expect(select.tagName).toBe("SELECT")
    expect(select.value).toBe("A5")
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      "A4 (hoja entera)",
      "A5 (media hoja) · la del taller",
      "A6 (un cuarto de hoja)",
    ])
  })

  it("Imprimir without choosing asks for no size: the server uses the workshop's", async () => {
    orgDefault = "A6"
    await renderOrden()

    fireEvent.click(screen.getByRole("button", { name: /Imprimir/ }))

    await waitFor(() => expect(pdfRequests()).toEqual(["/api/ordenes/ord-1/pdf"]))
  })

  it("Imprimir after choosing A6 asks for A6", async () => {
    const select = await renderOrden()

    fireEvent.change(select, { target: { value: "A6" } })
    fireEvent.click(screen.getByRole("button", { name: /Imprimir/ }))

    await waitFor(() => expect(pdfRequests()).toEqual(["/api/ordenes/ord-1/pdf?papel=A6"]))
  })

  it("PDF after choosing A4 on a workshop that prints on A6 asks for A4, in both directions", async () => {
    orgDefault = "A6"
    const select = await renderOrden()

    fireEvent.change(select, { target: { value: "A4" } })
    fireEvent.click(screen.getByRole("button", { name: /^PDF$/ }))

    await waitFor(() => expect(pdfRequests()).toEqual(["/api/ordenes/ord-1/pdf?papel=A4"]))
  })

  it("the choice stays for the next print on this screen, and changing it changes the next request", async () => {
    const select = await renderOrden()

    fireEvent.change(select, { target: { value: "A5" } })
    fireEvent.click(screen.getByRole("button", { name: /Imprimir/ }))
    await waitFor(() => expect(pdfRequests()).toHaveLength(1))

    fireEvent.change(select, { target: { value: "A6" } })
    fireEvent.click(screen.getByRole("button", { name: /Imprimir/ }))
    await waitFor(() => expect(pdfRequests()).toHaveLength(2))

    expect(pdfRequests()).toEqual(["/api/ordenes/ord-1/pdf?papel=A5", "/api/ordenes/ord-1/pdf?papel=A6"])
  })
})
