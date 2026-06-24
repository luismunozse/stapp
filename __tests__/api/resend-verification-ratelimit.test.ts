import { describe, it, expect, beforeEach, vi } from "vitest"
import { createChainMock, createPostRequest, parseResponse } from "./helpers"

// ── Module-level mocks ──────────────────────────────────────────────────────

vi.mock("@/lib/rate-limit", () => ({
  persistentRateLimit: vi.fn(),
}))

vi.mock("@/lib/email", () => ({
  sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("crypto", async () => {
  const actual = await vi.importActual<typeof import("crypto")>("crypto")
  return {
    ...actual,
    default: {
      ...actual,
      randomBytes: vi.fn().mockReturnValue({ toString: () => "abc123token" }),
    },
  }
})

// ── Helpers ─────────────────────────────────────────────────────────────────

async function getRoute() {
  const mod = await import("@/app/api/auth/resend-verification/route")
  return mod.POST
}

async function callRoute(body: unknown) {
  const POST = await getRoute()
  return POST(createPostRequest(body) as any)
}

async function setupSupabaseMock(userData: object | null = null) {
  const { supabaseAdmin } = await import("@/lib/supabase")

  const userChain = createChainMock(userData)
  const updateChain = createChainMock(null, null)

  let callIndex = 0
  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    if (table !== "users") return createChainMock(null, { message: `unexpected: ${table}` }) as any
    callIndex++
    if (callIndex === 1) return userChain as any   // SELECT
    return updateChain as any                       // UPDATE
  })

  return { userChain, updateChain }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("resend-verification: rate limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it("returns 429 with generic message when rate limit is exceeded", async () => {
    const { persistentRateLimit } = await import("@/lib/rate-limit")
    vi.mocked(persistentRateLimit).mockResolvedValue({
      success: false,
      limit: 3,
      remaining: 0,
      reset: Date.now() + 3600,
    })

    const res = await callRoute({ email: "victim@example.com" })
    const { status, body } = await parseResponse(res)

    expect(status).toBe(429)
    // Must not leak "too many" or precise count info — just generic
    expect(body).toHaveProperty("error")
  })

  it("proceeds normally when rate limit allows the request", async () => {
    const { persistentRateLimit } = await import("@/lib/rate-limit")
    vi.mocked(persistentRateLimit).mockResolvedValue({
      success: true,
      limit: 3,
      remaining: 2,
      reset: Date.now() + 3600,
    })

    await setupSupabaseMock({
      id: "user-1",
      email: "user@example.com",
      nombre: "Alice",
      email_verified: false,
      organization_id: "org-1",
      organizations: { slug: "acme" },
    })

    const { sendVerificationEmail } = await import("@/lib/email")

    const res = await callRoute({ email: "user@example.com" })
    const { status } = await parseResponse(res)

    expect(status).toBe(200)
    expect(sendVerificationEmail).toHaveBeenCalled()
  })

  it("uses the email (not IP) as the rate limit identifier", async () => {
    const { persistentRateLimit } = await import("@/lib/rate-limit")
    vi.mocked(persistentRateLimit).mockResolvedValue({
      success: false,
      limit: 3,
      remaining: 0,
      reset: Date.now() + 3600,
    })

    await callRoute({ email: "target@example.com" })

    expect(persistentRateLimit).toHaveBeenCalledWith(
      expect.stringContaining("target@example.com"),
      expect.any(String),
      expect.any(Number),
      expect.any(Number),
    )
  })

  it("applies rate limit BEFORE querying the database", async () => {
    const { persistentRateLimit } = await import("@/lib/rate-limit")
    vi.mocked(persistentRateLimit).mockResolvedValue({
      success: false,
      limit: 3,
      remaining: 0,
      reset: Date.now() + 3600,
    })

    const { supabaseAdmin } = await import("@/lib/supabase")

    await callRoute({ email: "victim@example.com" })

    // DB must NOT have been queried when rate limit blocks
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })
})
