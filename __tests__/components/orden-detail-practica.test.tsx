/**
 * OrdenDetail hands a practice order to PracticaOrdenDetail before rendering
 * any action. Its children are stubbed with test ids so that the negative
 * assertions are not vacuous: the control case proves the same stubs do
 * render for a real order.
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { OrdenDetail } from "@/components/ordenes/orden-detail"

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
vi.mock("@/components/ordenes/orden-estado-card", () => ({ OrdenEstadoCard: () => <div data-testid="estado-card" /> }))
vi.mock("@/components/ordenes/orden-tecnico-card", () => ({ OrdenTecnicoCard: () => <div data-testid="tecnico-card" /> }))
vi.mock("@/components/ordenes/orden-costos-card", () => ({ OrdenCostosCard: () => <div data-testid="costos-card" /> }))
vi.mock("@/components/ordenes/orden-comision-card", () => ({ OrdenComisionCard: () => <div data-testid="comision-card" /> }))
vi.mock("@/components/ordenes/orden-repuestos-tab", () => ({ OrdenRepuestosTab: () => <div data-testid="repuestos-tab" /> }))
vi.mock("@/components/ordenes/orden-servicios-tab", () => ({ OrdenServiciosTab: () => <div data-testid="servicios-tab" /> }))
vi.mock("@/components/ordenes/cobrar-orden-dialog", () => ({ CobrarOrdenDialog: () => <div data-testid="cobrar-dialog" /> }))
vi.mock("@/components/ordenes/confirmar-reparado-dialog", () => ({ ConfirmarReparadoDialog: () => <div data-testid="reparado-dialog" /> }))
vi.mock("@/components/ordenes/entrega-dialog", () => ({ EntregaDialog: () => <div data-testid="entrega-dialog" /> }))
vi.mock("@/components/ordenes/whatsapp-dialog", () => ({ WhatsAppDialog: () => <div data-testid="whatsapp" /> }))
vi.mock("@/components/ordenes/thermal-print-orden", () => ({ ThermalPrintOrden: () => <div data-testid="thermal" /> }))
vi.mock("@/components/ordenes/notification-history", () => ({ NotificationHistory: () => <div data-testid="historial" /> }))
vi.mock("@/components/notas-credito/nota-credito-dialog", () => ({ NotaCreditoDialog: () => <div data-testid="nota-credito" /> }))
vi.mock("@/components/cotizaciones/cotizacion-list", () => ({ CotizacionList: () => <div data-testid="cotizaciones" /> }))
vi.mock("@/components/garantias/garantia-card", () => ({ GarantiaCard: () => <div data-testid="garantia" /> }))
vi.mock("@/components/fotos/foto-gallery", () => ({ FotoGallery: () => <div data-testid="fotos" /> }))
vi.mock("@/components/checklist/checklist-card", () => ({ ChecklistCard: () => <div data-testid="checklist" /> }))

const BASE = {
  id: "ord-1",
  numeroOrden: 0,
  codigoOrden: "PRACTICA",
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
  cliente: { id: "cli-1", nombre: "Ana Pérez", telefono: "", email: "ana@taller.test" },
}

function stubFetch(orden: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === `/api/ordenes/${orden.id}`) return { ok: true, status: 200, json: async () => orden }
      return { ok: true, status: 200, json: async () => [] }
    })
  )
}

const ACCIONES = [
  "estado-card", "tecnico-card", "costos-card", "comision-card", "repuestos-tab", "servicios-tab",
  "cobrar-dialog", "reparado-dialog", "entrega-dialog", "whatsapp", "thermal", "nota-credito",
  "cotizaciones", "garantia", "fotos", "checklist",
]

describe("OrdenDetail — practice order", () => {
  it("renders the read-only practice view and none of the order actions", async () => {
    stubFetch({ ...BASE, esPractica: true })
    render(<OrdenDetail ordenId="ord-1" />)

    expect(await screen.findByRole("heading", { name: "Orden de práctica" })).toBeInTheDocument()
    for (const id of ACCIONES) expect(screen.queryByTestId(id)).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^PDF$/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Imprimir/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Etiqueta/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument()
    expect(screen.queryByText(/Generar Remito/i)).not.toBeInTheDocument()
  })

  it("control: a real order still renders its actions with the same stubs", async () => {
    stubFetch({ ...BASE, codigoOrden: "HEL0001", numeroOrden: 1, esPractica: false })
    render(<OrdenDetail ordenId="ord-1" />)

    expect((await screen.findAllByTestId("costos-card")).length).toBeGreaterThan(0)
    expect(screen.getAllByTestId("estado-card").length).toBeGreaterThan(0)
    expect(screen.getByRole("button", { name: /PDF/ })).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Orden de práctica" })).not.toBeInTheDocument()
  })
})
