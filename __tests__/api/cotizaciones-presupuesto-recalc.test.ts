import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom } from "./helpers"

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn().mockResolvedValue(true),
}))
vi.mock("@/lib/audit", () => ({
  createAuditLogger: vi.fn(() => ({
    update: vi.fn().mockResolvedValue(undefined),
  })),
}))

// El presupuesto de la orden es la suma de sus cotizaciones no rechazadas.
// Este test fija ese comportamiento ANTES del refactor: si se mueve, el
// refactor esta mal, no el test.
describe("PUT /api/cotizaciones/[id] — presupuesto de la orden", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess()
  })

  it("escribe en la orden la suma de las cotizaciones vigentes", async () => {
    const ordenesChain = createChainMock({ id: "orden-1", estado: "PRESUPUESTADO" })
    // "cotizaciones" atiende dos consultas de forma distinta en este mismo
    // PUT: la que trae la fila existente (usa .single(), necesita un objeto
    // con orden_id) y la que suma las vigentes para el recalculo (no usa
    // .single(), necesita un array de {total}). El helper createChainMock
    // solo modela un shape por tabla, así que se pisa .single() para separar
    // ambos casos sin tocar el resto del chain.
    const cotizacionRow = {
      id: "cot-1",
      estado: "BORRADOR",
      tipo: "ORDEN",
      organization_id: "org-1",
      created_by: "user-1",
      iva_porcentaje: 0,
      descuento_global_tipo: "porcentaje",
      descuento_global_valor: 0,
      orden_id: "orden-1",
    }
    const cotizacionesChain = createChainMock([{ total: 100 }, { total: 50 }])
    cotizacionesChain.single = vi.fn().mockResolvedValue({ data: cotizacionRow, error: null })
    mockSupabaseFrom({
      cotizaciones: cotizacionesChain,
      ordenes_servicio: ordenesChain,
      items_cotizacion: createChainMock([]),
      orden_eventos: createChainMock(null),
    })

    // El item que se edita vale 999, no 150: si la implementación escribiera
    // el total de ESTA cotización (999) en vez de la suma de las vigentes
    // (100 + 50 = 150), el assert de abajo lo detectaría. No cambiar estos
    // números para que "combinen" — la diferencia es lo que hace la prueba.
    const { PUT } = await import("@/app/api/cotizaciones/[id]/route")
    await PUT(
      new Request("http://localhost:3000/api/cotizaciones/cot-1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{ descripcion: "X", cantidad: 1, precioUnitario: 999 }],
        }),
      }) as any,
      { params: Promise.resolve({ id: "cot-1" }) } as any
    )

    const escrito = ordenesChain.update.mock.calls.map((c: any[]) => c[0])
    expect(escrito).toContainEqual(
      expect.objectContaining({ presupuesto: 150, costo_final: 150 })
    )
  })
})
