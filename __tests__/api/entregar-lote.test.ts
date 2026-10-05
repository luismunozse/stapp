/**
 * POST /api/recepciones/[id]/entregar — entrega atomica de lote con cobro
 * prorateado.
 *
 * Mismo mock style que Tasks 3-4 (recepcion-descuento.test.ts,
 * recepcion-multiple-atomica.test.ts): se mockea supabaseAdmin.rpc para
 * capturar los argumentos exactos que la ruta le pasa a
 * entregar_lote_recepcion (migracion 294).
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

/** Los 3 miembros del payload, todos pendientes y reparados (caso base). */
const miembrosReparados = [
  { id: "o1", estado: "REPARADO", costo_final: null, descuento_cobro: null },
  { id: "o2", estado: "REPARADO", costo_final: null, descuento_cobro: null },
  { id: "o3", estado: "REPARADO", costo_final: null, descuento_cobro: null },
]

function mockTables(recepcion: Record<string, any> = {}, miembros: any[] = miembrosReparados) {
  mockSupabaseFrom({
    recepciones: createChainMock(createMockRecepcion(recepcion)),
    ordenes_servicio: createChainMock(miembros),
  })
}

/**
 * La ruta llama a DOS RPCs distintas: entregar_lote_recepcion (transaccion) y
 * consumir_reservas_orden (una por orden entregada, best-effort). Un
 * mockResolvedValue plano devolveria el payload del lote tambien al consumo de
 * stock y dispararia warnings falsos, asi que se despacha por nombre.
 */
function mockRpc(opts: { lote?: any; consumo?: any } = {}) {
  const lote = opts.lote ?? { data: rpcOk, error: null }
  const consumo = opts.consumo ?? { data: { success: true }, error: null }
  vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) =>
    Promise.resolve(fn === "entregar_lote_recepcion" ? lote : consumo)) as any)
}

function loteCalls() {
  return vi.mocked(supabaseAdmin.rpc).mock.calls.filter(([fn]) => fn === "entregar_lote_recepcion")
}

function consumoCalls() {
  return vi.mocked(supabaseAdmin.rpc).mock.calls.filter(([fn]) => fn === "consumir_reservas_orden")
}

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
    mockTables()
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
    mockRpc({ lote: { data: null, error: { message: "LOTE_ERROR:ORDEN_NO_REPARADA:o1:PRESUPUESTADO" } } })

    const res = await POST(entregarRequest({ ordenes: ordenesBody, metodoPago: "EFECTIVO" }), createParams("rec-1"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(409)
    expect(body.error).toBeTruthy()
  })

  it("prorratea el descuento de 10% y llama a la RPC con los shares y el total exactos", async () => {
    mockTables({ descuento_tipo: "porcentaje", descuento_valor: 10 })
    mockRpc()

    const res = await POST(entregarRequest({ ordenes: ordenesBody, metodoPago: "EFECTIVO" }), createParams("rec-1"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(loteCalls()).toHaveLength(1)
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
    // Sin miembros entregados antes, la liquidacion se reduce al caso simple:
    // total del lote = lo que se cobra ahora, nada cobrado previamente.
    expect(body.totalLote).toBe(540)
    expect(body.yaCobrado).toBe(0)
    expect(body.recepcionId).toBe("rec-1")
    expect(body.ordenes).toEqual(rpcOk.ordenes)
  })

  it("calcula el total del lote sobre TODOS los miembros y descuenta lo ya cobrado en los entregados individualmente", async () => {
    // 2 miembros ya entregados por el flujo individual (que cobra el precio
    // individual completo, es batch-unaware) + 3 pendientes en el payload.
    mockTables({ descuento_tipo: "porcentaje", descuento_valor: 10 }, [
      { id: "prev-1", estado: "ENTREGADO", costo_final: 200, descuento_cobro: 20 },
      { id: "prev-2", estado: "ENTREGADO_SIN_COBRO", costo_final: 100, descuento_cobro: null },
      ...miembrosReparados,
    ])
    mockRpc()

    const res = await POST(entregarRequest({ ordenes: ordenesBody, metodoPago: "EFECTIVO" }), createParams("rec-1"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    // subtotal del lote = 200 + 100 (entregados, persistido) + 600 (payload) = 900
    // total del lote = 900 - 10% = 810
    // ya cobrado neto = (200-20) + (100-0) = 280
    // restante = 810 - 280 = 530, prorrateado sobre [100, 200, 300]
    expect(body.totalLote).toBe(810)
    expect(body.yaCobrado).toBe(280)
    expect(body.totalCobrado).toBe(530)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "entregar_lote_recepcion",
      expect.objectContaining({
        p_ordenes: [
          { id: "o1", costoFinal: 100, montoCobro: 88.33 },
          { id: "o2", costoFinal: 200, montoCobro: 176.67 },
          { id: "o3", costoFinal: 300, montoCobro: 265 },
        ],
      }),
    )
  })

  it("no cobra nada cuando lo ya cobrado en los entregados supera el total del lote", async () => {
    mockTables({ descuento_tipo: "monto", descuento_valor: 500 }, [
      { id: "prev-1", estado: "ENTREGADO", costo_final: 900, descuento_cobro: 0 },
      ...miembrosReparados,
    ])
    mockRpc()

    const res = await POST(entregarRequest({ ordenes: ordenesBody, metodoPago: "EFECTIVO" }), createParams("rec-1"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    // subtotal 900 + 600 = 1500, total 1000, ya cobrado 900 -> restante 100
    expect(body.totalLote).toBe(1000)
    expect(body.yaCobrado).toBe(900)
    expect(body.totalCobrado).toBe(100)
  })

  it("devuelve 409 cuando el payload no cubre a todos los miembros elegibles pendientes", async () => {
    mockRpc()

    const res = await POST(
      entregarRequest({ ordenes: [{ id: "o1", costoFinal: 100 }], metodoPago: "EFECTIVO" }),
      createParams("rec-1"),
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(409)
    expect(body.error).toMatch(/reparados/i)
    expect(loteCalls()).toHaveLength(0)
  })

  it("devuelve 409 cuando el payload incluye un miembro excluido del lote (CANCELADO)", async () => {
    mockTables({}, [
      ...miembrosReparados,
      { id: "o4", estado: "CANCELADO", costo_final: null, descuento_cobro: null },
    ])
    mockRpc()

    const res = await POST(
      entregarRequest({ ordenes: [...ordenesBody, { id: "o4", costoFinal: 50 }], metodoPago: "EFECTIVO" }),
      createParams("rec-1"),
    )
    const { status } = await parseResponse(res)

    expect(status).toBe(409)
    expect(loteCalls()).toHaveLength(0)
  })

  it("ignora a los miembros excluidos (CANCELADO / SIN_REPARACION) al exigir cobertura del payload", async () => {
    mockTables({}, [
      ...miembrosReparados,
      { id: "o4", estado: "CANCELADO", costo_final: null, descuento_cobro: null },
      { id: "o5", estado: "SIN_REPARACION", costo_final: null, descuento_cobro: null },
      { id: "o6", estado: "SIN_FALLA_DETECTADA", costo_final: null, descuento_cobro: null },
    ])
    mockRpc()

    const res = await POST(entregarRequest({ ordenes: ordenesBody, metodoPago: "EFECTIVO" }), createParams("rec-1"))
    const { status } = await parseResponse(res)

    expect(status).toBe(200)
    expect(loteCalls()).toHaveLength(1)
  })

  it("consume las reservas de stock de cada orden entregada", async () => {
    mockRpc()

    const res = await POST(entregarRequest({ ordenes: ordenesBody, metodoPago: "EFECTIVO" }), createParams("rec-1"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(consumoCalls()).toHaveLength(3)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("consumir_reservas_orden", {
      p_orden_id: "o1",
      p_user_id: "user-1",
    })
    expect(body.warnings).toEqual([])
  })

  it("no cancela la entrega cuando el consumo de reservas falla: devuelve warnings", async () => {
    mockRpc({
      consumo: { data: null, error: { code: "P0010", message: "STOCK_INSUFICIENTE_DEPOSITO" } },
    })

    const res = await POST(entregarRequest({ ordenes: ordenesBody, metodoPago: "EFECTIVO" }), createParams("rec-1"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.warnings).toHaveLength(3)
    expect(body.warnings[0]).toMatch(/stock/i)
  })

  it("cuando el descuento supera el subtotal, los shares son todos 0 pero la RPC igual se llama (entrega sin cobro)", async () => {
    mockTables({ descuento_tipo: "monto", descuento_valor: 10000 })
    mockRpc({
      lote: {
        data: {
          recepcionId: "rec-1",
          ordenes: [
            { id: "o1", numeroOrden: 1, montoCobrado: 0 },
            { id: "o2", numeroOrden: 2, montoCobrado: 0 },
            { id: "o3", numeroOrden: 3, montoCobrado: 0 },
          ],
        },
        error: null,
      },
    })

    const res = await POST(entregarRequest({ ordenes: ordenesBody, metodoPago: "EFECTIVO" }), createParams("rec-1"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(loteCalls()).toHaveLength(1)
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
    mockRpc({ lote: { data: null, error: { message: "LOTE_ERROR:COBRO_EXCEDE_PENDIENTE:o2" } } })

    const res = await POST(entregarRequest({ ordenes: ordenesBody, metodoPago: "EFECTIVO" }), createParams("rec-1"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(409)
    expect(body.error).toContain("Entregalo individualmente")
  })

  it("mapea LOTE_ERROR:COSTO_FINAL_INVALIDO a 400", async () => {
    mockRpc({ lote: { data: null, error: { message: "LOTE_ERROR:COSTO_FINAL_INVALIDO:o1" } } })

    const res = await POST(entregarRequest({ ordenes: ordenesBody, metodoPago: "EFECTIVO" }), createParams("rec-1"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body.error).toBeTruthy()
  })

  it("mapea LOTE_ERROR:ORDEN_FUERA_DE_LOTE a 404 con el mensaje de lote", async () => {
    mockRpc({ lote: { data: null, error: { message: "LOTE_ERROR:ORDEN_FUERA_DE_LOTE:o9" } } })

    const res = await POST(entregarRequest({ ordenes: ordenesBody, metodoPago: "EFECTIVO" }), createParams("rec-1"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(404)
    expect(body.error).toContain("no pertenece a este lote")
  })

  it("deja que la RPC resuelva un id que no es miembro del lote (404, no 409)", async () => {
    // El id extra no pertenece a la recepcion: la validacion temprana no lo
    // reclama como "no reparado" — lo resuelve la RPC con ORDEN_FUERA_DE_LOTE.
    mockRpc({ lote: { data: null, error: { message: "LOTE_ERROR:ORDEN_FUERA_DE_LOTE:o9" } } })

    const res = await POST(
      entregarRequest({ ordenes: [...ordenesBody, { id: "o9", costoFinal: 10 }], metodoPago: "EFECTIVO" }),
      createParams("rec-1"),
    )
    const { status } = await parseResponse(res)

    expect(status).toBe(404)
    expect(loteCalls()).toHaveLength(1)
  })

  it("devuelve 404 cuando la recepcion no existe (PGRST116)", async () => {
    mockSupabaseFrom({
      recepciones: createChainMock(null, { code: "PGRST116", message: "not found" }),
      ordenes_servicio: createChainMock(miembrosReparados),
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
      ordenes_servicio: createChainMock(miembrosReparados),
    })

    const res = await POST(entregarRequest({ ordenes: ordenesBody, metodoPago: "EFECTIVO" }), createParams("rec-1"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(500)
    expect(body.error).toBeTruthy()
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("devuelve 500 (no un cobro sobre un lote vacio) cuando la consulta de miembros falla", async () => {
    mockSupabaseFrom({
      recepciones: createChainMock(createMockRecepcion()),
      ordenes_servicio: createChainMock(null, { message: "connection reset" }),
    })

    const res = await POST(entregarRequest({ ordenes: ordenesBody, metodoPago: "EFECTIVO" }), createParams("rec-1"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(500)
    expect(body.error).toBeTruthy()
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })
})
