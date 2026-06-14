import { describe, it, expect, vi, beforeEach } from "vitest"
import { getTenantStatusBySlug } from "@/lib/tenant-status-edge"

describe("getTenantStatusBySlug — archived orgs", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co"
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key"
  })

  it("returns status null when the org is archived (deleted_at set)", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify([{ id: "o1", activo: true, deleted_at: "2026-06-01T00:00:00Z" }]), { status: 200 })
    )
    const res = await getTenantStatusBySlug("archived-org-unique-1")
    expect(res).toEqual({ kind: "ok", status: null })
  })

  it("returns the org when not archived", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify([{ id: "o2", activo: true, deleted_at: null }]), { status: 200 })
    )
    const res = await getTenantStatusBySlug("live-org-unique-2")
    expect(res).toEqual({ kind: "ok", status: { id: "o2", activo: true } })
  })
})
