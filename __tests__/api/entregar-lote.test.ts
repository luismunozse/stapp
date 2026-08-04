/**
 * POST /api/recepciones/[id]/entregar — entrega atomica de lote con cobro
 * prorateado.
 *
 * Mismo mock style que Tasks 3-4 (recepcion-descuento.test.ts,
 * recepcion-multiple-atomica.test.ts): se mockea supabaseAdmin.rpc para
 * capturar los argumentos exactos que la ruta le pasa a
 * entregar_lote_recepcion (migracion 290).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, createPostRequest, parseResponse } from "./helpers"

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn(),
}))

import { supabaseAdmin } from "@/lib/supabase"
import { hasPlanFeature } from "@/lib/subscriptions"
import { POST } from "@/app/api/recepciones/[id]/entregar/route"

function createParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

function createMockRecepcion(overrides: Record<string, any> = {}) {
  return {
    id: "rec-1",
    descuento_tipo: null,
    descuento_valor: null,
    ...overrides,
  }
}

const ordenesBody = [
  { id: "o1", costoFinal: 100 },
  { id: "o2", costoFinal: 200 },
  { id: "o3", costoFinal: 300 },
]

function entregarRequest(body: any) {
  return createPostRequest(body, "http://localhost:3000/api/recepciones/rec-1/entregar")
}

const rpcOk = {
  recepcionId: "rec-1",
  ordenes: [
    { id: "o1", numeroOrden: 1, montoCobrado: 90 },
    { id: "o2", numeroOrden: 2, montoCobrado: 180 },
    { id: "o3", numeroOrden: 3, montoCobrado: 270 },
  ],
}

describe("POST /api/recepciones/[id]/entregar — entrega y cobro de lote", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess()
    vi.mocked(hasPlanFeature).mockResolvedValue(true)
    mockSupabaseFrom({
      recepciones: createChainMock(createMockRecepcion()),
    })
  })

  it("devuelve 403 FEATURE_REQUIRED cuando el plan no tiene la feature", async () => {
    vi.mocked(hasPlanFeature).mockResolvedValue(false)

    const res = await POST(entregarRequest({ ordenes: ordenesBody, metodoPago: "EFECTIVO" }), createParams("rec-1"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(403)
    expect(body.code).toBe("FEATURE_REQUIRED")
    expect(body.feature).toBe("recepcion_multiple")
  })

  it("devuelve 403 cuando el rol no es ADMIN", async () => {
    mockAuthSuccess({ role: "VENDEDOR" })

    const res = await POST(entregarRequest({ ordenes: ordenesBody, metodoPago: "EFECTIVO" }), createParams("rec-1"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(403)
    expect(body.error).toBeTruthy()
  })

  it("devuelve 400 cuando ordenes viene vacio", async () => {
    const res = await POST(entregarRequest({ ordenes: [], metodoPago: "EFECTIVO" }), createParams("rec-1"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body.error).toBeTruthy()
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("devuelve 400 cuando costoFinal es negativo", async () => {
    const res = await POST(
      entregarRequest({ ordenes: [{ id: "o1", costoFinal: -1 }], metodoPago: "EFECTIVO" }),
      createParams("rec-1"),
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body.error).toBeTruthy()
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("devuelve 400 cuando metodoPago no es valido", async () => {
    const res = await POST(
      entregarRequest({ ordenes: ordenesBody, metodoPago: "CUENTA_CORRIENTE" }),
      createParams("rec-1"),
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body.error).toBeTruthy()
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("devuelve 409 cuando una orden del lote no esta REPARADA (LOTE_ERROR:ORDEN_NO_REPARADA)", async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null,
      error: { message: "LOTE_ERROR:ORDEN_NO_REPARADA:o1:PRESUPUESTADO" },
    } as any)

    const res = await POST(entregarRequest({ ordenes: ordenesBody, metodoPago: "EFECTIVO" }), createParams("rec-1"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(409)
    expect(body.error).toBeTruthy()
  })

  it("prorratea el descuento de 10% y llama a la RPC con los shares y el total exactos", async () => {
    mockSupabaseFrom({
      recepciones: createChainMock(createMockRecepcion({ descuento_tipo: "porcentaje", descuento_valor: 10 })),
    })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: rpcOk, error: null } as any)

    const res = await POST(entregarRequest({ ordenes: ordenesBody, metodoPago: "EFECTIVO" }), createParams("rec-1"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(supabaseAdmin.rpc).toHaveBeenCalledTimes(1)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("entregar_lote_recepcion", {
      p_organization_id: "org-1",
      p_recepcion_id: "rec-1",
      p_usuario_id: "user-1",
      p_ordenes: [
        { id: "o1", costoFinal: 100, montoCobro: 90 },
        { id: "o2", costoFinal: 200, montoCobro: 180 },
        { id: "o3", costoFinal: 300, montoCobro: 270 },
      ],
      p_metodo_pago: "EFECTIVO",
      p_referencia: null,
      p_observaciones: null,
      p_idempotency_key: null,
    })
    expect(body.totalCobrado).toBe(540)
    expect(body.recepcionId).toBe("rec-1")
    expect(body.ordenes).toEqual(rpcOk.ordenes)
  })

  it("cuando el descuento supera el subtotal, los shares son todos 0 pero la RPC igual se llama (entrega sin cobro)", async () => {
    mockSupabaseFrom({
      recepciones: createChainMock(createMockRecepcion({ descuento_tipo: "monto", descuento_valor: 10000 })),
    })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: {
        recepcionId: "rec-1",
        ordenes: [
          { id: "o1", numeroOrden: 1, montoCobrado: 0 },
          { id: "o2", numeroOrden: 2, montoCobrado: 0 },
          { id: "o3", numeroOrden: 3, montoCobrado: 0 },
        ],
      },
      error: null,
    } as any)

    const res = await POST(entregarRequest({ ordenes: ordenesBody, metodoPago: "EFECTIVO" }), createParams("rec-1"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(supabaseAdmin.rpc).toHaveBeenCalledTimes(1)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "entregar_lote_recepcion",
      expect.objectContaining({
        p_ordenes: [
          { id: "o1", costoFinal: 100, montoCobro: 0 },
          { id: "o2", costoFinal: 200, montoCobro: 0 },
          { id: "o3", costoFinal: 300, montoCobro: 0 },
        ],
      }),
    )
    expect(body.totalCobrado).toBe(0)
  })

  it("mapea LOTE_ERROR:COBRO_EXCEDE_PENDIENTE a 409 con el mensaje de pagos previos", async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null,
      error: { message: "LOTE_ERROR:COBRO_EXCEDE_PENDIENTE:o2" },
    } as any)

    const res = await POST(entregarRequest({ ordenes: ordenesBody, metodoPago: "EFECTIVO" }), createParams("rec-1"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(409)
    expect(body.error).toContain("Entregalo individualmente")
  })

  it("mapea LOTE_ERROR:COSTO_FINAL_INVALIDO a 400", async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null,
      error: { message: "LOTE_ERROR:COSTO_FINAL_INVALIDO:o1" },
    } as any)

    const res = await POST(entregarRequest({ ordenes: ordenesBody, metodoPago: "EFECTIVO" }), createParams("rec-1"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body.error).toBeTruthy()
  })

  it("mapea LOTE_ERROR:ORDEN_FUERA_DE_LOTE a 404 con el mensaje de lote", async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null,
      error: { message: "LOTE_ERROR:ORDEN_FUERA_DE_LOTE:o9" },
    } as any)

    const res = await POST(entregarRequest({ ordenes: ordenesBody, metodoPago: "EFECTIVO" }), createParams("rec-1"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(404)
    expect(body.error).toContain("no pertenece a este lote")
  })

  it("devuelve 404 cuando la recepcion no existe (PGRST116)", async () => {
    mockSupabaseFrom({
      recepciones: createChainMock(null, { code: "PGRST116", message: "not found" }),
    })

    const res = await POST(entregarRequest({ ordenes: ordenesBody, metodoPago: "EFECTIVO" }), createParams("rec-1"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(404)
    expect(body.error).toBeTruthy()
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("devuelve 500 cuando la consulta de recepcion falla por un error real de DB (no not-found)", async () => {
    mockSupabaseFrom({
      recepciones: createChainMock(null, { code: "500", message: "connection reset" }),
    })

    const res = await POST(entregarRequest({ ordenes: ordenesBody, metodoPago: "EFECTIVO" }), createParams("rec-1"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(500)
    expect(body.error).toBeTruthy()
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })
})
