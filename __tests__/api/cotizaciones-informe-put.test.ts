import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createPostRequest,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn().mockResolvedValue(true),
}))

import { supabaseAdmin } from "@/lib/supabase"
import { PUT } from "@/app/api/cotizaciones/[id]/route"

const params = { params: Promise.resolve({ id: "cot-1" }) }

function mockCotizacionExistente(overrides: Record<string, any> = {}) {
  return createChainMock({
    id: "cot-1",
    estado: "BORRADOR",
    organization_id: "org-1",
    tipo: "ORDEN",
    orden_id: null,
    veredicto: null,
    diagnostico_tecnico: null,
    causa_dano: null,
    presentado_ante: null,
    items_cotizacion: [],
    ...overrides,
  })
}

describe("PUT /api/cotizaciones/[id] — informe tecnico", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: 1, error: null } as any)
  })

  it("guarda el dictamen completo dejando el documento sin items", async () => {
    mockAuthSuccess()
    const cotizaciones = mockCotizacionExistente()
    mockSupabaseFrom({ cotizaciones, items_cotizacion: createChainMock(null, null) })

    const res = await PUT(
      createPostRequest({
        items: [],
        veredicto: "IRREPARABLE",
        diagnosticoTecnico: "Corrosion generalizada en la placa.",
        causaDano: "LIQUIDO",
        presentadoAnte: "Provincia Seguros",
      }),
      params
    )

    expect(res.status).not.toBe(400)
    const update = cotizaciones.update.mock.calls[0][0]
    expect(update.veredicto).toBe("IRREPARABLE")
    expect(update.causa_dano).toBe("LIQUIDO")
    expect(update.presentado_ante).toBe("Provincia Seguros")
  })

  it("rechaza vaciar los items sin cargar veredicto", async () => {
    mockAuthSuccess()
    mockSupabaseFrom({
      cotizaciones: mockCotizacionExistente({
        items_cotizacion: [{ id: "it-1", descripcion: "Pantalla", cantidad: 1, precio_unitario: 1000, subtotal: 1000 }],
      }),
      items_cotizacion: createChainMock(null, null),
    })

    const res = await PUT(createPostRequest({ items: [] }), params)
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body.error).toContain("veredicto")
  })

  it("rechaza pasar a REPARABLE un documento que ya no tiene items", async () => {
    mockAuthSuccess()
    mockSupabaseFrom({
      cotizaciones: mockCotizacionExistente({
        veredicto: "IRREPARABLE",
        diagnostico_tecnico: "Sin reparacion.",
        causa_dano: "LIQUIDO",
        items_cotizacion: [],
      }),
      items_cotizacion: createChainMock(null, null),
    })

    // No manda `items`: la validacion tiene que mirar la fila existente.
    const res = await PUT(createPostRequest({ veredicto: "REPARABLE" }), params)
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body.error).toContain("al menos un ítem")
  })

  it("deja pasar un PUT que no toca el informe sobre una cotizacion de cero items sin veredicto", async () => {
    mockAuthSuccess()
    const cotizaciones = mockCotizacionExistente({
      veredicto: null,
      items_cotizacion: [],
    })
    mockSupabaseFrom({ cotizaciones, items_cotizacion: createChainMock(null, null) })

    const res = await PUT(createPostRequest({ notas: "Retira el martes" }), params)

    expect(res.status).not.toBe(400)
    expect(cotizaciones.update).toHaveBeenCalled()
  })

  it("deja rechazar una cotizacion vieja de cero items sin veredicto", async () => {
    mockAuthSuccess()
    mockSupabaseFrom({
      cotizaciones: mockCotizacionExistente({
        veredicto: null,
        items_cotizacion: [],
      }),
      items_cotizacion: createChainMock(null, null),
    })

    const res = await PUT(createPostRequest({ estado: "RECHAZADA" }), params)

    expect(res.status).not.toBe(400)
  })

  it("no toca las columnas del dictamen cuando el pedido no las menciona", async () => {
    mockAuthSuccess()
    const cotizaciones = mockCotizacionExistente({
      veredicto: "IRREPARABLE",
      diagnostico_tecnico: "Sin reparacion.",
      causa_dano: "LIQUIDO",
      items_cotizacion: [],
    })
    mockSupabaseFrom({ cotizaciones, items_cotizacion: createChainMock(null, null) })

    await PUT(createPostRequest({ notas: "Retira el martes" }), params)

    const update = cotizaciones.update.mock.calls[0][0]
    expect(update).not.toHaveProperty("veredicto")
    expect(update).not.toHaveProperty("causa_dano")
  })
})
