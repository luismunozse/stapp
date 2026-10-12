import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createPostRequest,
} from "./helpers"

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn().mockResolvedValue(true),
}))

import { supabaseAdmin } from "@/lib/supabase"
import { PUT } from "@/app/api/cotizaciones/[id]/route"

const params = { params: Promise.resolve({ id: "cot-1" }) }

describe("PUT /api/cotizaciones/[id] — enviar un informe no presupuesta la orden", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: 1, error: null } as any)
  })

  it("deja la orden en EN_DIAGNOSTICO al enviar un informe irreparable", async () => {
    mockAuthSuccess()
    const ordenes = createChainMock({ id: "ord-1", estado: "EN_DIAGNOSTICO" })
    const cotizacionRow = {
      id: "cot-1",
      estado: "BORRADOR",
      organization_id: "org-1",
      tipo: "ORDEN",
      orden_id: "ord-1",
      total: 0,
      veredicto: "IRREPARABLE",
      diagnostico_tecnico: "Sin reparacion posible.",
      causa_dano: "LIQUIDO",
      items_cotizacion: [],
    }
    // "cotizaciones" atiende consultas de dos formas distintas en este mismo
    // PUT: las que traen la fila existente (usan .single(), necesitan un
    // objeto) y la del recalculo de presupuesto (no usa .single(), necesita un
    // array de {total}). Mismo patron que cotizaciones-presupuesto-recalc.test.ts.
    const cotizaciones = createChainMock([{ total: cotizacionRow.total }])
    cotizaciones.single = vi.fn().mockResolvedValue({ data: cotizacionRow, error: null })
    mockSupabaseFrom({
      cotizaciones,
      items_cotizacion: createChainMock(null, null),
      ordenes_servicio: ordenes,
      orden_eventos: createChainMock(null, null),
    })

    await PUT(createPostRequest({ estado: "ENVIADA" }), params)

    const paso = ordenes.update.mock.calls.some(
      (llamada) => llamada[0]?.estado === "PRESUPUESTADO"
    )
    expect(paso).toBe(false)
  })

  it("sigue presupuestando la orden cuando la cotizacion tiene items", async () => {
    mockAuthSuccess()
    const ordenes = createChainMock({ id: "ord-1", estado: "EN_DIAGNOSTICO" })
    const cotizacionRow = {
      id: "cot-1",
      estado: "BORRADOR",
      organization_id: "org-1",
      tipo: "ORDEN",
      orden_id: "ord-1",
      total: 50000,
      veredicto: null,
      items_cotizacion: [
        { id: "it-1", descripcion: "Pantalla", cantidad: 1, precio_unitario: 50000, subtotal: 50000 },
      ],
    }
    const cotizaciones = createChainMock([{ total: cotizacionRow.total }])
    cotizaciones.single = vi.fn().mockResolvedValue({ data: cotizacionRow, error: null })
    mockSupabaseFrom({
      cotizaciones,
      items_cotizacion: createChainMock(null, null),
      ordenes_servicio: ordenes,
      orden_eventos: createChainMock(null, null),
    })

    await PUT(createPostRequest({ estado: "ENVIADA" }), params)

    const paso = ordenes.update.mock.calls.some(
      (llamada) => llamada[0]?.estado === "PRESUPUESTADO"
    )
    expect(paso).toBe(true)
  })
})
