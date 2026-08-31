/**
 * Toggle "Los vendedores pueden manejar la caja" en ConfiguracionForm.
 *
 * Sin este control el permiso existe solo en la base: el guard lo respeta y el
 * navbar lo lee, pero NADIE puede prenderlo desde la app. El toggle es la
 * única forma que tiene el admin de conceder el permiso.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { ModalProvider } from "@/contexts/modal-context"

const mockFetch = vi.fn()
global.fetch = mockFetch as unknown as typeof fetch

const TOGGLE = /Los vendedores pueden manejar la caja/i

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
    vendedoresManejanCaja: false,
    comisionAplicaSinReparacion: false,
    ivaRegimen: "EXENTO", ivaTasa: 21, redondeoEfectivo: 0,
    ...overrides,
  }
}

async function renderForm() {
  const { ConfiguracionForm } = await import("@/components/configuracion/configuracion-form")
  render(<ModalProvider><ConfiguracionForm /></ModalProvider>)
  return screen.findByLabelText(TOGGLE)
}

function putBody() {
  const putCall = mockFetch.mock.calls.find(([, init]) => init?.method === "PUT")!
  return JSON.parse(putCall[1].body as string)
}

describe("ConfiguracionForm — permiso de caja para vendedores", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockResolvedValue({ ok: true, json: async () => configResponse() })
  })

  it("refleja el estado guardado: prendido viene prendido", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => configResponse({ vendedoresManejanCaja: true }),
    })

    const toggle = await renderForm()

    expect(toggle).toBeChecked()
  })

  it("arranca apagado: el permiso es opt-in explícito", async () => {
    const toggle = await renderForm()

    expect(toggle).not.toBeChecked()
  })

  it("prenderlo lo manda en el PUT", async () => {
    const toggle = await renderForm()

    fireEvent.click(toggle)
    fireEvent.click(screen.getByRole("button", { name: /Guardar Cambios/i }))

    await waitFor(() => {
      expect(mockFetch.mock.calls.find(([, init]) => init?.method === "PUT")).toBeDefined()
    })
    expect(putBody().vendedoresManejanCaja).toBe(true)
  })

  it("apagarlo lo manda en false, no lo omite", async () => {
    // Omitirlo dejaría el permiso prendido para siempre: la ruta solo escribe
    // el campo cuando llega definido.
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => configResponse({ vendedoresManejanCaja: true }),
    })
    const toggle = await renderForm()

    fireEvent.click(toggle)
    fireEvent.click(screen.getByRole("button", { name: /Guardar Cambios/i }))

    await waitFor(() => {
      expect(mockFetch.mock.calls.find(([, init]) => init?.method === "PUT")).toBeDefined()
    })
    expect(putBody().vendedoresManejanCaja).toBe(false)
  })
})
