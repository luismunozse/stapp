import { describe, it, expect, beforeEach, vi } from "vitest"
import { mockSupabaseFrom, createChainMock } from "./helpers"
import { requireApiKey } from "@/lib/api-auth"

function reqWith(auth?: string): Request {
  const headers: Record<string, string> = {}
  if (auth) headers["Authorization"] = auth
  return new Request("http://localhost:3000/api/v1/clientes", { headers })
}

describe("requireApiKey", () => {
  beforeEach(() => vi.clearAllMocks())

  it("401 when Authorization header missing", async () => {
    const { error, organizationId } = await requireApiKey(reqWith())
    expect(error?.status).toBe(401)
    expect(organizationId).toBeNull()
  })

  it("401 when key not found", async () => {
    mockSupabaseFrom({ api_keys: createChainMock(null) })
    const { error } = await requireApiKey(reqWith("Bearer stapp_live_doesnotexist"))
    expect(error?.status).toBe(401)
  })

  it("401 when key revoked/inactive", async () => {
    mockSupabaseFrom({ api_keys: createChainMock({ id: "k1", organization_id: "org-1", activo: false, revoked_at: "2026-06-01" }) })
    const { error } = await requireApiKey(reqWith("Bearer stapp_live_x"))
    expect(error?.status).toBe(401)
  })

  it("returns organizationId for a valid active key", async () => {
    mockSupabaseFrom({ api_keys: createChainMock({ id: "k1", organization_id: "org-1", activo: true, revoked_at: null }) })
    const { error, organizationId } = await requireApiKey(reqWith("Bearer stapp_live_valid"))
    expect(error).toBeNull()
    expect(organizationId).toBe("org-1")
  })
})
