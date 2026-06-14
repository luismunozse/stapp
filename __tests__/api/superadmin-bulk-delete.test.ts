import { describe, it, expect, vi, beforeEach } from "vitest"
import { createChainMock, mockSupabaseFrom, parseResponse } from "./helpers"

vi.mock("@/lib/superadmin-auth", () => ({
  requireSuperadmin: vi.fn().mockResolvedValue({ error: null, email: "admin@stapp.com.ar" }),
}))

import { POST } from "@/app/api/superadmin/organizations/bulk-delete/route"

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
      ...createChainMock([{ id: "o1", slug: "a" }, { id: "o2", slug: "b" }]),
      update: vi.fn().mockReturnValue(updateChain),
      delete: vi.fn().mockReturnValue(createChainMock(null, null)),
    }
    mockSupabaseFrom({ organizations: orgRouter as any, audit_logs: createChainMock(null, null) })

    const res = await POST(postJson({ ids: ["o1", "o2"] }))
    const { status } = await parseResponse(res)

    expect(status).toBe(200)
    expect(orgRouter.update).toHaveBeenCalled()
    expect(orgRouter.delete).not.toHaveBeenCalled()
  })

  it("returns 200 with archived count in response", async () => {
    const updateChain = createChainMock(null, null)
    const orgRouter = {
      ...createChainMock([{ id: "o1", slug: "a" }, { id: "o2", slug: "b" }]),
      update: vi.fn().mockReturnValue(updateChain),
      delete: vi.fn().mockReturnValue(createChainMock(null, null)),
    }
    mockSupabaseFrom({ organizations: orgRouter as any, audit_logs: createChainMock(null, null) })

    const res = await POST(postJson({ ids: ["o1", "o2"] }))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(typeof body.archived).toBe("number")
  })

  it("performs CASCADE delete when hard=true AND confirm=true", async () => {
    const deleteChain = createChainMock(null, null, 2)
    const orgRouter = {
      ...createChainMock([{ id: "o1", slug: "a" }, { id: "o2", slug: "b" }]),
      update: vi.fn().mockReturnValue(createChainMock(null, null)),
      delete: vi.fn().mockReturnValue(deleteChain),
    }
    mockSupabaseFrom({ organizations: orgRouter as any, audit_logs: createChainMock(null, null) })

    const res = await POST(postJson({ ids: ["o1", "o2"], hard: true, confirm: true }))
    const { status } = await parseResponse(res)

    expect(status).toBe(200)
    expect(orgRouter.delete).toHaveBeenCalled()
    expect(orgRouter.update).not.toHaveBeenCalled()
  })

  it("skips superadmin org even in archive mode", async () => {
    const orgRouter = {
      ...createChainMock([{ id: "o1", slug: "superadmin" }]),
      update: vi.fn().mockReturnValue(createChainMock(null, null)),
      delete: vi.fn().mockReturnValue(createChainMock(null, null)),
    }
    mockSupabaseFrom({ organizations: orgRouter as any, audit_logs: createChainMock(null, null) })

    const res = await POST(postJson({ ids: ["o1"] }))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body.error).toBeTruthy()
  })

  it("hard=true WITHOUT confirm → archives (update called, delete NOT called)", async () => {
    const updateChain = createChainMock(null, null, 2)
    const orgRouter = {
      ...createChainMock([{ id: "o1", slug: "a" }, { id: "o2", slug: "b" }]),
      update: vi.fn().mockReturnValue(updateChain),
      delete: vi.fn().mockReturnValue(createChainMock(null, null, 2)),
    }
    mockSupabaseFrom({ organizations: orgRouter as any, audit_logs: createChainMock(null, null) })

    const res = await POST(postJson({ ids: ["o1", "o2"], hard: true }))
    const { status } = await parseResponse(res)

    expect(status).toBe(200)
    expect(orgRouter.update).toHaveBeenCalled()
    expect(orgRouter.delete).not.toHaveBeenCalled()
  })

  it("confirm=true WITHOUT hard → archives (update called, delete NOT called)", async () => {
    const updateChain = createChainMock(null, null, 2)
    const orgRouter = {
      ...createChainMock([{ id: "o1", slug: "a" }, { id: "o2", slug: "b" }]),
      update: vi.fn().mockReturnValue(updateChain),
      delete: vi.fn().mockReturnValue(createChainMock(null, null, 2)),
    }
    mockSupabaseFrom({ organizations: orgRouter as any, audit_logs: createChainMock(null, null) })

    const res = await POST(postJson({ ids: ["o1", "o2"], confirm: true }))
    const { status } = await parseResponse(res)

    expect(status).toBe(200)
    expect(orgRouter.update).toHaveBeenCalled()
    expect(orgRouter.delete).not.toHaveBeenCalled()
  })
})
