import { describe, it, expect } from "vitest"
import { trialAdjustmentStatus } from "@/lib/trial"
import { escapeOrIlikeTerm } from "@/lib/pg-search"

describe("trialAdjustmentStatus", () => {
  it("keeps a TRIALING sub trialing", () => {
    expect(trialAdjustmentStatus("TRIALING")).toBe("TRIALING")
  })

  it("never downgrades a paying (ACTIVE) sub", () => {
    expect(trialAdjustmentStatus("ACTIVE")).toBe("ACTIVE")
  })

  it("never reactivates a CANCELED sub", () => {
    expect(trialAdjustmentStatus("CANCELED")).toBe("CANCELED")
  })

  it("leaves PAST_DUE untouched", () => {
    expect(trialAdjustmentStatus("PAST_DUE")).toBe("PAST_DUE")
  })
})

describe("escapeOrIlikeTerm", () => {
  it("passes a plain term through", () => {
    expect(escapeOrIlikeTerm("taller")).toBe("taller")
  })

  it("neutralizes PostgREST structural chars (comma, parens)", () => {
    // Without this, the comma would inject an extra filter condition.
    expect(escapeOrIlikeTerm("a,b(c)")).toBe("a b c")
  })

  it("escapes SQL LIKE wildcards so they match literally", () => {
    expect(escapeOrIlikeTerm("50%")).toBe("50\\%")
    expect(escapeOrIlikeTerm("a_b")).toBe("a\\_b")
  })

  it("collapses and trims whitespace left by neutralized chars", () => {
    expect(escapeOrIlikeTerm("  x , y  ")).toBe("x y")
  })

  it("defuses an injection-style payload", () => {
    // e.g. `a%),nombre.ilike.%b` — the ),  and , are removed.
    const out = escapeOrIlikeTerm("a%),nombre.ilike.%b")
    expect(out).not.toContain(",")
    expect(out).not.toContain(")")
    expect(out).not.toContain("(")
  })
})
