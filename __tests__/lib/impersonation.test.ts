// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import {
  mintImpersonationToken,
  verifyImpersonationToken,
  isImpersonationExpired,
  getSessionCookieName,
  IMPERSONATION_MAX_AGE,
  type ImpersonationClaims,
} from "@/lib/impersonation"
import { encode, decode } from "next-auth/jwt"

const SECRET = "test-secret-please-ignore-0123456789"

const baseClaims: Omit<
  ImpersonationClaims,
  "isSuperadmin" | "isImpersonating" | "impersonationExpiresAt" | "exp"
> = {
  id: "user-123",
  organizationId: "org-456",
  role: "ADMIN",
  sucursalId: null,
  impersonatorEmail: "admin@stapp.com.ar",
  name: "Taller Demo",
  email: "owner@taller.com",
}

describe("getSessionCookieName", () => {
  afterEach(() => vi.unstubAllEnvs())

  it("uses the secure prefix in production", () => {
    vi.stubEnv("NODE_ENV", "production")
    expect(getSessionCookieName()).toBe("__Secure-next-auth.session-token")
  })

  it("uses the unprefixed name outside production", () => {
    vi.stubEnv("NODE_ENV", "development")
    expect(getSessionCookieName()).toBe("next-auth.session-token")
  })
})

describe("mint/verify impersonation token", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test")
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.useRealTimers()
  })

  it("roundtrips: a minted token verifies back to the same claims", async () => {
    const token = await mintImpersonationToken(baseClaims, SECRET)
    const claims = await verifyImpersonationToken(token, SECRET)

    expect(claims).not.toBeNull()
    expect(claims!.id).toBe("user-123")
    expect(claims!.organizationId).toBe("org-456")
    expect(claims!.role).toBe("ADMIN")
    expect(claims!.impersonatorEmail).toBe("admin@stapp.com.ar")
    // Security invariants — never elevate, always flagged
    expect(claims!.isSuperadmin).toBe(false)
    expect(claims!.isImpersonating).toBe(true)
  })

  it("rejects a tampered token", async () => {
    const token = await mintImpersonationToken(baseClaims, SECRET)
    const tampered = token.slice(0, -3) + "abc"
    expect(await verifyImpersonationToken(tampered, SECRET)).toBeNull()
  })

  it("rejects a token signed with a different secret", async () => {
    const token = await mintImpersonationToken(baseClaims, SECRET)
    expect(await verifyImpersonationToken(token, "another-secret-totally-different")).toBeNull()
  })

  it("rejects a valid NextAuth token that is NOT an impersonation token", async () => {
    // A normal session token (no isImpersonating claim) must not pass verification.
    const plain = await encode({
      secret: SECRET,
      salt: getSessionCookieName(),
      maxAge: 60,
      token: { id: "user-123", organizationId: "org-456", role: "ADMIN" },
    })
    expect(await verifyImpersonationToken(plain, SECRET)).toBeNull()
  })

  it("refuses to mint a token that claims superadmin (no privilege escalation)", async () => {
    await expect(
      mintImpersonationToken({ ...baseClaims, isSuperadmin: true } as never, SECRET)
    ).rejects.toThrow()
  })

  it("rejects an expired token", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-06-15T10:00:00Z"))
    const token = await mintImpersonationToken(baseClaims, SECRET)
    // Advance past the 30-minute lifetime
    vi.setSystemTime(new Date("2026-06-15T10:31:00Z"))
    expect(await verifyImpersonationToken(token, SECRET)).toBeNull()
  })

  it("exposes a 30-minute max age", () => {
    expect(IMPERSONATION_MAX_AGE).toBe(30 * 60)
  })

  it("keeps the 30-minute limit after Auth.js re-signs the token with a 30-day exp", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-06-15T10:00:00Z"))
    const token = await mintImpersonationToken(baseClaims, SECRET)
    // Simulate what @auth/core does on GET /api/auth/session: decode and
    // re-encode with the session maxAge (30 days), which overwrites `exp`.
    const payload = await decode({ secret: SECRET, salt: getSessionCookieName(), token })
    const resigned = await encode({
      secret: SECRET,
      salt: getSessionCookieName(),
      maxAge: 30 * 24 * 60 * 60,
      token: payload!,
    })
    vi.setSystemTime(new Date("2026-06-15T10:31:00Z"))
    expect(await verifyImpersonationToken(resigned, SECRET)).toBeNull()
  })

  it("allowExpired still returns the claims of an expired (re-signed) token, for the exit endpoint", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-06-15T10:00:00Z"))
    const token = await mintImpersonationToken(baseClaims, SECRET)
    const payload = await decode({ secret: SECRET, salt: getSessionCookieName(), token })
    const resigned = await encode({
      secret: SECRET,
      salt: getSessionCookieName(),
      maxAge: 30 * 24 * 60 * 60,
      token: payload!,
    })
    vi.setSystemTime(new Date("2026-06-15T11:00:00Z"))
    expect(await verifyImpersonationToken(resigned, SECRET)).toBeNull()
    const claims = await verifyImpersonationToken(resigned, SECRET, { allowExpired: true })
    expect(claims?.id).toBe("user-123")
    expect(claims?.isImpersonating).toBe(true)
  })
})

describe("isImpersonationExpired", () => {
  const now = 1_000_000
  it("never expires a plain session", () => {
    expect(isImpersonationExpired({ isImpersonating: false }, now)).toBe(false)
    expect(isImpersonationExpired(null, now)).toBe(false)
  })
  it("is false before the deadline and true at/after it", () => {
    expect(isImpersonationExpired({ isImpersonating: true, impersonationExpiresAt: now + 1 }, now)).toBe(false)
    expect(isImpersonationExpired({ isImpersonating: true, impersonationExpiresAt: now }, now)).toBe(true)
  })
  it("fails closed when the claim is missing (tokens minted before it existed)", () => {
    expect(isImpersonationExpired({ isImpersonating: true }, now)).toBe(true)
  })
})
