import { describe, it, expect } from "vitest"
import { isImpersonationWriteBlocked } from "@/lib/impersonation"

const base = {
  isImpersonating: true,
  method: "GET",
  pathname: "/dashboard",
  isServerAction: false,
}

describe("isImpersonationWriteBlocked", () => {
  it("never blocks when the session is not impersonating", () => {
    expect(
      isImpersonationWriteBlocked({ ...base, isImpersonating: false, method: "POST" })
    ).toBe(false)
    expect(
      isImpersonationWriteBlocked({ ...base, isImpersonating: undefined, method: "DELETE" })
    ).toBe(false)
  })

  it("allows safe methods while impersonating", () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      expect(isImpersonationWriteBlocked({ ...base, method })).toBe(false)
    }
  })

  it("blocks state-changing methods while impersonating", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(isImpersonationWriteBlocked({ ...base, method })).toBe(true)
    }
  })

  it("is case-insensitive on the method", () => {
    expect(isImpersonationWriteBlocked({ ...base, method: "post" })).toBe(true)
    expect(isImpersonationWriteBlocked({ ...base, method: "get" })).toBe(false)
  })

  it("blocks Next.js server actions even on a GET", () => {
    // Server actions normally POST, but the next-action header is treated as a
    // mutation signal regardless of method (defense in depth).
    expect(
      isImpersonationWriteBlocked({ ...base, method: "GET", isServerAction: true })
    ).toBe(true)
  })

  it("allows the sanctioned exit endpoint even as a POST", () => {
    expect(
      isImpersonationWriteBlocked({
        ...base,
        method: "POST",
        pathname: "/api/auth/impersonate/exit",
      })
    ).toBe(false)
  })

  it("does NOT allowlist signout (a signout would hit the tenant user)", () => {
    expect(
      isImpersonationWriteBlocked({
        ...base,
        method: "POST",
        pathname: "/api/auth/signout",
      })
    ).toBe(true)
  })

  it("blocks writes to API routes while impersonating", () => {
    expect(
      isImpersonationWriteBlocked({
        ...base,
        method: "POST",
        pathname: "/api/ordenes",
      })
    ).toBe(true)
  })
})
