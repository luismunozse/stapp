import { describe, it, expect } from "vitest"
import { resolveFeatureAccess } from "@/lib/subscriptions"

describe("resolveFeatureAccess", () => {
  it("override true beats plan false", () => {
    expect(resolveFeatureAccess(false, true)).toBe(true)
  })

  it("override false beats plan true", () => {
    expect(resolveFeatureAccess(true, false)).toBe(false)
  })

  it("null override falls back to plan true", () => {
    expect(resolveFeatureAccess(true, null)).toBe(true)
  })

  it("null override falls back to plan false", () => {
    expect(resolveFeatureAccess(false, null)).toBe(false)
  })
})
