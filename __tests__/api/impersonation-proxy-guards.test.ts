/**
 * Impersonation guards in the middleware:
 *  - the 30-minute limit is enforced on our own claim, because Auth.js rewrites
 *    `exp` to the 30-day session maxAge on every /api/auth/session read;
 *  - read-only also applies on the apex domain (the cookie travels there too);
 *  - an impersonation session never enters the admin.* panel.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"

const { getToken } = vi.hoisted(() => ({ getToken: vi.fn() }))

vi.mock("next-auth/jwt", () => ({ getToken }))
vi.mock("@/lib/user-status-edge", () => ({
  getUserDeletedStatus: vi.fn().mockResolvedValue({ kind: "ok", deleted: false }),
}))
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn().mockResolvedValue({ success: true, remaining: 99, reset: 0 }),
  getApiRateLimit: vi.fn().mockReturnValue({ max: 100, windowMs: 60000 }),
  isExemptFromRateLimit: vi.fn().mockReturnValue(true),
  extractPublicToken: vi.fn().mockReturnValue(null),
  extractPublicCatalogoSlug: vi.fn().mockReturnValue(null),
}))
vi.mock("@/lib/tenant-status-edge", () => ({
  getTenantStatusBySlug: vi.fn().mockResolvedValue({
    kind: "ok",
    status: { id: "org-1", activo: true },
  }),
}))

import { proxy as middleware } from "@/proxy"

const NOW = Math.floor(new Date("2026-11-10T12:00:00Z").getTime() / 1000)

const req = (host: string, path: string, method = "GET") =>
  new NextRequest(`https://${host}${path}`, { method, headers: { host } })

const vigente = {
  id: "u1",
  email: "owner@taller.com",
  organizationId: "org-1",
  isImpersonating: true,
  impersonationExpiresAt: NOW + 10 * 60,
  // Lo que deja Auth.js tras re-firmar: exp a 30 días.
  exp: NOW + 30 * 24 * 3600,
}
const vencida = { ...vigente, impersonationExpiresAt: NOW - 60 }

describe("middleware: guardas de impersonación", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(NOW * 1000)
    vi.stubEnv("SUPERADMIN_EMAILS", "root@stapp.com.ar,owner@taller.com")
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  describe("dominio raíz", () => {
    it("bloquea escrituras a la API", async () => {
      getToken.mockResolvedValue(vigente)
      const res = await middleware(req("stapp.com.ar", "/api/ordenes", "POST"))
      expect(res.status).toBe(403)
    })

    it("bloquea server actions aunque sean a una página", async () => {
      getToken.mockResolvedValue(vigente)
      const r = new NextRequest("https://stapp.com.ar/dashboard", {
        method: "POST",
        headers: { host: "stapp.com.ar", "next-action": "abc" },
      })
      expect((await middleware(r)).status).toBe(403)
    })

    it("deja leer mientras está vigente", async () => {
      getToken.mockResolvedValue(vigente)
      const res = await middleware(req("stapp.com.ar", "/api/ordenes"))
      expect(res.status).toBe(200)
    })

    it("corta la API con la impersonación vencida aunque exp siga a 30 días", async () => {
      getToken.mockResolvedValue(vencida)
      const res = await middleware(req("stapp.com.ar", "/api/ordenes"))
      expect(res.status).toBe(401)
      expect(res.headers.get("set-cookie") ?? "").toContain("next-auth.session-token=;")
    })

    it("no toca escrituras de sesiones normales", async () => {
      getToken.mockResolvedValue({ id: "u1", organizationId: "org-1" })
      const res = await middleware(req("stapp.com.ar", "/api/ordenes", "POST"))
      expect(res.status).toBe(200)
    })

    it("el endpoint de salida sigue habilitado aunque esté vencida", async () => {
      getToken.mockResolvedValue(vencida)
      const res = await middleware(req("stapp.com.ar", "/api/auth/impersonate/exit", "POST"))
      expect(res.status).toBe(200)
    })
  })

  describe("subdominio de tenant", () => {
    it("redirige a /login y borra la cookie si está vencida", async () => {
      getToken.mockResolvedValue(vencida)
      const res = await middleware(req("taller.stapp.com.ar", "/dashboard"))
      expect(res.status).toBe(307)
      expect(res.headers.get("location")).toBe("https://taller.stapp.com.ar/login")
      expect(res.headers.get("set-cookie") ?? "").toContain("next-auth.session-token=;")
    })

    it("no hace loop en /login con la impersonación vencida", async () => {
      getToken.mockResolvedValue(vencida)
      const res = await middleware(req("taller.stapp.com.ar", "/login"))
      expect(res.status).toBe(200)
    })

    it("token de impersonación sin la claim nueva cuenta como vencido", async () => {
      const { impersonationExpiresAt: _omit, ...viejo } = vigente
      getToken.mockResolvedValue(viejo)
      const res = await middleware(req("taller.stapp.com.ar", "/api/ordenes"))
      expect(res.status).toBe(401)
    })

    it("sigue bloqueando escrituras vigentes", async () => {
      getToken.mockResolvedValue(vigente)
      const res = await middleware(req("taller.stapp.com.ar", "/api/ordenes", "POST"))
      expect(res.status).toBe(403)
    })
  })

  describe("panel admin.*", () => {
    it("una impersonación nunca entra, aunque el email objetivo sea superadmin", async () => {
      getToken.mockResolvedValue(vigente)
      const res = await middleware(req("admin.stapp.com.ar", "/api/superadmin/organizations"))
      expect(res.status).toBe(307)
      expect(res.headers.get("x-middleware-request-x-superadmin-email")).toBeNull()
    })

    it("el superadmin real sigue entrando", async () => {
      getToken.mockResolvedValue({ id: "sa", email: "root@stapp.com.ar" })
      const res = await middleware(req("admin.stapp.com.ar", "/api/superadmin/organizations"))
      expect(res.status).toBe(200)
      expect(res.headers.get("x-middleware-request-x-superadmin-email")).toBe("root@stapp.com.ar")
    })
  })
})
