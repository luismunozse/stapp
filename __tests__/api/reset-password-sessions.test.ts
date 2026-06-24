import { describe, it, expect, beforeEach, vi } from "vitest"
import { createChainMock, createPostRequest, parseResponse, mockSupabaseFrom } from "./helpers"

// bcrypt is slow — mock it
vi.mock("bcryptjs", () => ({
  default: { hash: vi.fn().mockResolvedValue("hashed_password") },
}))

async function callRoute(body: unknown) {
  const { POST } = await import("@/app/api/auth/reset-password/route")
  return POST(createPostRequest(body) as any)
}

describe("reset-password: session invalidation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it("includes refresh_token: null in the update payload when token is valid", async () => {
    const userChain = createChainMock({ id: "user-1" })
    const updateChain = createChainMock(null, null)

    vi.mocked(
      (await import("@/lib/supabase")).supabaseAdmin.from
    )
    // First call: select user by reset_token
    // Second call: update the user
    // We intercept at the from() level
    const { supabaseAdmin } = await import("@/lib/supabase")
    let callIndex = 0
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table !== "users") return createChainMock(null, { message: `unexpected table: ${table}` }) as any
      callIndex++
      if (callIndex === 1) return userChain as any   // SELECT
      return updateChain as any                       // UPDATE
    })

    const res = await callRoute({ token: "valid-token-abc", password: "newpassword123" })
    const { status } = await parseResponse(res)

    expect(status).toBe(200)
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ refresh_token: null })
    )
  })

  it("does NOT reach the update when the token is invalid", async () => {
    const { supabaseAdmin } = await import("@/lib/supabase")
    const noUserChain = createChainMock(null, null)
    // .single() resolves with null data → user not found
    vi.mocked(supabaseAdmin.from).mockReturnValue(noUserChain as any)

    const res = await callRoute({ token: "bad-token", password: "newpassword123" })
    const { status } = await parseResponse(res)

    expect(status).toBe(400)
    expect(noUserChain.update).not.toHaveBeenCalled()
  })
})
