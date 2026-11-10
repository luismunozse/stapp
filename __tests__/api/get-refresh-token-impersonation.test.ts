/**
 * During an impersonation the session user is the TENANT user: handing out
 * their real refresh token would let the impersonator open a full read/write
 * session as them, outside the 30-minute read-only grant and without audit.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { auth, single } = vi.hoisted(() => ({ auth: vi.fn(), single: vi.fn() }))

vi.mock("@/lib/auth", () => ({ auth }))
vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    from: () => ({ select: () => ({ eq: () => ({ single }) }) }),
  },
}))

import { GET } from "@/app/api/auth/get-refresh-token/route"

describe("GET /api/auth/get-refresh-token", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    single.mockResolvedValue({
      data: { refresh_token: "real-token", refresh_token_expires: "2999-01-01T00:00:00Z" },
      error: null,
    })
  })

  it("403 y sin tocar la base durante una impersonación", async () => {
    auth.mockResolvedValue({ user: { id: "u1", isImpersonating: true } })
    const res = await GET()
    expect(res.status).toBe(403)
    expect(JSON.stringify(await res.json())).not.toContain("real-token")
    expect(single).not.toHaveBeenCalled()
  })

  it("devuelve el token a una sesión normal", async () => {
    auth.mockResolvedValue({ user: { id: "u1" } })
    const res = await GET()
    expect(res.status).toBe(200)
    expect((await res.json()).refreshToken).toBe("real-token")
  })
})
