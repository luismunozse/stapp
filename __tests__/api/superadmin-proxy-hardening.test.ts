/**
 * Endurecimiento de admin.* en el middleware:
 *  - CSRF: las escrituras tienen que venir de admin.* mismo (la cookie es
 *    SameSite=lax en .stapp.com.ar, así que un POST desde un tenant viaja con ella);
 *  - clickjacking: el panel no se puede embeber;
 *  - el login del panel tiene un límite de intentos compartido, por IP.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"

const { getToken, checkSuperadminLoginLimit } = vi.hoisted(() => ({
  getToken: vi.fn(),
  checkSuperadminLoginLimit: vi.fn(),
}))

vi.mock("next-auth/jwt", () => ({ getToken }))
vi.mock("@/lib/superadmin-login-limit-edge", () => ({ checkSuperadminLoginLimit, checkTenantLoginLimit: vi.fn() }))
vi.mock("@/lib/user-status-edge", () => ({
  // 397: el superadmin real tiene la fila marcada (es_superadmin).
  getUserDeletedStatus: vi.fn().mockResolvedValue({ kind: "ok", deleted: false, bloqueado: false, esSuperadmin: true }),
}))
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn().mockResolvedValue({ success: true, remaining: 99, reset: 0 }),
  getApiRateLimit: vi.fn().mockReturnValue({ max: 100, windowMs: 60000 }),
  isExemptFromRateLimit: vi.fn().mockReturnValue(true),
  extractPublicToken: vi.fn().mockReturnValue(null),
  extractPublicCatalogoSlug: vi.fn().mockReturnValue(null),
}))
vi.mock("@/lib/tenant-status-edge", () => ({
  getTenantStatusBySlug: vi.fn().mockResolvedValue({ kind: "ok", status: { id: "org-1", activo: true } }),
}))

import { proxy as middleware } from "@/proxy"

const ADMIN = "admin.stapp.com.ar"

function req(path: string, opts: { method?: string; headers?: Record<string, string>; host?: string } = {}) {
  const host = opts.host ?? ADMIN
  return new NextRequest(`https://${host}${path}`, {
    method: opts.method ?? "GET",
    headers: { host, ...opts.headers },
  })
}

describe("middleware: endurecimiento de admin.*", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("SUPERADMIN_EMAILS", "root@stapp.com.ar")
    getToken.mockResolvedValue({ id: "sa", email: "root@stapp.com.ar" })
    checkSuperadminLoginLimit.mockResolvedValue({ success: true, limit: 10, remaining: 9, reset: Date.now() + 60_000 })
  })
  afterEach(() => vi.unstubAllEnvs())

  describe("CSRF", () => {
    it("rechaza un POST que viene de un subdominio de tenant", async () => {
      const res = await middleware(
        req("/api/superadmin/organizations/bulk-delete", {
          method: "POST",
          headers: { origin: "https://taller.stapp.com.ar" },
        }),
      )
      expect(res.status).toBe(403)
    })

    it("rechaza Origin: null (iframe sandbox)", async () => {
      const res = await middleware(req("/api/superadmin/impersonate", { method: "POST", headers: { origin: "null" } }))
      expect(res.status).toBe(403)
    })

    it("rechaza un POST sin Origin ni Sec-Fetch-Site", async () => {
      const res = await middleware(req("/api/superadmin/run-cron", { method: "POST" }))
      expect(res.status).toBe(403)
    })

    it("también cubre el login (no se puede loguear al superadmin desde otro sitio)", async () => {
      const res = await middleware(
        req("/api/auth/callback/credentials", { method: "POST", headers: { origin: "https://evil.com" } }),
      )
      expect(res.status).toBe(403)
    })

    it("deja pasar un POST de admin.* mismo", async () => {
      const res = await middleware(
        req("/api/superadmin/run-cron", { method: "POST", headers: { origin: `https://${ADMIN}` } }),
      )
      expect(res.status).toBe(200)
      expect(res.headers.get("x-middleware-request-x-superadmin-email")).toBe("root@stapp.com.ar")
    })

    it("sin Origin pero con Sec-Fetch-Site: same-origin pasa", async () => {
      const res = await middleware(
        req("/api/superadmin/run-cron", { method: "POST", headers: { "sec-fetch-site": "same-origin" } }),
      )
      expect(res.status).toBe(200)
    })

    it("las lecturas no exigen Origin", async () => {
      const res = await middleware(req("/api/superadmin/organizations"))
      expect(res.status).toBe(200)
    })
  })

  describe("clickjacking", () => {
    it("las respuestas del panel prohíben embeberlo", async () => {
      for (const res of [
        await middleware(req("/superadmin/dashboard")),
        await middleware(req("/superadmin-login")),
        await middleware(req("/api/superadmin/organizations")),
      ]) {
        expect(res.headers.get("x-frame-options")).toBe("DENY")
        expect(res.headers.get("content-security-policy")).toBe("frame-ancestors 'none'")
      }
    })

    it("no cambia los headers de los tenants", async () => {
      getToken.mockResolvedValue({ id: "u1", organizationId: "org-1", role: "ADMIN" })
      const res = await middleware(req("/dashboard", { host: "taller.stapp.com.ar" }))
      expect(res.headers.get("x-frame-options")).toBeNull()
    })
  })

  describe("límite de intentos de login", () => {
    const login = (ip = "1.2.3.4") =>
      req("/api/auth/callback/credentials", {
        method: "POST",
        headers: { origin: `https://${ADMIN}`, "x-vercel-forwarded-for": ip, "x-forwarded-for": "6.6.6.6" },
      })

    it("cuenta por la IP de Vercel, no por la de XFF", async () => {
      await middleware(login("1.2.3.4"))
      expect(checkSuperadminLoginLimit).toHaveBeenCalledWith("1.2.3.4", 10, 600)
    })

    it("429 con Retry-After cuando se agotó", async () => {
      checkSuperadminLoginLimit.mockResolvedValue({ success: false, limit: 10, remaining: 0, reset: Date.now() + 120_000 })
      const res = await middleware(login())
      expect(res.status).toBe(429)
      expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0)
    })

    it("no limita otras rutas de /api/auth", async () => {
      await middleware(req("/api/auth/session"))
      expect(checkSuperadminLoginLimit).not.toHaveBeenCalled()
    })
  })
})
