/**
 * Security: the middleware must STRIP client-injected x-superadmin-* / x-user-id
 * headers before any branch, so requireSuperadmin() can never trust a forged header
 * on paths that don't re-set them (e.g. the main domain without subdomain).
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
  getTenantStatusBySlug: vi.fn().mockResolvedValue(null),
}))
vi.mock("@/lib/impersonation", () => ({
  isImpersonationWriteBlocked: vi.fn().mockReturnValue(false),
}))

import { middleware } from "@/middleware"

function mainDomainRequestWithForgedHeaders() {
  return new NextRequest("https://stapp.com.ar/", {
    headers: {
      host: "stapp.com.ar",
      "x-superadmin-panel": "true",
      "x-superadmin-email": "attacker@stapp.com.ar",
      "x-user-id": "attacker-id",
    },
  })
}

describe("middleware — superadmin header injection", () => {
  beforeEach(() => vi.clearAllMocks())

  it("strips client-injected x-superadmin-* / x-user-id on the main domain", async () => {
    const res = await middleware(mainDomainRequestWithForgedHeaders())

    // Next encodes forwarded request headers as x-middleware-request-<name> +
    // lists them in x-middleware-override-headers. The forged ones must be gone.
    const override = res.headers.get("x-middleware-override-headers") || ""
    expect(override).not.toContain("x-superadmin-panel")
    expect(override).not.toContain("x-superadmin-email")
    expect(override).not.toContain("x-user-id")
    expect(res.headers.get("x-middleware-request-x-superadmin-panel")).toBeNull()
    expect(res.headers.get("x-middleware-request-x-superadmin-email")).toBeNull()
    expect(res.headers.get("x-middleware-request-x-user-id")).toBeNull()
  })
})
