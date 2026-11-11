/**
 * Login de los talleres: límite de intentos por IP compartido entre instancias
 * (el bloqueo por cuenta no frena probar una contraseña contra muchos usuarios).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const { checkTenantLoginLimit, checkSuperadminLoginLimit } = vi.hoisted(() => ({
  checkTenantLoginLimit: vi.fn(),
  checkSuperadminLoginLimit: vi.fn(),
}))

vi.mock("next-auth/jwt", () => ({ getToken: vi.fn().mockResolvedValue(null) }))
vi.mock("@/lib/superadmin-login-limit-edge", () => ({ checkTenantLoginLimit, checkSuperadminLoginLimit }))
vi.mock("@/lib/user-status-edge", () => ({
  getUserDeletedStatus: vi.fn().mockResolvedValue({ kind: "ok", deleted: false }),
}))
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn().mockResolvedValue({ success: true, remaining: 99, reset: 0 }),
  getApiRateLimit: vi.fn().mockReturnValue({ max: 100, windowMs: 60000 }),
  isExemptFromRateLimit: vi.fn().mockReturnValue(false),
  extractPublicToken: vi.fn().mockReturnValue(null),
  extractPublicCatalogoSlug: vi.fn().mockReturnValue(null),
}))
vi.mock("@/lib/tenant-status-edge", () => ({
  getTenantStatusBySlug: vi.fn().mockResolvedValue({ kind: "ok", status: { id: "org-1", activo: true } }),
}))

import { proxy as middleware } from "@/proxy"

const TALLER = "taller.stapp.com.ar"

function login(opts: { host?: string; method?: string; ip?: string } = {}) {
  const host = opts.host ?? TALLER
  return new NextRequest(`https://${host}/api/auth/callback/credentials`, {
    method: opts.method ?? "POST",
    headers: { host, origin: `https://${host}`, "x-vercel-forwarded-for": opts.ip ?? "1.2.3.4", "x-forwarded-for": "6.6.6.6" },
  })
}

describe("middleware: límite de login de talleres", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    checkTenantLoginLimit.mockResolvedValue({ success: true, limit: 30, remaining: 29, reset: Date.now() + 60_000 })
    checkSuperadminLoginLimit.mockResolvedValue({ success: true, limit: 10, remaining: 9, reset: Date.now() + 60_000 })
  })

  it("cuenta por la IP de Vercel con el límite de talleres", async () => {
    await middleware(login())
    expect(checkTenantLoginLimit).toHaveBeenCalledWith("1.2.3.4", 30, 600)
    expect(checkSuperadminLoginLimit).not.toHaveBeenCalled()
  })

  it("429 con Retry-After cuando se agotó", async () => {
    checkTenantLoginLimit.mockResolvedValue({ success: false, limit: 30, remaining: 0, reset: Date.now() + 120_000 })
    const res = await middleware(login())
    expect(res.status).toBe(429)
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0)
  })

  it("también en el dominio principal", async () => {
    await middleware(login({ host: "stapp.com.ar" }))
    expect(checkTenantLoginLimit).toHaveBeenCalled()
  })

  it("no cuenta GETs ni otras rutas de auth", async () => {
    await middleware(login({ method: "GET" }))
    await middleware(new NextRequest(`https://${TALLER}/api/auth/session`, { headers: { host: TALLER } }))
    expect(checkTenantLoginLimit).not.toHaveBeenCalled()
  })

  it("el panel superadmin sigue con su propio límite", async () => {
    await middleware(login({ host: "admin.stapp.com.ar" }))
    expect(checkSuperadminLoginLimit).toHaveBeenCalledWith("1.2.3.4", 10, 600)
    expect(checkTenantLoginLimit).not.toHaveBeenCalled()
  })
})
