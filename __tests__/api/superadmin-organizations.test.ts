import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  createChainMock,
  mockSupabaseFrom,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/superadmin-auth", () => ({
  requireSuperadmin: vi.fn().mockResolvedValue({ error: null, email: "admin@stapp.com.ar" }),
}))

import { DELETE } from "@/app/api/superadmin/organizations/[id]/route"

function req(url: string, body?: unknown): Request {
  return new Request(url, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

describe("DELETE /api/superadmin/organizations/[id]", () => {
  beforeEach(() => vi.clearAllMocks())

  it("archives (soft-delete) by default and sets deleted_at", async () => {
    const updateChain = createChainMock(null, null)
    const orgRouter = {
      ...createChainMock({ id: "o1", nombre: "GuruTech", slug: "guru-tech", deleted_at: null }),
      update: vi.fn().mockReturnValue(updateChain),
    }
    mockSupabaseFrom({ organizations: orgRouter as any, audit_logs: createChainMock(null, null) })

    const res = await DELETE(req("http://localhost/api/superadmin/organizations/o1"), ctx("o1"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.archived).toBe(true)
    expect(orgRouter.update).toHaveBeenCalledWith(
      expect.objectContaining({ deleted_by: "admin@stapp.com.ar" })
    )
    const payload = orgRouter.update.mock.calls[0][0]
    expect(payload.deleted_at).toBeTruthy()
  })

  it("refuses to touch the superadmin org", async () => {
    const orgChain = createChainMock({ id: "s", nombre: "Admin", slug: "superadmin", deleted_at: null })
    mockSupabaseFrom({ organizations: orgChain })
    const res = await DELETE(req("http://localhost/api/superadmin/organizations/s"), ctx("s"))
    expect((await parseResponse(res)).status).toBe(403)
  })

  it("rejects hard purge without matching confirmSlug", async () => {
    const orgChain = createChainMock({ id: "o1", nombre: "GuruTech", slug: "guru-tech", deleted_at: null })
    mockSupabaseFrom({ organizations: orgChain })
    const res = await DELETE(
      req("http://localhost/api/superadmin/organizations/o1?hard=true", { confirmSlug: "wrong" }),
      ctx("o1")
    )
    expect((await parseResponse(res)).status).toBe(400)
  })
})
