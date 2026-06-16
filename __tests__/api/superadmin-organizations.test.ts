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
import { POST as RESTORE } from "@/app/api/superadmin/organizations/[id]/restore/route"

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
    const updateChain = createChainMock([{ id: "o1" }], null)
    const orgChain = {
      ...createChainMock({ id: "o1", nombre: "GuruTech", slug: "guru-tech", deleted_at: null }),
      update: vi.fn().mockReturnValue(updateChain),
    }
    mockSupabaseFrom({ organizations: orgChain as any, audit_logs: createChainMock(null, null) })

    const res = await DELETE(req("http://localhost/api/superadmin/organizations/o1"), ctx("o1"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.archived).toBe(true)
    expect(orgChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ deleted_by: "admin@stapp.com.ar" })
    )
    const payload = orgChain.update.mock.calls[0][0]
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

  it("returns 409 when the org is already archived", async () => {
    const orgChain = createChainMock({ id: "o1", nombre: "GuruTech", slug: "guru-tech", deleted_at: "2026-01-01T00:00:00Z" })
    mockSupabaseFrom({ organizations: orgChain })
    const res = await DELETE(req("http://localhost/api/superadmin/organizations/o1"), ctx("o1"))
    expect((await parseResponse(res)).status).toBe(409)
  })

  it("hard-purges when hard=true and confirmSlug matches", async () => {
    const orgChain = {
      ...createChainMock({ id: "o1", nombre: "GuruTech", slug: "guru-tech", deleted_at: null }),
      delete: vi.fn().mockReturnValue(createChainMock(null, null)),
    }
    mockSupabaseFrom({ organizations: orgChain as any, audit_logs: createChainMock(null, null) })
    const res = await DELETE(
      req("http://localhost/api/superadmin/organizations/o1?hard=true", { confirmSlug: "guru-tech" }),
      ctx("o1")
    )
    const { status, body } = await parseResponse(res)
    expect(status).toBe(200)
    expect(body.archived).toBe(false)
    expect(orgChain.delete).toHaveBeenCalled()
  })
})

describe("POST /api/superadmin/organizations/[id]/restore", () => {
  beforeEach(() => vi.clearAllMocks())

  it("clears the archival fields", async () => {
    // El restore ahora hace un update atómico con .select("id") que devuelve la
    // fila restaurada (guard anti-TOCTOU), así que el mock retorna esa fila.
    const updateChain = createChainMock([{ id: "o1" }], null)
    const orgChain = {
      ...createChainMock({ id: "o1", slug: "guru-tech", deleted_at: "2026-06-01T00:00:00Z" }),
      update: vi.fn().mockReturnValue(updateChain),
    }
    mockSupabaseFrom({ organizations: orgChain as any, audit_logs: createChainMock(null, null) })

    const r = new Request("http://localhost/api/superadmin/organizations/o1/restore", { method: "POST" })
    const res = await RESTORE(r, { params: Promise.resolve({ id: "o1" }) })
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    const payload = orgChain.update.mock.calls[0][0]
    expect(payload).toEqual(
      expect.objectContaining({ deleted_at: null, deleted_by: null, archived_reason: null })
    )
  })

  it("returns 409 when the org is not archived", async () => {
    const orgChain = createChainMock({ id: "o1", slug: "guru-tech", deleted_at: null })
    mockSupabaseFrom({ organizations: orgChain })
    const r = new Request("http://localhost/api/superadmin/organizations/o1/restore", { method: "POST" })
    const res = await RESTORE(r, { params: Promise.resolve({ id: "o1" }) })
    expect((await parseResponse(res)).status).toBe(409)
  })
})
