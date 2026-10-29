import { describe, it, expect } from "vitest"
import { telHref } from "@/lib/tel-href"

describe("telHref", () => {
  it("strips spaces, dashes and parentheses", () => {
    expect(telHref("(011) 4555-1234")).toBe("01145551234")
  })

  it("keeps a leading plus", () => {
    expect(telHref("  +54 9 11 5555-1234 ")).toBe("+5491155551234")
  })

  it("drops a plus that is not leading", () => {
    expect(telHref("11+5555")).toBe("115555")
  })

  it("returns an empty string when there are no digits", () => {
    expect(telHref("sin teléfono")).toBe("")
    expect(telHref("")).toBe("")
  })
})
