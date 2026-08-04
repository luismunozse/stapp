import { describe, it, expect } from "vitest"
import { extractAuthCode } from "@/lib/auth-client"

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
