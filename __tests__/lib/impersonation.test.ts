// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import {
  mintImpersonationToken,
  verifyImpersonationToken,
  getSessionCookieName,
  IMPERSONATION_MAX_AGE,
  type ImpersonationClaims,
} from "@/lib/impersonation"
import { encode } from "next-auth/jwt"

const SECRET = "test-secret-please-ignore-0123456789"

const baseClaims: Omit<ImpersonationClaims, "isSuperadmin" | "isImpersonating"> = {
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
})
