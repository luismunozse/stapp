import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { createChainMock, mockSupabaseFrom, parseResponse } from "./helpers"
import { GET } from "@/app/api/auth/get-refresh-token/route"

function sesion(extra: Record<string, unknown> = {}) {
  vi.mocked(auth).mockResolvedValue({
    user: { id: "user-1", organizationId: "org-1", role: "ADMIN", email: "a@a.com", ...extra },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any)
}

describe("GET /api/auth/get-refresh-token", () => {
  beforeEach(() => vi.clearAllMocks())

  it("devuelve el refresh token del usuario", async () => {
    sesion()
    mockSupabaseFrom({
      users: createChainMock({
        refresh_token: "rt-1",
        refresh_token_expires: new Date(Date.now() + 3600_000).toISOString(),
      }),
    })

    const { status, body } = await parseResponse(await GET())

    expect(status).toBe(200)
    expect(body.refreshToken).toBe("rt-1")
  })

  it("403 durante una impersonación, sin leer el token", async () => {
    sesion({ isImpersonating: true })
    mockSupabaseFrom({ users: createChainMock({ refresh_token: "rt-1" }) })

    const { status, body } = await parseResponse(await GET())

    expect(status).toBe(403)
    expect(body.refreshToken).toBeUndefined()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })
})
