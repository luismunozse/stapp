/**
 * Un miembro logueado del taller que abre /login va a su panel. La app nativa
 * cae en /login en cada arranque (y después de cada actualización): sin esto,
 * una sesión de 30 días todavía válida mostraba el formulario vacío.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const { getToken, getTenantStatusBySlug } = vi.hoisted(() => ({
  getToken: vi.fn(),
  getTenantStatusBySlug: vi.fn(),
}))

vi.mock("next-auth/jwt", () => ({ getToken }))
vi.mock("@/lib/org-slug-edge", () => ({ getOrgSlugById: vi.fn() }))
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
vi.mock("@/lib/tenant-status-edge", () => ({ getTenantStatusBySlug }))

import { proxy } from "@/proxy"
import { sessionCookieName } from "@/lib/session-cookie"

const HOST = "taller.stapp.com.ar"

function req(path: string, method = "GET") {
  return new NextRequest(`https://${HOST}${path}`, {
    method,
    headers: { host: HOST, cookie: `${sessionCookieName()}=jwt` },
  })
}

describe("proxy: /login con sesión activa", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getToken.mockResolvedValue({ id: "u1", organizationId: "org-1", role: "ADMIN" })
    getTenantStatusBySlug.mockResolvedValue({ kind: "ok", status: { id: "org-1", activo: true } })
  })

  it("manda al panel en vez de mostrar el formulario", async () => {
    const res = await proxy(req("/login"))
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toBe(`https://${HOST}/dashboard`)
  })

  it("respeta un callbackUrl seguro", async () => {
    const res = await proxy(req("/login?callbackUrl=%2Fordenes%2F123"))
    expect(res.headers.get("location")).toBe(`https://${HOST}/ordenes/123`)
  })

  it("ignora un callbackUrl externo (open redirect)", async () => {
    const res = await proxy(req("/login?callbackUrl=%2F%2Fevil.com"))
    expect(res.headers.get("location")).toBe(`https://${HOST}/dashboard`)
  })

  it("sin sesión muestra el login", async () => {
    getToken.mockResolvedValue(null)
    const res = await proxy(req("/login"))
    expect(res.headers.get("location")).toBeNull()
  })

  it("con la sesión de otra organización muestra el login (re-loguearse acá)", async () => {
    getToken.mockResolvedValue({ id: "u1", organizationId: "org-2", role: "ADMIN" })
    const res = await proxy(req("/login"))
    expect(res.headers.get("location")).toBeNull()
  })

  it("con el refresh vencido muestra el login (no rebota entre login y panel)", async () => {
    getToken.mockResolvedValue({ id: "u1", organizationId: "org-1", role: "ADMIN", error: "RefreshTokenExpired" })
    const res = await proxy(req("/login"))
    expect(res.headers.get("location")).toBeNull()
  })

  it("si no se pudo verificar el taller, no adivina: muestra el login", async () => {
    getTenantStatusBySlug.mockResolvedValue({ kind: "error" })
    const res = await proxy(req("/login"))
    expect(res.headers.get("location")).toBeNull()
  })

  it("el POST del formulario no se redirige", async () => {
    const res = await proxy(req("/login", "POST"))
    expect(res.headers.get("location")).toBeNull()
  })
})
