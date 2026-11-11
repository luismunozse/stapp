/**
 * Ficha de la orden: el encabezado resume cliente, equipo y saldo, y en el
 * celular una barra fija ofrece la acción principal y "Cobrar".
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
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
    ordenFormatoPapel: "A4",
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


const BASE = {
  id: "ord-1",
  numeroOrden: 1,
  codigoOrden: "CEL0001",
  estado: "REPARADO",
  marca: "Samsung",
  dispositivo: "A52",
  tipoDispositivo: "CELULAR",
  problemaReportado: "No carga",
  costoFinal: 15000,
  fechaIngreso: "2026-10-11",
  publicToken: "tok-123",
  totalCobrado: 5000,
  sena: 0,
  descuentoCobro: 0,
  estadoCobro: "PARCIAL",
  metadata: {},
  esPractica: false,
  cliente: { id: "cli-1", nombre: "Ana Pérez", telefono: "3415551234", email: null },
}

let orden: Record<string, unknown> = BASE

beforeEach(() => {
  vi.clearAllMocks()
  orden = BASE
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/ordenes/ord-1") return { ok: true, status: 200, json: async () => orden }
      return { ok: true, status: 200, json: async () => [] }
    })
  )
})

describe("OrdenDetail: encabezado y barra de acción", () => {
  it("el encabezado muestra cliente, teléfono para llamar, equipo y saldo", async () => {
    render(<OrdenDetail ordenId="ord-1" />)
    const tels = await screen.findAllByRole("link", { name: /3415551234/ })
    expect(tels[0]).toHaveAttribute("href", "tel:3415551234")
    expect(screen.getAllByText("Samsung A52").length).toBeGreaterThan(0)
    expect(screen.getByText("Saldo $10000")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Cobrar \$10000/ })).toBeInTheDocument()
  })

  it("una orden paga dice Pagado y no ofrece cobrar", async () => {
    orden = { ...BASE, totalCobrado: 15000, estadoCobro: "COBRADO" }
    render(<OrdenDetail ordenId="ord-1" />)
    expect(await screen.findByText("Pagado")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^Cobrar \$/ })).not.toBeInTheDocument()
  })

  it("la barra ofrece el paso siguiente del estado", async () => {
    render(<OrdenDetail ordenId="ord-1" />)
    expect(await screen.findByRole("button", { name: /^Entregar/ })).toBeInTheDocument()
  })

  it("una orden entregada no tiene acción principal", async () => {
    orden = { ...BASE, estado: "ENTREGADO", totalCobrado: 15000 }
    render(<OrdenDetail ordenId="ord-1" />)
    await screen.findByText("Pagado")
    expect(screen.queryByRole("button", { name: /^Entregar/ })).not.toBeInTheDocument()
  })
})
