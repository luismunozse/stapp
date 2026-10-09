import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, parseResponse, createPostRequest } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

import { POST } from "@/app/api/notas-credito/route"

function setup(movInsertPayloads: any[]) {
  vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { id: "nc1", numero: "NC-0001" }, error: null } as any)
  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    if (table === "ordenes_servicio") return createChainMock({ id: "o1", sucursal_id: "suc-1" }) as any
    if (table === "sesiones_caja") return createChainMock({ id: "ses-1" }) as any
    if (table === "movimientos_caja") {
      return {
        insert: vi.fn().mockImplementation((payload: any) => {
          movInsertPayloads.push(payload)
          return Promise.resolve({ data: null, error: null })
        }),
      } as any
    }
    return createChainMock(null) as any
  })
}

const body = (metodoDevolucion: string) => ({
  ordenId: "o1",
  motivo: "DEVOLUCION",
  monto: 500,
  metodoDevolucion,
})

describe("nota de crédito — egreso de caja en reembolso EFECTIVO (arqueo parte b)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("NC en EFECTIVO genera un movimiento_caja EGRESO por el monto", async () => {
    const payloads: any[] = []
    mockAuthSuccess({ role: "ADMIN" })
    setup(payloads)

    const res = await POST(createPostRequest(body("EFECTIVO"), "http://localhost/api/notas-credito"))
    expect((await parseResponse(res)).status).toBe(201)

    expect(payloads).toHaveLength(1)
    expect(payloads[0]).toMatchObject({
      tipo: "EGRESO",
      monto: 500,
      metodo_pago: "EFECTIVO",
      sucursal_id: "suc-1",
      afecta_rentabilidad: false,
      origen: "NOTA_CREDITO",
    })
  })

  it("NC en TRANSFERENCIA NO genera egreso de caja", async () => {
    const payloads: any[] = []
    mockAuthSuccess({ role: "ADMIN" })
    setup(payloads)

    await POST(createPostRequest(body("TRANSFERENCIA"), "http://localhost/api/notas-credito"))

    expect(payloads).toHaveLength(0)
  })
})

describe("POST /api/notas-credito — solo de órdenes (migración 342)", () => {
  const url = "http://localhost/api/notas-credito"
  beforeEach(() => vi.clearAllMocks())

  it("rechaza una NC de venta con 400 y no llama la RPC", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    setup([])

    const res = await POST(createPostRequest({ ventaId: "v1", motivo: "DEVOLUCION", monto: 500 }, url))
    const { status, body: json } = await parseResponse(res)

    expect(status).toBe(400)
    expect(json.error).toMatch(/devolución desde la venta/)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("el diálogo de la orden manda ventaId: null y sigue funcionando", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    setup([])

    const res = await POST(createPostRequest({
      ventaId: null, ordenId: "o1", motivo: "DEVOLUCION", monto: 500, metodoDevolucion: "TRANSFERENCIA",
    }, url))

    expect((await parseResponse(res)).status).toBe(201)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "crear_nota_credito",
      expect.objectContaining({ p_venta_id: null, p_orden_id: "o1" })
    )
  })

  it("sin orden responde 400 con un mensaje que lo explica", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    setup([])

    const res = await POST(createPostRequest({ motivo: "DEVOLUCION", monto: 500 }, url))
    const { status, body: json } = await parseResponse(res)

    expect(status).toBe(400)
    expect(json.error).toBe("La nota de crédito tiene que ser de una orden")
  })
})
