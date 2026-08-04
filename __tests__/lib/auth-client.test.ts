import { describe, it, expect } from "vitest"
import { extractAuthCode, parseRequires2FA } from "@/lib/auth-client"

describe("extractAuthCode", () => {
  it("returns the custom code when present (NextAuth v5 behavior)", () => {
    expect(
      extractAuthCode({ error: "CredentialsSignin", code: "ACCOUNT_LOCKED" })
    ).toBe("ACCOUNT_LOCKED")
  })

  it("preserves CODE:payload format", () => {
    expect(
      extractAuthCode({ error: "CredentialsSignin", code: "REQUIRES_2FA:user-123" })
    ).toBe("REQUIRES_2FA:user-123")
  })

  it("falls back to error when code is missing", () => {
    expect(extractAuthCode({ error: "CredentialsSignin" })).toBe("CredentialsSignin")
  })

  it("falls back to error when code is null", () => {
    expect(extractAuthCode({ error: "CredentialsSignin", code: null })).toBe(
      "CredentialsSignin"
    )
  })

  it("returns empty string for undefined result", () => {
    expect(extractAuthCode(undefined)).toBe("")
  })

  it("returns empty string when neither code nor error exist", () => {
    expect(extractAuthCode({})).toBe("")
  })
})

describe("parseRequires2FA", () => {
  it("extracts the userId from REQUIRES_2FA:<id>", () => {
    expect(parseRequires2FA("REQUIRES_2FA:user-123")).toBe("user-123")
  })

  it("does NOT match SUPERADMIN_REQUIRES_2FA_SETUP (includes-collision guard)", () => {
    expect(parseRequires2FA("SUPERADMIN_REQUIRES_2FA_SETUP")).toBeNull()
  })

  it("returns null for a bare REQUIRES_2FA without userId", () => {
    expect(parseRequires2FA("REQUIRES_2FA")).toBeNull()
  })

  it("returns null for empty userId payload", () => {
    expect(parseRequires2FA("REQUIRES_2FA:")).toBeNull()
  })

  it("returns null for unrelated codes", () => {
    expect(parseRequires2FA("ACCOUNT_LOCKED")).toBeNull()
    expect(parseRequires2FA("")).toBeNull()
  })
})
