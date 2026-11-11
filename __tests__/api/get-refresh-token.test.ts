// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const { getToken, validateRefreshToken } = vi.hoisted(() => ({
  getToken: vi.fn(),
  validateRefreshToken: vi.fn(),
}))
vi.mock("next-auth/jwt", () => ({ getToken }))
vi.mock("@/lib/auth-tokens", () => ({ validateRefreshToken }))

import { GET } from "@/app/api/auth/get-refresh-token/route"

const TOKEN = "a".repeat(128)
const pedir = () => GET(new Request("https://taller.stapp.com.ar/api/auth/get-refresh-token"))

beforeEach(() => vi.clearAllMocks())

describe("GET /api/auth/get-refresh-token", () => {
  it("sin sesión responde 401", async () => {
    getToken.mockResolvedValue(null)
    expect((await pedir()).status).toBe(401)
  })

  it("durante una impersonación no entrega nada", async () => {
    getToken.mockResolvedValue({ id: "u-1", isImpersonating: true, refreshToken: TOKEN })
    const res = await pedir()
    expect(res.status).toBe(403)
    expect(JSON.stringify(await res.json())).not.toContain(TOKEN)
    expect(validateRefreshToken).not.toHaveBeenCalled()
  })

  it("entrega el token de ESTA sesión (el del JWT) si sigue vigente", async () => {
    getToken.mockResolvedValue({ id: "u-1", refreshToken: TOKEN })
    validateRefreshToken.mockResolvedValue({ id: "u-1", refreshTokenExpira: "2026-12-10T00:00:00.000Z" })
    const res = await pedir()
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(await res.json()).toEqual({ refreshToken: TOKEN, expiresAt: "2026-12-10T00:00:00.000Z" })
    expect(validateRefreshToken).toHaveBeenCalledWith(TOKEN)
  })

  it("una sesión revocada o de otro usuario responde 401", async () => {
    getToken.mockResolvedValue({ id: "u-1", refreshToken: TOKEN })
    validateRefreshToken.mockResolvedValue(null)
    expect((await pedir()).status).toBe(401)
    validateRefreshToken.mockResolvedValue({ id: "u-2", refreshTokenExpira: "x" })
    expect((await pedir()).status).toBe(401)
  })
})
