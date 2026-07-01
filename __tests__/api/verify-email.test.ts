import { describe, it, expect, beforeEach, vi } from "vitest"
import { createChainMock, parseResponse } from "./helpers"

// ── Module-level mocks ──────────────────────────────────────────────────────

vi.mock("@/lib/email", () => ({
  sendAccountActivatedEmail: vi.fn().mockResolvedValue(undefined),
}))

// ── Helpers ─────────────────────────────────────────────────────────────────

async function getRoute() {
  const mod = await import("@/app/api/auth/verify-email/route")
  return mod.GET
}

function createTokenRequest(token: string | null) {
  const url = token
    ? `http://localhost:3000/api/auth/verify-email?token=${token}`
    : `http://localhost:3000/api/auth/verify-email`
  return new Request(url, { method: "GET" })
}

async function callRoute(token: string | null) {
  const GET = await getRoute()
  return GET(createTokenRequest(token) as any)
}

async function setupSupabaseMock(userData: object | null = null) {
  const { supabaseAdmin } = await import("@/lib/supabase")

  const userChain = createChainMock(userData)
  const updateChain = createChainMock(null, null)

  let callIndex = 0
  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    if (table !== "users") return createChainMock(null, { message: `unexpected: ${table}` }) as any
    callIndex++
    if (callIndex === 1) return userChain as any // SELECT
    return updateChain as any // UPDATE
  })

  return { userChain, updateChain }
}

const futureExpiry = () => new Date(Date.now() + 60 * 60 * 1000).toISOString()

// ── Tests ────────────────────────────────────────────────────────────────────

describe("verify-email: account-activated confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it("sends the account-activated email after a successful verification", async () => {
    await setupSupabaseMock({
      id: "user-1",
      email: "user@example.com",
      nombre: "Alice",
      email_verified: false,
      email_verification_expires: futureExpiry(),
      organizations: { slug: "acme" },
    })

    const { sendAccountActivatedEmail } = await import("@/lib/email")

    const res = await callRoute("valid-token")
    const { status } = await parseResponse(res)

    expect(status).toBe(200)
    expect(sendAccountActivatedEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "user@example.com",
        nombre: "Alice",
        slug: "acme",
      }),
    )
  })

  it("does NOT send the activation email when the email was already verified", async () => {
    await setupSupabaseMock({
      id: "user-1",
      email: "user@example.com",
      nombre: "Alice",
      email_verified: true,
      email_verification_expires: futureExpiry(),
      organizations: { slug: "acme" },
    })

    const { sendAccountActivatedEmail } = await import("@/lib/email")

    const res = await callRoute("valid-token")
    const { body } = await parseResponse(res)

    expect(body.alreadyVerified).toBe(true)
    expect(sendAccountActivatedEmail).not.toHaveBeenCalled()
  })

  it("still verifies the account even if the confirmation email fails", async () => {
    await setupSupabaseMock({
      id: "user-1",
      email: "user@example.com",
      nombre: "Alice",
      email_verified: false,
      email_verification_expires: futureExpiry(),
      organizations: { slug: "acme" },
    })

    const { sendAccountActivatedEmail } = await import("@/lib/email")
    vi.mocked(sendAccountActivatedEmail).mockRejectedValueOnce(new Error("smtp down"))

    const res = await callRoute("valid-token")
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.success).toBe(true)
  })
})
