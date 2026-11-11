import { describe, it, expect, vi, beforeEach } from "vitest"
import { createChainMock, mockSupabaseFrom, parseResponse } from "./helpers"

vi.mock("@/lib/superadmin-auth", () => ({
  requireSuperadmin: vi.fn().mockResolvedValue({ error: null, email: "admin@stapp.com.ar" }),
}))

import { POST } from "@/app/api/superadmin/organizations/bulk-delete/route"

// Los ids de organizations son cuid (TEXT), no UUID: los tests usan ids reales de ese formato.
const O1 = "cmabc123def456ghi789jkl0"
const O2 = "cmxyz987wvu654tsr321qpo0"

function postJson(body: unknown): Request {
  return new Request("http://localhost/api/superadmin/organizations/bulk-delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST bulk-delete — archive by default", () => {
  beforeEach(() => vi.clearAllMocks())

  it("archives the given orgs (update with deleted_at), not CASCADE delete", async () => {
    const updateChain = createChainMock(null, null)
    const orgRouter = {
      ...createChainMock([{ id: O1, slug: "a" }, { id: O2, slug: "b" }]),
      update: vi.fn().mockReturnValue(updateChain),
      delete: vi.fn().mockReturnValue(createChainMock(null, null)),
    }
    mockSupabaseFrom({ organizations: orgRouter as any, audit_logs: createChainMock(null, null) })

    const res = await POST(postJson({ ids: [O1, O2] }))
    const { status } = await parseResponse(res)

    expect(status).toBe(200)
    expect(orgRouter.update).toHaveBeenCalled()
    expect(orgRouter.delete).not.toHaveBeenCalled()
  })

  it("returns 200 with archived count in response", async () => {
    const updateChain = createChainMock(null, null)
    const orgRouter = {
      ...createChainMock([{ id: O1, slug: "a" }, { id: O2, slug: "b" }]),
      update: vi.fn().mockReturnValue(updateChain),
      delete: vi.fn().mockReturnValue(createChainMock(null, null)),
    }
    mockSupabaseFrom({ organizations: orgRouter as any, audit_logs: createChainMock(null, null) })

    const res = await POST(postJson({ ids: [O1, O2] }))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(typeof body.archived).toBe("number")
  })

  it.each([
    ["hard=true AND confirm=true", { hard: true, confirm: true }],
    ["hard=true alone", { hard: true }],
  ])("rejects %s: permanent purge is one org at a time, from its detail", async (_caso, extra) => {
    const orgRouter = {
      ...createChainMock([{ id: O1, slug: "a" }, { id: O2, slug: "b" }]),
      update: vi.fn().mockReturnValue(createChainMock(null, null)),
      delete: vi.fn().mockReturnValue(createChainMock(null, null, 2)),
    }
    mockSupabaseFrom({ organizations: orgRouter as any, audit_logs: createChainMock(null, null) })

    const res = await POST(postJson({ ids: [O1, O2], ...extra }))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body.error).toMatch(/de a una organización/)
    expect(orgRouter.delete).not.toHaveBeenCalled()
    expect(orgRouter.update).not.toHaveBeenCalled()
  })

  it("rejects empty ids and batches over the cap", async () => {
    const orgRouter = {
      ...createChainMock([]),
      update: vi.fn().mockReturnValue(createChainMock(null, null)),
      delete: vi.fn().mockReturnValue(createChainMock(null, null)),
    }
    mockSupabaseFrom({ organizations: orgRouter as any, audit_logs: createChainMock(null, null) })

    expect((await POST(postJson({ ids: ["  "] }))).status).toBe(400)
    const muchos = Array.from({ length: 101 }, (_, i) => `cm${String(i).padStart(22, "0")}`)
    expect((await POST(postJson({ ids: muchos }))).status).toBe(400)
    expect(orgRouter.update).not.toHaveBeenCalled()
  })

  it("accepts cuid ids (the real format of organizations.id)", async () => {
    const orgRouter = {
      ...createChainMock([{ id: O1, slug: "a" }]),
      update: vi.fn().mockReturnValue(createChainMock(null, null)),
      delete: vi.fn().mockReturnValue(createChainMock(null, null)),
    }
    mockSupabaseFrom({ organizations: orgRouter as any, audit_logs: createChainMock(null, null) })

    expect((await POST(postJson({ ids: [O1] }))).status).toBe(200)
    expect(orgRouter.update).toHaveBeenCalled()
  })

  it("skips superadmin org even in archive mode", async () => {
    const orgRouter = {
      ...createChainMock([{ id: O1, slug: "superadmin" }]),
      update: vi.fn().mockReturnValue(createChainMock(null, null)),
      delete: vi.fn().mockReturnValue(createChainMock(null, null)),
    }
    mockSupabaseFrom({ organizations: orgRouter as any, audit_logs: createChainMock(null, null) })

    const res = await POST(postJson({ ids: [O1] }))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body.error).toBeTruthy()
  })

  it("confirm=true WITHOUT hard → archives (update called, delete NOT called)", async () => {
    const updateChain = createChainMock(null, null, 2)
    const orgRouter = {
      ...createChainMock([{ id: O1, slug: "a" }, { id: O2, slug: "b" }]),
      update: vi.fn().mockReturnValue(updateChain),
      delete: vi.fn().mockReturnValue(createChainMock(null, null, 2)),
    }
    mockSupabaseFrom({ organizations: orgRouter as any, audit_logs: createChainMock(null, null) })

    const res = await POST(postJson({ ids: [O1, O2], confirm: true }))
    const { status } = await parseResponse(res)

    expect(status).toBe(200)
    expect(orgRouter.update).toHaveBeenCalled()
    expect(orgRouter.delete).not.toHaveBeenCalled()
  })
})
