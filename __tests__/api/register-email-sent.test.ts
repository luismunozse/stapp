import { describe, it, expect, beforeEach, vi } from "vitest"
import { createChainMock, createPostRequest, parseResponse } from "./helpers"

// ── Module-level mocks ──────────────────────────────────────────────────────

vi.mock("@/lib/email", () => ({
  sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
}))

// ── Helpers ─────────────────────────────────────────────────────────────────

async function getRoute() {
  const mod = await import("@/app/api/auth/register/route")
  return mod.POST
}

async function callRoute(body: unknown) {
  const POST = await getRoute()
  return POST(createPostRequest(body) as any)
}

/**
 * The register route hits several tables in sequence. We stub `from()` by table
 * name + call order so the happy path completes end-to-end.
 */
async function setupRegisterMocks() {
  const { supabaseAdmin } = await import("@/lib/supabase")
  const counts: Record<string, number> = {}

  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    counts[table] = (counts[table] || 0) + 1
    const n = counts[table]

    switch (table) {
      case "users":
        // 1st = existing-user check (none), 2nd = INSERT new user
        return n === 1
          ? (createChainMock(null) as any)
          : (createChainMock({ id: "user-1", email: "user@example.com", nombre: "Alice", rol: "ADMIN" }) as any)
      case "organizations":
        // 1st = existing-slug check (none), 2nd = INSERT new org
        return n === 1
          ? (createChainMock(null) as any)
          : (createChainMock({ id: "org-1", nombre: "Acme", slug: "acme" }) as any)
      case "organization_counters":
        return createChainMock(null, null) as any
      case "onboarding_progress":
        return createChainMock(null, null) as any
      case "checklist_templates":
        return createChainMock({ id: "tpl-1" }) as any
      case "checklist_template_items":
        return createChainMock(null, null) as any
      default:
        return createChainMock(null, { message: `unexpected table: ${table}` }) as any
    }
  })
}

const validBody = {
  organizacion: { nombre: "Acme", slug: "acme" },
  usuario: { nombre: "Alice", email: "user@example.com", password: "supersecret" },
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("register: verification email delivery flag", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it("returns emailSent: true when the verification email is sent", async () => {
    await setupRegisterMocks()

    const res = await callRoute(validBody)
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.emailSent).toBe(true)
  })

  it("returns emailSent: false (but still succeeds) when the email send fails", async () => {
    await setupRegisterMocks()
    const { sendVerificationEmail } = await import("@/lib/email")
    vi.mocked(sendVerificationEmail).mockRejectedValueOnce(new Error("smtp down"))

    const res = await callRoute(validBody)
    const { status, body } = await parseResponse(res)

    // Account is still created (no rollback) — but the client is told delivery failed
    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.emailSent).toBe(false)
  })
})
