import { describe, it, expect, beforeEach, vi } from "vitest"
import { mockSupabaseFrom, createChainMock, parseResponse } from "./helpers"
import { GET } from "@/app/api/v1/clientes/route"

function reqWith(auth?: string, qs = ""): Request {
  const headers: Record<string, string> = {}
  if (auth) headers["Authorization"] = auth
  return new Request(`http://localhost:3000/api/v1/clientes${qs}`, { headers })
}

describe("GET /api/v1/clientes", () => {
  beforeEach(() => vi.clearAllMocks())

  it("401 without an API key", async () => {
    const res = await GET(reqWith())
    const { status } = await parseResponse(res)
    expect(status).toBe(401)
  })

  it("200 + org-scoped data with a valid key", async () => {
    mockSupabaseFrom({
      api_keys: createChainMock({ id: "k1", organization_id: "org-1", activo: true, revoked_at: null }),
      clientes: createChainMock([{ id: "c1", nombre: "Ana", telefono: "123" }], null, 1),
    })
    const res = await GET(reqWith("Bearer stapp_live_valid"))
    const { status, body } = await parseResponse(res)
    expect(status).toBe(200)
    expect(body.data).toHaveLength(1)
    expect(body.total).toBe(1)
    expect(body.page).toBe(1)
  })

  it("includes tipo_precio and descuento_pct in the selected columns", async () => {
    const chain = createChainMock(
      [{ id: "c1", nombre: "Ana", telefono: "123", tipo_precio: "MAYORISTA", descuento_pct: "15.00" }],
      null,
      1
    )
    mockSupabaseFrom({
      api_keys: createChainMock({ id: "k1", organization_id: "org-1", activo: true, revoked_at: null }),
      clientes: chain,
    })
    const res = await GET(reqWith("Bearer stapp_live_valid"))
    const { status, body } = await parseResponse(res)
    expect(status).toBe(200)
    expect(chain.select).toHaveBeenCalledWith(
      expect.stringContaining("tipo_precio, descuento_pct"),
      expect.anything()
    )
    expect(body.data[0].tipo_precio).toBe("MAYORISTA")
    expect(body.data[0].descuento_pct).toBe("15.00")
  })
})
