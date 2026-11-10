/**
 * El rate limit de /api/* en el proxy cuenta por IP también en los subdominios
 * de taller: un solo cliente no puede agotar el cupo de toda la organización.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("next-auth/jwt", () => ({ getToken: vi.fn().mockResolvedValue(null) }))
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn().mockResolvedValue({ success: true, remaining: 99, reset: 0 }),
  getApiRateLimit: vi.fn().mockReturnValue({ max: 100, windowMs: 60000 }),
  isExemptFromRateLimit: vi.fn().mockReturnValue(false),
  extractPublicToken: vi.fn().mockReturnValue(null),
  extractPublicCatalogoSlug: vi.fn().mockReturnValue(null),
}))
vi.mock("@/lib/tenant-status-edge", () => ({ getTenantStatusBySlug: vi.fn().mockResolvedValue({ kind: "error" }) }))
vi.mock("@/lib/impersonation", () => ({ isImpersonationWriteBlocked: vi.fn().mockReturnValue(false) }))

import { rateLimit } from "@/lib/rate-limit"
import { proxy } from "@/proxy"

function req(host: string, ip: string) {
  return new NextRequest(`https://${host}/api/ordenes/123`, {
    headers: { host, "x-forwarded-for": `${ip}, 10.0.0.1` },
  })
}

describe("proxy — clave de rate limit", () => {
  beforeEach(() => vi.clearAllMocks())

  it("en un subdominio de taller incluye organización e IP", async () => {
    await proxy(req("acme.stapp.com.ar", "1.2.3.4"))
    await proxy(req("acme.stapp.com.ar", "5.6.7.8"))

    const claves = vi.mocked(rateLimit).mock.calls.map((c) => c[0])
    expect(claves[0]).toContain("acme")
    expect(claves[0]).toContain("1.2.3.4")
    expect(claves[1]).toContain("5.6.7.8")
    expect(claves[0]).not.toBe(claves[1])
  })

  it("en el dominio principal sigue contando por IP", async () => {
    await proxy(req("stapp.com.ar", "1.2.3.4"))

    expect(vi.mocked(rateLimit).mock.calls[0][0]).toContain("1.2.3.4")
  })
})
