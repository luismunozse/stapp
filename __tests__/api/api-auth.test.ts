import { describe, it, expect, beforeEach, vi } from "vitest"
import { mockSupabaseFrom, createChainMock } from "./helpers"

vi.mock("@/lib/subscriptions", () => ({
  hasValidAccess: vi.fn(),
}))

import { hasValidAccess } from "@/lib/subscriptions"
import { requireApiKey } from "@/lib/api-auth"

function reqWith(auth?: string): Request {
  const headers: Record<string, string> = {}
  if (auth) headers["Authorization"] = auth
  return new Request("http://localhost:3000/api/v1/clientes", { headers })
}

const KEY_ACTIVA = { id: "k1", organization_id: "org-1", activo: true, revoked_at: null }

function conOrg(org: Record<string, unknown> | null) {
  const apiKeys = createChainMock(KEY_ACTIVA)
  mockSupabaseFrom({ api_keys: apiKeys, organizations: createChainMock(org) })
  return apiKeys
}

describe("requireApiKey", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(hasValidAccess).mockResolvedValue({ hasAccess: true })
  })

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
    conOrg({ id: "org-1", activo: true, deleted_at: null })
    const { error, organizationId } = await requireApiKey(reqWith("Bearer stapp_live_valid"))
    expect(error).toBeNull()
    expect(organizationId).toBe("org-1")
  })

  it("403 when the organization was deactivated", async () => {
    conOrg({ id: "org-1", activo: false, deleted_at: null })
    const { error, organizationId } = await requireApiKey(reqWith("Bearer stapp_live_valid"))
    expect(error?.status).toBe(403)
    expect(organizationId).toBeNull()
  })

  it("403 when the organization was deleted", async () => {
    conOrg({ id: "org-1", activo: true, deleted_at: "2026-11-01T00:00:00Z" })
    const { error } = await requireApiKey(reqWith("Bearer stapp_live_valid"))
    expect(error?.status).toBe(403)
  })

  it("403 when the organization row is missing", async () => {
    conOrg(null)
    const { error } = await requireApiKey(reqWith("Bearer stapp_live_valid"))
    expect(error?.status).toBe(403)
  })

  it("403 when the subscription is canceled or past due", async () => {
    vi.mocked(hasValidAccess).mockResolvedValue({ hasAccess: false, reason: "canceled" })
    const apiKeys = conOrg({ id: "org-1", activo: true, deleted_at: null })
    const { error, organizationId } = await requireApiKey(reqWith("Bearer stapp_live_valid"))
    expect(error?.status).toBe(403)
    expect(organizationId).toBeNull()
    expect(hasValidAccess).toHaveBeenCalledWith("org-1")
    expect(apiKeys.update).not.toHaveBeenCalled()
  })
})
