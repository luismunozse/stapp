/**
 * Una organización con la suscripción CANCELED o PAST_DUE no puede seguir
 * escribiendo por la API (el panel ya la mandaba a /suscripcion-requerida).
 * Lecturas, pago, login y soporte siguen andando.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const { getToken, getSuscripcionBloqueada } = vi.hoisted(() => ({
  getToken: vi.fn(),
  getSuscripcionBloqueada: vi.fn(),
}))

vi.mock("next-auth/jwt", () => ({ getToken }))
vi.mock("@/lib/suscripcion-edge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/suscripcion-edge")>()),
  getSuscripcionBloqueada,
}))
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

import { proxy as middleware } from "@/proxy"

const HOST = "taller.stapp.com.ar"
const req = (path: string, method = "GET", host = HOST) =>
  new NextRequest(`https://${host}${path}`, { method, headers: { host } })

const token = { id: "u1", email: "a@taller.com", organizationId: "org-1", role: "ADMIN" }

describe("proxy: organización sin suscripción vigente", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getToken.mockResolvedValue(token)
    getSuscripcionBloqueada.mockResolvedValue({ kind: "ok", bloqueada: true })
  })

  it("bloquea una escritura de la API con 402", async () => {
    const res = await middleware(req("/api/ordenes", "POST"))
    expect(res.status).toBe(402)
    expect((await res.json()).code).toBe("SUBSCRIPTION_REQUIRED")
    expect(getSuscripcionBloqueada).toHaveBeenCalledWith("org-1")
  })

  it("también en el dominio raíz", async () => {
    const res = await middleware(req("/api/ventas", "POST", "stapp.com.ar"))
    expect(res.status).toBe(402)
  })

  it("deja pasar las lecturas sin consultar la suscripción", async () => {
    const res = await middleware(req("/api/ordenes"))
    expect(res.status).not.toBe(402)
    expect(getSuscripcionBloqueada).not.toHaveBeenCalled()
  })

  it.each(["/api/mercadopago/preapproval", "/api/subscriptions/cancel", "/api/soporte/tickets", "/api/auth/signout"])(
    "deja pasar %s, que hace falta para pagar, loguearse o pedir soporte",
    async (path) => {
      const res = await middleware(req(path, "POST"))
      expect(res.status).not.toBe(402)
    },
  )

  it("no confunde un prefijo: /api/subscriptionsX no es /api/subscriptions", async () => {
    const res = await middleware(req("/api/subscriptionsX", "POST"))
    expect(res.status).toBe(402)
  })

  it("con la suscripción vigente deja escribir", async () => {
    getSuscripcionBloqueada.mockResolvedValue({ kind: "ok", bloqueada: false })
    const res = await middleware(req("/api/ordenes", "POST"))
    expect(res.status).not.toBe(402)
  })

  it("si no puede consultar la suscripción, deja pasar (fail-open)", async () => {
    getSuscripcionBloqueada.mockResolvedValue({ kind: "error" })
    const res = await middleware(req("/api/ordenes", "POST"))
    expect(res.status).not.toBe(402)
  })
})
