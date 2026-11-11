/**
 * 397: el panel admin.* exige el email en SUPERADMIN_EMAILS **y** la fila
 * marcada (users.es_superadmin), leída en la base para que sacarla corte
 * enseguida. Y un acceso bloqueado desde el panel corta la sesión viva.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const { getToken, getUserDeletedStatus } = vi.hoisted(() => ({
  getToken: vi.fn(),
  getUserDeletedStatus: vi.fn(),
}))

vi.mock("next-auth/jwt", () => ({ getToken }))
vi.mock("@/lib/user-status-edge", () => ({ getUserDeletedStatus }))
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
vi.mock("@/lib/impersonation", () => ({
  isImpersonationWriteBlocked: vi.fn().mockReturnValue(false),
}))

import { proxy as middleware } from "@/proxy"

const SUPER = "root@stapp.com.ar"
const admin = (path: string) =>
  new NextRequest(`https://admin.stapp.com.ar${path}`, { headers: { host: "admin.stapp.com.ar" } })
const tenant = (path: string) =>
  new NextRequest(`https://taller.stapp.com.ar${path}`, { headers: { host: "taller.stapp.com.ar" } })

const ok = (extra: Record<string, unknown>) => ({ kind: "ok", deleted: false, bloqueado: false, esSuperadmin: false, ...extra })
const entro = (r: Response) => r.headers.get("x-middleware-request-x-superadmin-email") === SUPER

describe("proxy CASO 2: superadmin = email de la lista + fila marcada", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("SUPERADMIN_EMAILS", SUPER)
    getToken.mockResolvedValue({ id: "u-root", email: SUPER, isSuperadmin: true })
  })

  it("email de la lista con la fila sin marcar → afuera, aunque el token diga isSuperadmin", async () => {
    getUserDeletedStatus.mockResolvedValue(ok({ esSuperadmin: false }))
    const r = await middleware(admin("/superadmin/dashboard"))
    expect(r.status).toBe(307)
    expect(new URL(r.headers.get("location") as string).pathname).toBe("/")
    expect(entro(r)).toBe(false)
  })

  it("email de la lista con la fila marcada → entra", async () => {
    getUserDeletedStatus.mockResolvedValue(ok({ esSuperadmin: true }))
    const r = await middleware(admin("/superadmin/dashboard"))
    expect(r.headers.get("location")).toBeNull()
    expect(entro(r)).toBe(true)
  })

  it("fila marcada pero email fuera de la lista → afuera", async () => {
    getToken.mockResolvedValue({ id: "u-x", email: "otro@x.com", isSuperadmin: true })
    getUserDeletedStatus.mockResolvedValue(ok({ esSuperadmin: true }))
    const r = await middleware(admin("/superadmin/dashboard"))
    expect(new URL(r.headers.get("location") as string).pathname).toBe("/")
  })

  it("si la consulta falla usa la marca del token (resincronizada en cada revalidación)", async () => {
    getUserDeletedStatus.mockResolvedValue({ kind: "error" })
    expect(entro(await middleware(admin("/superadmin/dashboard")))).toBe(true)

    getToken.mockResolvedValue({ id: "u-root", email: SUPER, isSuperadmin: false })
    const r = await middleware(admin("/superadmin/dashboard"))
    expect(new URL(r.headers.get("location") as string).pathname).toBe("/")
  })
})

describe("proxy: acceso bloqueado desde el panel corta la sesión viva", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getToken.mockResolvedValue({ id: "u1", email: "tec@taller.com", organizationId: "org-1" })
    getUserDeletedStatus.mockResolvedValue(ok({ bloqueado: true }))
  })

  it("API del tenant → 401 'Acceso desactivado' y borra la cookie", async () => {
    const r = await middleware(tenant("/api/ordenes"))
    expect(r.status).toBe(401)
    expect(await r.json()).toEqual({ error: "Acceso desactivado" })
    expect(r.headers.get("set-cookie") ?? "").toContain("next-auth.session-token=;")
  })

  it("página del tenant → /login", async () => {
    const r = await middleware(tenant("/dashboard"))
    expect(new URL(r.headers.get("location") as string).pathname).toBe("/login")
  })

  it("una baja sigue diciendo 'Cuenta eliminada'", async () => {
    getUserDeletedStatus.mockResolvedValue(ok({ deleted: true }))
    const r = await middleware(tenant("/api/ordenes"))
    expect(await r.json()).toEqual({ error: "Cuenta eliminada" })
  })
})
