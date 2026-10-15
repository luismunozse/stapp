/**
 * Toggle "Agrupar variantes en el punto de venta" (migration M3) in ConfiguracionForm.
 *
 * The workshop decides: grouped is the default, and this is the only place that turns it off.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { ModalProvider } from "@/contexts/modal-context"

const mockFetch = vi.fn()
global.fetch = mockFetch as unknown as typeof fetch

const TOGGLE = /Agrupar variantes en el punto de venta/i

function configResponse(overrides: Record<string, any> = {}) {
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
    vendedoresAdministranInventario: false,
    tecnicosOperanPos: false,
    comisionAplicaSinReparacion: false,
    ivaRegimen: "EXENTO", ivaTasa: 21, redondeoEfectivo: 0,
    ...overrides,
  }
}

async function renderForm() {
  const { ConfiguracionForm } = await import("@/components/configuracion/configuracion-form")
  render(<ModalProvider><ConfiguracionForm initialTab="empresa" /></ModalProvider>)
  return screen.findByLabelText(TOGGLE)
}

function putBody() {
  const putCall = mockFetch.mock.calls.find(([, init]) => init?.method === "PUT")!
  return JSON.parse(putCall[1].body as string)
}

async function guardar() {
  fireEvent.click(screen.getByRole("button", { name: /Guardar Cambios/i }))
  await waitFor(() => {
    expect(mockFetch.mock.calls.find(([, init]) => init?.method === "PUT")).toBeDefined()
  })
}

describe("ConfiguracionForm: agrupar variantes en el POS", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockResolvedValue({ ok: true, json: async () => configResponse() })
  })

  it("comes ON when the answer has no value yet (grouped is the default)", async () => {
    const toggle = await renderForm()
    expect(toggle).toBeChecked()
  })

  it("reflects a saved OFF", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => configResponse({ posAgrupaVariantes: false }) })
    const toggle = await renderForm()
    expect(toggle).not.toBeChecked()
  })

  it("reflects a saved ON", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => configResponse({ posAgrupaVariantes: true }) })
    const toggle = await renderForm()
    expect(toggle).toBeChecked()
  })

  it("turning it off is sent as false, not omitted", async () => {
    const toggle = await renderForm()

    fireEvent.click(toggle)
    await guardar()

    expect(putBody().posAgrupaVariantes).toBe(false)
  })

  it("turning it back on is sent as true", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => configResponse({ posAgrupaVariantes: false }) })
    const toggle = await renderForm()

    fireEvent.click(toggle)
    await guardar()

    expect(putBody().posAgrupaVariantes).toBe(true)
  })
})
