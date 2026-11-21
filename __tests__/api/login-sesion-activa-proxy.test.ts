/**
 * Regresión: /login NO redirige al panel solo porque haya cookie de sesión.
 * El panel revalida la sesión contra la base (auth(), la fila del usuario, rol
 * y sucursal) y manda una sesión vieja a /login; si el proxy la devolvía al
 * panel, los dos rebotaban sin fin y la app nativa dejaba de abrir. La app
 * llega al panel por /app-entry → /dashboard.
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

function req(path: string) {
  return new NextRequest(`https://${HOST}${path}`, {
    headers: { host: HOST, cookie: `${sessionCookieName()}=jwt` },
  })
}

describe("proxy: /login con cookie de sesión", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getToken.mockResolvedValue({ id: "u1", organizationId: "org-1", role: "ADMIN" })
    getTenantStatusBySlug.mockResolvedValue({ kind: "ok", status: { id: "org-1", activo: true } })
  })

  it("muestra el login (sin redirigir): el panel decide si la sesión sigue valiendo", async () => {
    const res = await proxy(req("/login"))
    expect(res.headers.get("location")).toBeNull()
  })

  it("tampoco con callbackUrl (es justo el rebote del panel)", async () => {
    const res = await proxy(req("/login?callbackUrl=%2Fdashboard"))
    expect(res.headers.get("location")).toBeNull()
  })

  it("el panel sin cookie sigue mandando al login", async () => {
    getToken.mockResolvedValue(null)
    const res = await proxy(req("/dashboard"))
    expect(res.headers.get("location")).toMatch(/\/login\?callbackUrl=%2Fdashboard$/)
  })
})
