import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockAuthError, createChainMock, mockSupabaseFrom, parseResponse } from "./helpers"

vi.mock("@/lib/sucursal", () => ({
  getCookieSucursalId: vi.fn().mockResolvedValue(null),
  resolveSucursalLectura: vi.fn(() => ({ sucursalId: null, verTodas: true })),
  getDepositoDeSucursal: vi.fn().mockResolvedValue(null),
  resolverDestinoVenta: vi.fn(),
}))

import { resolverDestinoVenta } from "@/lib/sucursal"
import { POST } from "@/app/api/inventario/check-stock/route"

function req(body: unknown) {
  return new Request("http://localhost:3000/api/inventario/check-stock", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/inventario/check-stock", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 401 when not authenticated", async () => {
    mockAuthError()
    const res = await POST(req({ ids: ["a"] }))
    const { status } = await parseResponse(res)
    expect(status).toBe(401)
  })

  it("returns empty map for no ids", async () => {
    mockAuthSuccess()
    const res = await POST(req({ ids: [] }))
    const { status, body } = await parseResponse(res)
    expect(status).toBe(200)
    expect(body.stock).toEqual({})
  })

  it("returns current aggregate stock per id, missing ids → 0", async () => {
    mockAuthSuccess() // ADMIN + verTodas (mocked) → aggregate path
    mockSupabaseFrom({
      inventario: createChainMock([
        { id: "a", stock: 5 },
        { id: "b", stock: 0 },
      ]),
    })
    const res = await POST(req({ ids: ["a", "b", "c"] }))
    const { status, body } = await parseResponse(res)
    expect(status).toBe(200)
    expect(body.stock).toEqual({ a: 5, b: 0, c: 0 })
  })

  it("scope=venta: ignora verTodas (mocked true) y usa el depósito resuelto por resolverDestinoVenta", async () => {
    mockAuthSuccess({ role: "ADMIN" }) // resolveSucursalLectura sigue mockeado en "todas"
    vi.mocked(resolverDestinoVenta).mockResolvedValue({ sucursalId: "suc-1", depositoId: "dep-1" })
    mockSupabaseFrom({
      inventario_depositos: createChainMock([{ inventario_id: "a", stock: 2 }]),
    })

    const res = await POST(
      new Request("http://localhost:3000/api/inventario/check-stock?scope=venta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: ["a", "b"] }),
      })
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    // Scoped stock (2), not the aggregate value that verTodas:true would otherwise return
    expect(body.stock).toEqual({ a: 2, b: 0 })
  })
})
