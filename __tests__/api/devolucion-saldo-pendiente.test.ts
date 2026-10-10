import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, parseResponse, createPostRequest, createGetRequest } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

vi.mock("@/lib/counters", () => ({
  getNextReturnNumber: vi.fn().mockResolvedValue("DEV-000002"),
}))
const auditCreate = vi.fn().mockResolvedValue(undefined)
vi.mock("@/lib/audit", () => ({
  createAuditLogger: vi.fn(() => ({ create: auditCreate })),
}))

vi.mock("@/lib/webhooks/dispatcher", () => ({
  emitWebhookEvent: vi.fn().mockResolvedValue(undefined),
}))

import { emitWebhookEvent } from "@/lib/webhooks/dispatcher"
import { POST, GET } from "@/app/api/ventas/[id]/devolucion/route"

const params = { params: Promise.resolve({ id: "v1" }) }
const url = "http://localhost/api/ventas/v1/devolucion"
const DEV = { id: "d1", venta_id: "v1", monto_devolucion: "200", monto_aplicado_deuda: "150", items_devolucion: [] }

function setup(venta: Record<string, unknown>, egresos: any[] = []) {
  const ventas = createChainMock({ id: "v1", sucursal_id: "suc-1", ...venta })
  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    if (table === "ventas") return ventas as any
    if (table === "devoluciones_venta") return createChainMock(DEV) as any
    if (table === "sesiones_caja") return createChainMock({ id: "ses-1" }) as any
    if (table === "movimientos_caja") {
      return {
        insert: vi.fn((payload: any) => {
          egresos.push(payload)
          return Promise.resolve({ data: null, error: null })
        }),
      } as any
    }
    return createChainMock(null) as any
  })
  return ventas
}

const body = (extra: Record<string, unknown> = {}) => ({
  motivo: "No lo quiso",
  metodoReembolso: "EFECTIVO",
  items: [{ itemVentaId: "iv1", inventarioId: "otro-producto", cantidad: 1, precioUnitario: 200, restaurarStock: true }],
  ...extra,
})

describe("POST devolución — saldo pendiente, crédito en tienda e idempotencia", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN" })
  })

  it("solo saca de la caja lo que se reembolsa, no lo que descontó la deuda", async () => {
    const egresos: any[] = []
    setup({ cliente_id: "c1" }, egresos)
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: { id: "d1", tipo: "TOTAL", montoDevolucion: 200, montoAplicadoDeuda: 150, montoReembolso: 50 },
      error: null,
    } as any)

    const { status, body: dev } = await parseResponse(await POST(createPostRequest(body(), url), params))

    expect(status).toBe(201)
    expect(egresos).toHaveLength(1)
    expect(egresos[0]).toMatchObject({ tipo: "EGRESO", monto: 50 })
    expect(emitWebhookEvent).toHaveBeenCalledWith(
      "org-1",
      "venta.devolucion",
      expect.objectContaining({ ventaId: "v1", montoDevolucion: 200, montoAplicadoDeuda: 150 })
    )
    expect(dev).toMatchObject({ montoDevolucion: 200, montoAplicadoDeuda: 150, montoReembolso: 50 })
  })

  it("venta fiada devuelta entera: no hay egreso de caja", async () => {
    const egresos: any[] = []
    setup({ cliente_id: "c1" }, egresos)
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: { id: "d1", tipo: "TOTAL", montoDevolucion: 200, montoAplicadoDeuda: 200, montoReembolso: 0 },
      error: null,
    } as any)

    await POST(createPostRequest(body(), url), params)
    expect(egresos).toHaveLength(0)
  })

  it("'crédito en tienda' viaja como cuenta corriente y exige cliente", async () => {
    setup({ cliente_id: null })
    let res = await parseResponse(await POST(createPostRequest(body({ metodoReembolso: "CREDITO_TIENDA" }), url), params))
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/cliente/)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()

    setup({ cliente_id: "c1" })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { id: "d1", tipo: "PARCIAL", montoDevolucion: 200 }, error: null } as any)
    res = await parseResponse(await POST(createPostRequest(body({ metodoReembolso: "CREDITO_TIENDA" }), url), params))
    expect(res.status).toBe(201)
    expect(vi.mocked(supabaseAdmin.rpc).mock.calls[0][1]).toMatchObject({ p_metodo_reembolso: "CUENTA_CORRIENTE" })
  })

  it("manda la clave de idempotencia y un reintento no audita ni vuelve a sacar plata", async () => {
    const egresos: any[] = []
    setup({ cliente_id: "c1" }, egresos)
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: { id: "d1", tipo: "PARCIAL", montoDevolucion: 200, montoReembolso: 200, replayed: true },
      error: null,
    } as any)

    const { status } = await parseResponse(await POST(createPostRequest(body({ idempotencyKey: "k-1" }), url), params))

    expect(status).toBe(200)
    expect(vi.mocked(supabaseAdmin.rpc).mock.calls[0][1]).toMatchObject({ p_idempotency_key: "k-1" })
    expect(auditCreate).not.toHaveBeenCalled()
    expect(egresos).toHaveLength(0)
  })

  it("sin la RPC responde 503 con una sola llamada (no reintenta con la firma vieja)", async () => {
    setup({ cliente_id: "c1" })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null,
      error: { code: "PGRST202", message: "Could not find the function" },
    } as any)

    const { status } = await parseResponse(await POST(createPostRequest(body({ idempotencyKey: "k-1" }), url), params))

    expect(status).toBe(503)
    expect(vi.mocked(supabaseAdmin.rpc).mock.calls).toHaveLength(1)
    expect(auditCreate).not.toHaveBeenCalled()
  })
})

describe("GET devoluciones — alcance", () => {
  beforeEach(() => vi.clearAllMocks())

  it("un VENDEDOR solo ve devoluciones de sus ventas", async () => {
    mockAuthSuccess({ role: "VENDEDOR", userId: "vend-1" })
    const ventas = createChainMock({ id: "v1" })
    vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) =>
      table === "ventas" ? ventas : createChainMock([])) as any)
    const { status } = await parseResponse(await GET(createGetRequest(url), params))
    expect(status).toBe(200)
    expect(ventas.eq).toHaveBeenCalledWith("vendedor_id", "vend-1")
  })
})
