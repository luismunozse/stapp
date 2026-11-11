/**
 * El panel superadmin vive en `admin.<root>`. `superadmin.<root>` es un alias
 * que la gente tipea; sin tratamiento especial caía en CASO 4 (tenant) y
 * terminaba en /tenant-not-found. Debe redirigir al subdominio canónico.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("next-auth/jwt", () => ({ getToken: vi.fn().mockResolvedValue(null) }))
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn().mockResolvedValue({ success: true, remaining: 99, reset: 0 }),
  getApiRateLimit: vi.fn().mockReturnValue({ max: 100, windowMs: 60000 }),
  isExemptFromRateLimit: vi.fn().mockReturnValue(true),
  extractPublicToken: vi.fn().mockReturnValue(null),
  extractPublicCatalogoSlug: vi.fn().mockReturnValue(null),
}))
vi.mock("@/lib/tenant-status-edge", () => ({
  getTenantStatusBySlug: vi.fn().mockResolvedValue({ kind: "ok", status: null }),
}))
vi.mock("@/lib/impersonation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/impersonation")>()),
  isImpersonationWriteBlocked: vi.fn().mockReturnValue(false),
}))

import { proxy } from "@/proxy"
import { RESERVED_SUBDOMAINS } from "@/lib/tenant"

const req = (path: string) =>
  new NextRequest(`https://superadmin.stapp.com.ar${path}`, {
    headers: { host: "superadmin.stapp.com.ar" },
  })

describe("proxy — alias superadmin.* → admin.*", () => {
  beforeEach(() => vi.clearAllMocks())

  it("redirige la raíz al panel admin", async () => {
    const res = await proxy(req("/"))
    expect([301, 307, 308]).toContain(res.status)
    expect(res.headers.get("location")).toBe("https://admin.stapp.com.ar/")
  })

  it("conserva path y query", async () => {
    const res = await proxy(req("/superadmin/organizaciones?q=x"))
    expect(res.headers.get("location")).toBe(
      "https://admin.stapp.com.ar/superadmin/organizaciones?q=x"
    )
  })

  it("/tenant-not-found manda a la raíz del panel", async () => {
    const res = await proxy(req("/tenant-not-found"))
    expect(res.headers.get("location")).toBe("https://admin.stapp.com.ar/")
  })

  it("ninguna org puede registrar el slug 'superadmin'", () => {
    expect(RESERVED_SUBDOMAINS.has("superadmin")).toBe(true)
  })
})
