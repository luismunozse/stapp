/**
 * El usuario logueado que entra a stapp.com.ar/ o /precios va a su panel. Lo
 * resuelve el proxy (antes cada página llamaba a auth() + Supabase en todos los
 * requests, incluidos los anónimos). El resto de las rutas públicas del
 * dominio raíz no se tocan.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const { getToken, getOrgSlugById } = vi.hoisted(() => ({
  getToken: vi.fn(),
  getOrgSlugById: vi.fn(),
}))

vi.mock("next-auth/jwt", () => ({ getToken }))
vi.mock("@/lib/org-slug-edge", () => ({ getOrgSlugById }))
vi.mock("@/lib/user-status-edge", () => ({
  getUserDeletedStatus: vi.fn().mockResolvedValue({ kind: "ok", deleted: false, bloqueado: false, esSuperadmin: false }),
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

import { proxy } from "@/proxy"
import { sessionCookieName } from "@/lib/session-cookie"

const ROOT = "stapp.com.ar"

function req(path: string, opts: { cookie?: string; method?: string; host?: string } = {}) {
  const host = opts.host ?? ROOT
  const headers: Record<string, string> = { host }
  if (opts.cookie) headers.cookie = opts.cookie
  return new NextRequest(`https://${host}${path}`, { method: opts.method ?? "GET", headers })
}

const session = () => `${sessionCookieName()}=jwt`

describe("proxy: usuario logueado en la landing", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getToken.mockResolvedValue({ id: "u1", organizationId: "org-1", role: "ADMIN" })
    getOrgSlugById.mockResolvedValue({ kind: "ok", slug: "taller" })
  })

  it.each(["/", "/precios"])("redirige %s al panel de su taller", async (path) => {
    const res = await proxy(req(path, { cookie: session() }))
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toMatch(/^https?:\/\/taller\.stapp\.com\.ar\/dashboard$/)
    expect(getOrgSlugById).toHaveBeenCalledWith("org-1")
  })

  it("también con la cookie partida en trozos (.0, .1)", async () => {
    const res = await proxy(req("/", { cookie: `${sessionCookieName()}.0=a; ${sessionCookieName()}.1=b` }))
    expect(res.status).toBe(307)
  })

  it("el visitante anónimo no decodifica nada ni consulta Supabase", async () => {
    const res = await proxy(req("/"))
    expect(res.status).toBe(200)
    expect(getToken).not.toHaveBeenCalled()
    expect(getOrgSlugById).not.toHaveBeenCalled()
  })

  it.each(["/seguimiento/abc", "/catalogo/taller", "/login", "/app-entry", "/ayuda", "/precios/otra"])(
    "no toca %s",
    async (path) => {
      const res = await proxy(req(path, { cookie: session() }))
      expect(res.headers.get("location")).toBeNull()
      expect(getOrgSlugById).not.toHaveBeenCalled()
    },
  )

  it("token sin organización (p. ej. superadmin) ve la landing", async () => {
    getToken.mockResolvedValue({ id: "u1", email: "a@b.com" })
    const res = await proxy(req("/", { cookie: session() }))
    expect(res.status).toBe(200)
  })

  it("si no se puede resolver el slug, muestra la landing (fail-open)", async () => {
    getOrgSlugById.mockResolvedValue({ kind: "error" })
    expect((await proxy(req("/", { cookie: session() }))).status).toBe(200)
    getOrgSlugById.mockResolvedValue({ kind: "ok", slug: null })
    expect((await proxy(req("/", { cookie: session() }))).status).toBe(200)
  })

  it("en un subdominio de tenant sigue mandando a /dashboard del mismo host", async () => {
    const res = await proxy(req("/", { cookie: session(), host: "taller.stapp.com.ar" }))
    expect(res.headers.get("location")).toBe("https://taller.stapp.com.ar/dashboard")
    expect(getOrgSlugById).not.toHaveBeenCalled()
  })
})
