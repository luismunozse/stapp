/**
 * Ver remito vs Generar remito en el detalle de la orden.
 */
import type * as React from "react"
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
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

// Radix no abre el menú en jsdom: se renderiza plano, como en inventario-list-variantes.
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div role="menu">{children}</div>,
  DropdownMenuSeparator: () => null,
  DropdownMenuItem: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <div role="menuitem" onClick={onClick}>
      {children}
    </div>
  ),
}))

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


// El menú "Más acciones" ofrecía "Generar remito" aunque la orden ya tuviera
// uno, y generar de nuevo fallaba con "Ya existe un remito para esta orden".
describe("OrdenDetail — remito en el menú de acciones", () => {
  const REAL = { ...BASE, codigoOrden: "CEL025", numeroOrden: 25, esPractica: false }

  async function abrirMenu() {
    render(<OrdenDetail ordenId="ord-1" />)
    await screen.findByRole("button", { name: "Más acciones" })
  }

  it("orden reparada sin remito → Generar remito", async () => {
    stubFetch({ ...REAL, facturas: null })
    await abrirMenu()
    expect(await screen.findByRole("menuitem", { name: /Generar remito/ })).toBeInTheDocument()
    expect(screen.queryByRole("menuitem", { name: /Ver remito/ })).not.toBeInTheDocument()
  })

  it("orden con remito → Ver remito abre el PDF y no ofrece generarlo otra vez", async () => {
    stubFetch({ ...REAL, facturas: { id: "rem-9", estado_pago: "PAGADO" } })
    const open = vi.spyOn(window, "open").mockImplementation(() => null)
    await abrirMenu()
    const ver = await screen.findByRole("menuitem", { name: /Ver remito/ })
    expect(screen.queryByRole("menuitem", { name: /Generar remito/ })).not.toBeInTheDocument()
    fireEvent.click(ver)
    expect(open).toHaveBeenCalledWith("/api/facturacion/rem-9/pdf", "_blank")
  })
})
