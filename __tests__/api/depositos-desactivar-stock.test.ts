/**
 * Un deposito inactivo no puede ser origen de transferencia, asi que
 * desactivarlo con stock deja unidades inalcanzables que igual suman al total.
 * PUT aplica el mismo chequeo que DELETE en la transicion activo -> inactivo.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, parseResponse } from "./helpers"

import { PUT } from "@/app/api/depositos/[id]/route"

const ctx = { params: Promise.resolve({ id: "dep-1" }) }
const putReq = (body: unknown) =>
  new Request("http://localhost:3000/api/depositos/dep-1", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

const filaDb = {
  id: "dep-1",
  nombre: "Norte",
  principal: false,
  activo: true,
  sucursal_id: "suc-B",
}

describe("PUT /api/depositos/[id] — desactivar con stock", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
  })

  it("rechaza con 409 HAS_STOCK y NO actualiza cuando hay stock", async () => {
    const depositos = createChainMock(filaDb)
    const stock = createChainMock([], null, 3)
    mockSupabaseFrom({ depositos, inventario_depositos: stock })

    const { status, body } = await parseResponse(await PUT(putReq({ activo: false }), ctx))

    expect(status).toBe(409)
    expect(body.code).toBe("HAS_STOCK")
    expect(body.error).toMatch(/transfer/i)
    expect(depositos.update).not.toHaveBeenCalled()
    expect(stock.eq).toHaveBeenCalledWith("deposito_id", "dep-1")
    expect(stock.eq).toHaveBeenCalledWith("organization_id", "org-1")
  })

  it("desactiva cuando no hay stock", async () => {
    const depositos = createChainMock(filaDb)
    mockSupabaseFrom({ depositos, inventario_depositos: createChainMock([], null, 0) })

    const res = await PUT(putReq({ activo: false }), ctx)

    expect(res.status).toBe(200)
    expect(depositos.update).toHaveBeenCalledWith({ activo: false })
  })

  it("no consulta stock si no es una desactivacion (editar nombre)", async () => {
    const stock = createChainMock([], null, 5)
    mockSupabaseFrom({ depositos: createChainMock(filaDb), inventario_depositos: stock })

    const res = await PUT(putReq({ nombre: "Norte 2" }), ctx)

    expect(res.status).toBe(200)
    expect(stock.select).not.toHaveBeenCalled()
  })

  it("no consulta stock al reactivar un deposito inactivo", async () => {
    const stock = createChainMock([], null, 5)
    mockSupabaseFrom({
      depositos: createChainMock({ ...filaDb, activo: false }),
      inventario_depositos: stock,
    })

    const res = await PUT(putReq({ activo: true }), ctx)

    expect(res.status).toBe(200)
    expect(stock.select).not.toHaveBeenCalled()
  })
})
