import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, parseResponse } from "./helpers"

import { DELETE } from "@/app/api/depositos/[id]/route"

const ctx = { params: Promise.resolve({ id: "dep-1" }) }
const req = () => new Request("http://localhost:3000/api/depositos/dep-1", { method: "DELETE" })

describe("DELETE /api/depositos/[id] — conteo de stock acotado a la org", () => {
  beforeEach(() => vi.clearAllMocks())

  it("cuenta el stock solo de la org del admin (filas ajenas no bloquean el archivado)", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const stock = createChainMock([], null, 0)
    const depositos = createChainMock({ id: "dep-1", principal: false })
    mockSupabaseFrom({ depositos, inventario_depositos: stock })

    const { status } = await parseResponse(await DELETE(req(), ctx))

    expect(status).toBe(200)
    expect(stock.eq).toHaveBeenCalledWith("deposito_id", "dep-1")
    expect(stock.eq).toHaveBeenCalledWith("organization_id", "org-1")
  })

  it("sigue bloqueando con 409 cuando hay stock propio", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const stock = createChainMock([], null, 2)
    mockSupabaseFrom({
      depositos: createChainMock({ id: "dep-1", principal: false }),
      inventario_depositos: stock,
    })

    const { status, body } = await parseResponse(await DELETE(req(), ctx))

    expect(status).toBe(409)
    expect(body.code).toBe("HAS_STOCK")
  })
})
