/**
 * A deleted user's JWT stays valid for hours. The middleware must cut it on the
 * apex domain API (CASO 1), the admin subdomain (CASO 2) and tenant
 * subdomains (CASO 4).
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
  getTenantStatusBySlug: vi.fn().mockResolvedValue(null),
}))
vi.mock("@/lib/impersonation", () => ({
  isImpersonationWriteBlocked: vi.fn().mockReturnValue(false),
}))

import { getTenantStatusBySlug } from "@/lib/tenant-status-edge"
import { middleware } from "@/middleware"

const apex = (path: string) =>
  new NextRequest(`https://stapp.com.ar${path}`, { headers: { host: "stapp.com.ar" } })

const tenant = (path: string) =>
  new NextRequest(`https://taller.stapp.com.ar${path}`, { headers: { host: "taller.stapp.com.ar" } })

const admin = (path: string) =>
  new NextRequest(`https://admin.stapp.com.ar${path}`, { headers: { host: "admin.stapp.com.ar" } })

describe("middleware: corte de sesión de usuario dado de baja en el apex", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getToken.mockResolvedValue({ id: "u1", email: "a@b.com" })
  })

  it("API del apex con usuario eliminado devuelve 401 y borra la cookie", async () => {
    getUserDeletedStatus.mockResolvedValue({ kind: "ok", deleted: true })
    const res = await middleware(apex("/api/ordenes"))
    expect(res.status).toBe(401)
    expect(getUserDeletedStatus).toHaveBeenCalledWith("u1")
    expect(res.headers.get("set-cookie") ?? "").toContain("next-auth.session-token=;")
  })

  it("API del apex con usuario activo pasa", async () => {
    getUserDeletedStatus.mockResolvedValue({ kind: "ok", deleted: false })
    const res = await middleware(apex("/api/ordenes"))
    expect(res.status).not.toBe(401)
  })

  it("fail-open: si el lookup falla, pasa", async () => {
    getUserDeletedStatus.mockResolvedValue({ kind: "error" })
    const res = await middleware(apex("/api/ordenes"))
    expect(res.status).not.toBe(401)
  })

  it("ruta pública del apex no consulta", async () => {
    const res = await middleware(apex("/api/auth/signout"))
    expect(res.status).not.toBe(401)
    expect(getUserDeletedStatus).not.toHaveBeenCalled()
  })

  it("API sin sesión no consulta", async () => {
    getToken.mockResolvedValue(null)
    await middleware(apex("/api/ordenes"))
    expect(getUserDeletedStatus).not.toHaveBeenCalled()
  })
})

describe("middleware: corte de sesión de usuario dado de baja en subdominios", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getToken.mockResolvedValue({ id: "u1", email: "a@b.com", organizationId: "org-1" })
    vi.mocked(getTenantStatusBySlug).mockResolvedValue({
      kind: "ok",
      status: { id: "org-1", activo: true },
    } as never)
    getUserDeletedStatus.mockResolvedValue({ kind: "ok", deleted: true })
  })

  it("CASO 4: página del tenant redirige a /login y borra la cookie", async () => {
    const r = await middleware(tenant("/dashboard"))
    expect(r.status).toBe(307)
    expect(new URL(r.headers.get("location") as string).pathname).toBe("/login")
    expect(getUserDeletedStatus).toHaveBeenCalledWith("u1")
    expect(r.headers.get("set-cookie") ?? "").toContain("next-auth.session-token=;")
  })

  it("CASO 4: API del tenant devuelve 401 y borra la cookie", async () => {
    const r = await middleware(tenant("/api/ordenes"))
    expect(r.status).toBe(401)
    expect(r.headers.get("set-cookie") ?? "").toContain("next-auth.session-token=;")
  })

  it("CASO 4: /api/auth pasa sin consultar (hay que poder cerrar sesión)", async () => {
    const r = await middleware(tenant("/api/auth/signout"))
    expect(r.status).not.toBe(401)
    expect(getUserDeletedStatus).not.toHaveBeenCalled()
  })

  it("CASO 4: /legal/eliminar-cuenta sin sesión no redirige a /login", async () => {
    getToken.mockResolvedValue(null)
    const r = await middleware(tenant("/legal/eliminar-cuenta"))
    expect(r.headers.get("location")).toBeNull()
    expect(r.status).not.toBe(401)
    expect(getUserDeletedStatus).not.toHaveBeenCalled()
  })

  it("CASO 2: subdominio admin con usuario eliminado corta la sesión", async () => {
    const r = await middleware(admin("/"))
    expect(getUserDeletedStatus).toHaveBeenCalledWith("u1")
    expect(new URL(r.headers.get("location") as string).pathname).toBe("/login")
    expect(r.headers.get("set-cookie") ?? "").toContain("next-auth.session-token=;")
  })

  it("CASO 2: API del subdominio admin con usuario eliminado devuelve 401", async () => {
    const r = await middleware(admin("/api/superadmin/orgs"))
    expect(r.status).toBe(401)
  })
})
