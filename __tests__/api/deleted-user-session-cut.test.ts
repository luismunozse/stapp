/**
 * A deleted user's JWT stays valid for hours. The middleware must cut it on the
 * apex domain API (CASO 1) too, not just on tenant subdomains.
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

import { middleware } from "@/middleware"

const apex = (path: string) =>
  new NextRequest(`https://stapp.com.ar${path}`, { headers: { host: "stapp.com.ar" } })

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
