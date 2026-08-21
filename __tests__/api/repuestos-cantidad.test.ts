import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  mockAuthError,
  createChainMock,
  mockSupabaseFrom,
  parseResponse,
} from "./helpers"

import { supabaseAdmin } from "@/lib/supabase"
import { PATCH, DELETE } from "@/app/api/ordenes/[id]/repuestos/route"

function createParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

function createPatchRequest(body: any, repuestoId = "rep-1", ordenId = "o1") {
  return new Request(
    `http://localhost:3000/api/ordenes/${ordenId}/repuestos?repuestoId=${repuestoId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  )
}

function createDeleteRequest(repuestoId = "rep-1", ordenId = "o1") {
  return new Request(
    `http://localhost:3000/api/ordenes/${ordenId}/repuestos?repuestoId=${repuestoId}`,
    { method: "DELETE" }
  )
}

/** Orden de la org + repuesto perteneciente a esa orden. */
function mockOrdenYRepuesto(ordenId = "o1", repuestoOrdenId = "o1") {
  mockSupabaseFrom({
    ordenes_servicio: createChainMock({ id: ordenId }),
    repuestos_orden: createChainMock({
      id: "rep-1",
      orden_id: repuestoOrdenId,
      inventario_id: "inv-1",
      cantidad: 1,
    }),
  })
}

describe("PATCH /api/ordenes/[id]/repuestos — editar cantidad", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { success: true }, error: null } as any)
  })

  it("devuelve 401 sin autenticar", async () => {
    mockAuthError()
    const res = await PATCH(createPatchRequest({ cantidad: 2 }), createParams("o1"))
    expect((await parseResponse(res)).status).toBe(401)
  })

  it("devuelve 400 si falta repuestoId", async () => {
    mockAuthSuccess()
    const req = new Request("http://localhost:3000/api/ordenes/o1/repuestos", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cantidad: 2 }),
    })
    const res = await PATCH(req, createParams("o1"))
    expect((await parseResponse(res)).status).toBe(400)
  })

  it("rechaza cantidad menor a 1", async () => {
    mockAuthSuccess()
    mockOrdenYRepuesto()
    const res = await PATCH(createPatchRequest({ cantidad: 0 }), createParams("o1"))
    expect((await parseResponse(res)).status).toBe(400)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("devuelve 404 si la orden no es de la organización", async () => {
    mockAuthSuccess()
    mockSupabaseFrom({
      ordenes_servicio: createChainMock(null, { message: "not found" }),
    })
    const res = await PATCH(createPatchRequest({ cantidad: 2 }), createParams("o1"))
    expect((await parseResponse(res)).status).toBe(404)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("devuelve 404 si el repuesto pertenece a OTRA orden de la misma org", async () => {
    mockAuthSuccess()
    mockOrdenYRepuesto("o1", "o2")
    const res = await PATCH(createPatchRequest({ cantidad: 2 }), createParams("o1"))
    expect((await parseResponse(res)).status).toBe(404)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("llama al RPC con el delta y devuelve la cantidad nueva", async () => {
    mockAuthSuccess()
    mockOrdenYRepuesto()

    const res = await PATCH(createPatchRequest({ cantidad: 3 }), createParams("o1"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.cantidad).toBe(3)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("update_repuesto_cantidad", {
      p_repuesto_id: "rep-1",
      p_cantidad_nueva: 3,
      p_user_id: "user-1",
    })
  })

  it("traduce ORDEN_CERRADA a 409", async () => {
    mockAuthSuccess()
    mockOrdenYRepuesto()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: { error: "No se puede cambiar la cantidad en una orden cerrada", code: "ORDEN_CERRADA" },
      error: null,
    } as any)

    const res = await PATCH(createPatchRequest({ cantidad: 3 }), createParams("o1"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(409)
    expect(body.code).toBe("ORDEN_CERRADA")
  })

  it("traduce STOCK_INSUFICIENTE a 400", async () => {
    mockAuthSuccess()
    mockOrdenYRepuesto()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: { error: "Stock insuficiente. Disponible: 2", code: "STOCK_INSUFICIENTE" },
      error: null,
    } as any)

    const res = await PATCH(createPatchRequest({ cantidad: 9 }), createParams("o1"))
    expect((await parseResponse(res)).status).toBe(400)
  })
})

describe("DELETE /api/ordenes/[id]/repuestos — sigue delegando el ajuste de stock al RPC", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { success: true }, error: null } as any)
  })

  it("llama a remove_repuesto_inventario, que resuelve el caso segun el estado de la orden", async () => {
    mockAuthSuccess()
    mockOrdenYRepuesto()

    const res = await DELETE(createDeleteRequest(), createParams("o1"))
    const { status } = await parseResponse(res)

    expect(status).toBe(200)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("remove_repuesto_inventario", {
      p_repuesto_id: "rep-1",
    })
  })

  it("devuelve 404 si el repuesto es de otra orden", async () => {
    mockAuthSuccess()
    mockOrdenYRepuesto("o1", "o2")

    const res = await DELETE(createDeleteRequest(), createParams("o1"))
    expect((await parseResponse(res)).status).toBe(404)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })
})
