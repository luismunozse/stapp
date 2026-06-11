/**
 * TDD tests for GET /api/realtime/token
 *
 * Tests: 401 when unauthenticated, correct JWT claims, valid HS256 signature,
 * ~30-min TTL, 500 when SUPABASE_JWT_SECRET is missing.
 *
 * Mock strategy:
 * - @/lib/auth → auth() returns null (unauthed) or a shaped session (authed)
 * - process.env.SUPABASE_JWT_SECRET → set/delete per test via vi.stubEnv / delete
 * - node:crypto is NOT mocked — we verify the real HMAC-SHA256 signature
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"

// ── helpers ──────────────────────────────────────────────────────────────────

function b64urlDecode(s: string): string {
  // Add padding and convert base64url → base64
  const padded = s.replace(/-/g, "+").replace(/_/g, "/")
  const pad = (4 - (padded.length % 4)) % 4
  return Buffer.from(padded + "=".repeat(pad), "base64").toString("utf8")
}

function b64urlDecodeBytes(s: string): Buffer {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/")
  const pad = (4 - (padded.length % 4)) % 4
  return Buffer.from(padded + "=".repeat(pad), "base64")
}

function verifyHmacSha256(token: string, secret: string): boolean {
  const { createHmac } = require("node:crypto")
  const parts = token.split(".")
  if (parts.length !== 3) return false
  const [header, payload, sig] = parts
  const expected = createHmac("sha256", Buffer.from(secret, "utf8"))
    .update(`${header}.${payload}`)
    .digest("base64url")
  return expected === sig
}

// ── test constants ────────────────────────────────────────────────────────────

const MOCK_SECRET = "super-secret-test-value-32chars!!"
const MOCK_USER_ID = "user_cm123abc"
const MOCK_ORG_ID = "org_cm456def"

const AUTHED_SESSION = {
  user: {
    id: MOCK_USER_ID,
    organizationId: MOCK_ORG_ID,
    role: "ADMIN" as const,
    email: "admin@test.com",
    isSuperadmin: false,
    avatar: null,
  },
  expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
}

// ── mock setup ────────────────────────────────────────────────────────────────

// We override the global auth mock from vitest.setup.ts per-test
const mockAuth = vi.fn()

vi.mock("@/lib/auth", () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}))

// ── tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/realtime/token", () => {
  const makeRequest = () =>
    new NextRequest("http://localhost/api/realtime/token", { method: "GET" })

  beforeEach(() => {
    vi.resetModules()
    // Set the secret by default; individual tests override as needed
    process.env.SUPABASE_JWT_SECRET = MOCK_SECRET
  })

  afterEach(() => {
    vi.clearAllMocks()
    delete process.env.SUPABASE_JWT_SECRET
  })

  // ── 1. 401 when unauthenticated ────────────────────────────────────────────
  it("returns 401 when auth() returns null", async () => {
    mockAuth.mockResolvedValueOnce(null)

    const { GET } = await import("../route")
    const response = await GET(makeRequest())

    expect(response.status).toBe(401)
    const body = await response.json()
    expect(body).toHaveProperty("error")
  })

  it("returns 401 when session has no user", async () => {
    mockAuth.mockResolvedValueOnce({ expires: "2099-01-01" })

    const { GET } = await import("../route")
    const response = await GET(makeRequest())

    expect(response.status).toBe(401)
  })

  // ── 2. Correct JWT claims ──────────────────────────────────────────────────
  it("returns token with correct sub, role, aud, organization_id claims", async () => {
    mockAuth.mockResolvedValueOnce(AUTHED_SESSION)

    const { GET } = await import("../route")
    const before = Math.floor(Date.now() / 1000)
    const response = await GET(makeRequest())
    const after = Math.floor(Date.now() / 1000)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toHaveProperty("token")
    expect(body).toHaveProperty("expiresAt")

    const [, payloadB64] = body.token.split(".")
    const payload = JSON.parse(b64urlDecode(payloadB64))

    expect(payload.sub).toBe(MOCK_USER_ID)
    expect(payload.role).toBe("authenticated")
    expect(payload.aud).toBe("authenticated")
    expect(payload.organization_id).toBe(MOCK_ORG_ID)
    expect(payload.iat).toBeGreaterThanOrEqual(before)
    expect(payload.iat).toBeLessThanOrEqual(after)
  })

  // ── 3. ~30-min TTL ────────────────────────────────────────────────────────
  it("sets exp to approximately iat + 30 minutes", async () => {
    mockAuth.mockResolvedValueOnce(AUTHED_SESSION)

    const { GET } = await import("../route")
    const response = await GET(makeRequest())
    const body = await response.json()

    const [, payloadB64] = body.token.split(".")
    const payload = JSON.parse(b64urlDecode(payloadB64))

    const ttlSeconds = payload.exp - payload.iat
    // Allow ±10 seconds clock drift
    expect(ttlSeconds).toBeGreaterThanOrEqual(30 * 60 - 10)
    expect(ttlSeconds).toBeLessThanOrEqual(30 * 60 + 10)
  })

  // ── 4. Valid HS256 signature ───────────────────────────────────────────────
  it("produces a valid HS256 signature over header.payload", async () => {
    mockAuth.mockResolvedValueOnce(AUTHED_SESSION)

    const { GET } = await import("../route")
    const response = await GET(makeRequest())
    const body = await response.json()

    expect(verifyHmacSha256(body.token, MOCK_SECRET)).toBe(true)
  })

  it("header alg is HS256 and typ is JWT", async () => {
    mockAuth.mockResolvedValueOnce(AUTHED_SESSION)

    const { GET } = await import("../route")
    const response = await GET(makeRequest())
    const body = await response.json()

    const [headerB64] = body.token.split(".")
    const header = JSON.parse(b64urlDecode(headerB64))

    expect(header.alg).toBe("HS256")
    expect(header.typ).toBe("JWT")
  })

  // ── 5. expiresAt matches exp claim ────────────────────────────────────────
  it("returns expiresAt as ISO string matching the exp claim", async () => {
    mockAuth.mockResolvedValueOnce(AUTHED_SESSION)

    const { GET } = await import("../route")
    const response = await GET(makeRequest())
    const body = await response.json()

    const [, payloadB64] = body.token.split(".")
    const payload = JSON.parse(b64urlDecode(payloadB64))

    const expiresAtMs = new Date(body.expiresAt).getTime()
    const expMs = payload.exp * 1000
    // Should be within 1 second
    expect(Math.abs(expiresAtMs - expMs)).toBeLessThan(1000)
  })

  // ── 6. 401 when session present but organizationId is null ────────────────
  it("returns 401 when session has user.id but organizationId is null", async () => {
    mockAuth.mockResolvedValueOnce({
      user: {
        id: MOCK_USER_ID,
        organizationId: null,
        role: "ADMIN" as const,
        email: "admin@test.com",
        isSuperadmin: false,
        avatar: null,
      },
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    })

    const { GET } = await import("../route")
    const response = await GET(makeRequest())

    expect(response.status).toBe(401)
    const body = await response.json()
    expect(body).toHaveProperty("error")
    // No token should be present in the response
    expect(body).not.toHaveProperty("token")
  })

  // ── 7. 500 when SUPABASE_JWT_SECRET is missing ────────────────────────────
  it("returns 500 when SUPABASE_JWT_SECRET is not set", async () => {
    mockAuth.mockResolvedValueOnce(AUTHED_SESSION)
    delete process.env.SUPABASE_JWT_SECRET

    const { GET } = await import("../route")
    const response = await GET(makeRequest())

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body).toHaveProperty("error")
    expect(body.error).toMatch(/secret/i)
  })
})
