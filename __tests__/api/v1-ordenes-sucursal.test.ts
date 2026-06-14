import { describe, it, expect, beforeEach, vi } from "vitest"
import { mockSupabaseFrom, createChainMock, parseResponse } from "./helpers"
import { GET } from "@/app/api/v1/ordenes/route"

function reqWith(auth?: string, qs = ""): Request {
  const headers: Record<string, string> = {}
  if (auth) headers["Authorization"] = auth
  return new Request(`http://localhost:3000/api/v1/ordenes${qs}`, { headers })
}

const validKey = { id: "k1", organization_id: "org-1", activo: true, revoked_at: null }

describe("GET /api/v1/ordenes — sucursal scoping", () => {
  beforeEach(() => vi.clearAllMocks())

  it("401 without an API key", async () => {
    const res = await GET(reqWith())
    const { status } = await parseResponse(res)
    expect(status).toBe(401)
  })

  it("omitted sucursal_id → org-wide (no branch filter applied)", async () => {
    const ordenesChain = createChainMock([{ id: "o1" }], null, 1)
    mockSupabaseFrom({
      api_keys: createChainMock(validKey),
      ordenes_servicio: ordenesChain,
    })
    const res = await GET(reqWith("Bearer stapp_live_valid"))
    const { status, body } = await parseResponse(res)
    expect(status).toBe(200)
    expect(body.total).toBe(1)
    // no sucursal_id filter applied
    const eqCalls = ordenesChain.eq.mock.calls.map((c: any[]) => c[0])
    expect(eqCalls).not.toContain("sucursal_id")
  })

  it("valid sucursal_id (belongs to org) → branch filter applied", async () => {
    const ordenesChain = createChainMock([{ id: "o1" }], null, 1)
    mockSupabaseFrom({
      api_keys: createChainMock(validKey),
      // assertSucursalEnOrg uses .single() → returns a row = belongs
      sucursales: createChainMock({ id: "suc-1" }),
      ordenes_servicio: ordenesChain,
    })
    const res = await GET(reqWith("Bearer stapp_live_valid", "?sucursal_id=suc-1"))
    const { status } = await parseResponse(res)
    expect(status).toBe(200)
    const eqCalls = ordenesChain.eq.mock.calls.map((c: any[]) => c)
    expect(eqCalls).toContainEqual(["sucursal_id", "suc-1"])
  })

  it("cross-org sucursal_id (not in org) → 404, no data leaked", async () => {
    const ordenesChain = createChainMock([{ id: "o1" }], null, 1)
    mockSupabaseFrom({
      api_keys: createChainMock(validKey),
      // assertSucursalEnOrg .single() → null = does not belong
      sucursales: createChainMock(null),
      ordenes_servicio: ordenesChain,
    })
    const res = await GET(reqWith("Bearer stapp_live_valid", "?sucursal_id=suc-foreign"))
    const { status, body } = await parseResponse(res)
    expect(status).toBe(404)
    expect(body.data).toBeUndefined()
    // ordenes query never ran with the foreign branch
    expect(ordenesChain.eq).not.toHaveBeenCalledWith("sucursal_id", "suc-foreign")
  })
})
