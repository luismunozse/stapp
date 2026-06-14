import { describe, it, expect, vi, beforeEach } from "vitest"
import { createChainMock, mockSupabaseFrom, createGetRequest } from "./helpers"

vi.mock("@/lib/superadmin-auth", () => ({
  requireSuperadmin: vi.fn().mockResolvedValue({ error: null, email: "admin@stapp.com.ar" }),
}))

import { GET } from "@/app/api/superadmin/organizations/route"

describe("GET /api/superadmin/organizations — archived filter", () => {
  beforeEach(() => vi.clearAllMocks())

  it("excludes archived orgs by default (filters deleted_at IS NULL)", async () => {
    const orgChain = createChainMock([], null, 0)
    mockSupabaseFrom({
      organizations: orgChain,
      users: createChainMock([]),
      subscriptions: createChainMock([]),
      audit_logs: createChainMock([]),
    })

    await GET(createGetRequest("http://localhost/api/superadmin/organizations"))

    expect(orgChain.is).toHaveBeenCalledWith("deleted_at", null)
  })

  it("includes archived when includeArchived=true (no deleted_at filter on list query, only on dup-detection)", async () => {
    const orgChain = createChainMock([], null, 0)
    mockSupabaseFrom({
      organizations: orgChain,
      users: createChainMock([]),
      subscriptions: createChainMock([]),
      audit_logs: createChainMock([]),
    })

    // page=2 skips KPI block; with includeArchived=true the list query skips .is("deleted_at", null),
    // but the duplicate-detection query always filters archived — so .is is called exactly once.
    await GET(createGetRequest("http://localhost/api/superadmin/organizations?includeArchived=true&page=2"))

    // The list query must NOT have added the deleted_at filter, but the dup-detection query does,
    // so .is("deleted_at", null) should be called exactly once (from the dup query, not the list).
    expect(orgChain.is).toHaveBeenCalledTimes(1)
    expect(orgChain.is).toHaveBeenCalledWith("deleted_at", null)
  })
})
