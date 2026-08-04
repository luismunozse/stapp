/**
 * GET /api/recepciones/[id] — detalle del lote con totales derivados.
 *
 * Mismo gate de plan que POST /api/recepciones (hasPlanFeature, no
 * useHasFeature), mismos helpers de mock que recepcion-multiple-gate.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, createGetRequest, parseResponse } from "./helpers"

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn(),
}))

import { hasPlanFeature } from "@/lib/subscriptions"
import { GET } from "@/app/api/recepciones/[id]/route"

function createParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

function createMockRecepcion(overrides: Record<string, any> = {}) {
  return {
    id: "rec-1",
    numero: 42,
    codigo: "REC-042",
    cliente_id: "cli-1",
    descuento_tipo: null,
    descuento_valor: null,
    observaciones: null,
    created_at: "2026-08-01T00:00:00.000Z",
    clientes: { nombre: "Juan Perez" },
    ...overrides,
  }
}

const mockOrdenes = [
  { id: "o1", numero_orden: 1, codigo_orden: "CEL-001", dispositivo: "iPhone 13", marca: "Apple", estado: "ENTREGADO", presupuesto: null, costo_final: 200 },
  { id: "o2", numero_orden: 2, codigo_orden: "CEL-002", dispositivo: "Notebook HP", marca: "HP", estado: "RECIBIDO", presupuesto: 150, costo_final: null },
  { id: "o3", numero_orden: 3, codigo_orden: "CEL-003", dispositivo: "Tablet Samsung", marca: "Samsung", estado: "ENTREGADO_SIN_COBRO", presupuesto: null, costo_final: 250 },
]

describe("GET /api/recepciones/[id] — detalle del lote", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess()
  })

  it("devuelve 403 FEATURE_REQUIRED cuando el plan no tiene la feature", async () => {
    vi.mocked(hasPlanFeature).mockResolvedValue(false)

    const res = await GET(createGetRequest(), createParams("rec-1"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(403)
    expect(body.code).toBe("FEATURE_REQUIRED")
    expect(body.feature).toBe("recepcion_multiple")
  })

  it("devuelve 404 cuando la recepcion no pertenece a la organizacion", async () => {
    vi.mocked(hasPlanFeature).mockResolvedValue(true)
    mockSupabaseFrom({
      recepciones: createChainMock(null, { message: "not found" }),
    })

    const res = await GET(createGetRequest(), createParams("rec-ajena"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(404)
    expect(body.error).toBeTruthy()
  })

  it("devuelve recepcion + ordenes + totales con descuento porcentual y conteo de entregadas/pendientes", async () => {
    vi.mocked(hasPlanFeature).mockResolvedValue(true)
    mockSupabaseFrom({
      recepciones: createChainMock(
        createMockRecepcion({ descuento_tipo: "porcentaje", descuento_valor: 10 })
      ),
      ordenes_servicio: createChainMock(mockOrdenes),
    })

    const res = await GET(createGetRequest(), createParams("rec-1"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.recepcion).toMatchObject({
      id: "rec-1",
      numero: 42,
      codigo: "REC-042",
      clienteId: "cli-1",
      clienteNombre: "Juan Perez",
      descuentoTipo: "porcentaje",
      descuentoValor: 10,
    })
    expect(body.ordenes).toHaveLength(3)
    expect(body.ordenes[0]).toMatchObject({
      id: "o1",
      numeroOrden: 1,
      dispositivo: "iPhone 13",
      estado: "ENTREGADO",
      costoFinal: 200,
    })

    // subtotal = 200 + 150 + 250 = 600
    expect(body.totales.subtotal).toBe(600)
    // 10% de descuento sobre 600 -> 540
    expect(body.totales.totalLote).toBe(540)
    // ENTREGADO + ENTREGADO_SIN_COBRO = 2, pendiente (RECIBIDO) = 1
    expect(body.totales.entregadas).toBe(2)
    expect(body.totales.pendientes).toBe(1)
  })
})
