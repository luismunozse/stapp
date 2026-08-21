import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockAuthError, createChainMock, mockSupabaseFrom, parseResponse } from "./helpers"

// Only the async/DB-backed resolvers are stubbed; derivarLecturaVenta stays
// real so this suite exercises the shared read-scope derivation.
vi.mock("@/lib/sucursal", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/sucursal")>()),
  getCookieSucursalId: vi.fn().mockResolvedValue(null),
  resolveSucursalLectura: vi.fn(() => ({ sucursalId: null, verTodas: true })),
  getDepositoDeSucursal: vi.fn().mockResolvedValue(null),
  resolverDestinoVentaCacheado: vi.fn(),
}))

import { resolverDestinoVentaCacheado } from "@/lib/sucursal"
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

  it("scope=venta: ignora verTodas (mocked true) y usa el depósito resuelto por resolverDestinoVentaCacheado", async () => {
    mockAuthSuccess({ role: "ADMIN" }) // resolveSucursalLectura sigue mockeado en "todas"
    vi.mocked(resolverDestinoVentaCacheado).mockResolvedValue({ sucursalId: "suc-1", depositoId: "dep-1", unassignedSucursal: false, branchScoped: false })
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

  it("scope=venta en modo drenaje (sucursal sin depósito): reporta el stock agregado, no 0", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    // Sucursal resolved but no principal deposito: the write path passes
    // p_deposito_id = null and drains org-wide, so the sale WOULD succeed.
    vi.mocked(resolverDestinoVentaCacheado).mockResolvedValue({ sucursalId: "suc-1", depositoId: null, unassignedSucursal: false, branchScoped: false })
    mockSupabaseFrom({
      inventario: createChainMock([{ id: "a", stock: 4 }]),
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
    expect(body.stock).toEqual({ a: 4, b: 0 })
  })

  it("scope=venta con usuario sin sucursal asignada: sigue fail-closed (todo en 0)", async () => {
    mockAuthSuccess({ role: "VENDEDOR" })
    // The write path still falls back to the principal sucursal/deposito, but
    // a non-ADMIN with no assigned sucursal must keep reading nothing.
    vi.mocked(resolverDestinoVentaCacheado).mockResolvedValue({
      sucursalId: "suc-principal",
      depositoId: "dep-principal",
      unassignedSucursal: true,
      branchScoped: true,
    })
    const invChain = createChainMock([{ id: "a", stock: 9 }])
    const depChain = createChainMock([{ inventario_id: "a", stock: 6 }])
    mockSupabaseFrom({ inventario: invChain, inventario_depositos: depChain })

    const res = await POST(
      new Request("http://localhost:3000/api/inventario/check-stock?scope=venta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: ["a", "b"] }),
      })
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.stock).toEqual({ a: 0, b: 0 })
    expect(invChain.select).not.toHaveBeenCalled()
    expect(depChain.select).not.toHaveBeenCalled()
  })

  it.each(["VENDEDOR", "TECNICO"])(
    "scope=venta con %s cuya sucursal no tiene depósito: fail-closed (todo en 0), NO el agregado de la org",
    async (role) => {
      mockAuthSuccess({ role })
      vi.mocked(resolverDestinoVentaCacheado).mockResolvedValue({
        sucursalId: "suc-B",
        depositoId: null,
        unassignedSucursal: false,
        branchScoped: true,
      })
      const invChain = createChainMock([{ id: "a", stock: 9 }])
      mockSupabaseFrom({ inventario: invChain })

      const res = await POST(
        new Request("http://localhost:3000/api/inventario/check-stock?scope=venta", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: ["a", "b"] }),
        })
      )
      const { status, body } = await parseResponse(res)

      expect(status).toBe(200)
      // The aggregate would green-light a checkout backed by another branch's units.
      expect(body.stock).toEqual({ a: 0, b: 0 })
      expect(invChain.select).not.toHaveBeenCalled()
    }
  )
})
