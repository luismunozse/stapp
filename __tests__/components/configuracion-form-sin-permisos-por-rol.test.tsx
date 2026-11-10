/**
 * Los permisos por rol (vendedores/técnicos) viven en Roles y permisos, que guarda
 * cada uno al instante. Si Empresa los duplicara y los mandara en su PUT completo,
 * guardar Empresa pisaría con valores viejos lo cambiado en Roles.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { ModalProvider } from "@/contexts/modal-context"

const mockFetch = vi.fn()
global.fetch = mockFetch as unknown as typeof fetch

const CAMPOS = [
  "vendedoresAdministranInventario",
  "tecnicosOperanPos",
  "vendedoresManejanCaja",
  "tecnicosCobranCotizaciones",
  "vendedoresVenIngresos",
]

const TOGGLES = [
  /Los vendedores pueden administrar inventario/i,
  /Los técnicos pueden operar el POS/i,
  /Los vendedores pueden manejar la caja/i,
  /Los técnicos pueden cobrar sus cotizaciones/i,
  /Los vendedores pueden ver los ingresos/i,
]

function configResponse() {
  return {
    logoUrl: null, logoData: null, logoMime: null,
    nombreEmpresa: "Taller Test", telefono: "", direccion: "", ciudad: "",
    provincia: "", codigoPostal: "", pais: "AR", moneda: "ARS",
    zonaHoraria: "America/Argentina/Buenos_Aires",
    ivaPorcentaje: 0, cotizacionValidezDias: 30, cotizacionTerminos: "",
    recepcionTerminos: "", comprobanteTerminos: "",
    garantiaDiasDefault: 30, politicaAbandonoDiasDefault: 60,
    anticipoPorcentajeDefault: 50,
    moduloAgenda: false,
    vendedoresAdministranInventario: true,
    tecnicosOperanPos: true,
    vendedoresManejanCaja: true,
    tecnicosCobranCotizaciones: true,
    vendedoresVenIngresos: false,
    comisionAplicaSinReparacion: false,
    ivaRegimen: "EXENTO", ivaTasa: 21, redondeoEfectivo: 0,
  }
}

async function renderForm() {
  const { ConfiguracionForm } = await import("@/components/configuracion/configuracion-form")
  render(<ModalProvider><ConfiguracionForm initialTab="empresa" /></ModalProvider>)
  await screen.findByLabelText(/Agrupar variantes en el punto de venta/i)
}

describe("ConfiguracionForm: sin permisos por rol en Empresa", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockResolvedValue({ ok: true, json: async () => configResponse() })
  })

  it("no renderiza los 5 toggles de permisos por rol", async () => {
    await renderForm()
    for (const toggle of TOGGLES) {
      expect(screen.queryByLabelText(toggle)).not.toBeInTheDocument()
    }
  })

  it("apunta a Roles y permisos", async () => {
    await renderForm()
    const link = screen.getByRole("link", { name: /Roles y permisos/i })
    expect(link).toHaveAttribute("href", "/configuracion/roles")
  })

  it("el PUT de Empresa no incluye los 5 permisos", async () => {
    await renderForm()
    fireEvent.click(screen.getByRole("button", { name: /Guardar Cambios/i }))
    await waitFor(() => {
      expect(mockFetch.mock.calls.find(([, init]) => init?.method === "PUT")).toBeDefined()
    })
    const put = mockFetch.mock.calls.find(([, init]) => init?.method === "PUT")!
    const body = JSON.parse(put[1].body as string)
    for (const campo of CAMPOS) {
      expect(body).not.toHaveProperty(campo)
    }
    expect(body).toHaveProperty("posAgrupaVariantes")
  })
})
