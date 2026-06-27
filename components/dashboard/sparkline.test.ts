import { describe, it, expect } from "vitest"
import { sparklinePoints } from "./sparkline"

describe("sparklinePoints", () => {
  it("returns empty string for empty data", () => {
    expect(sparklinePoints([], 280, 40)).toBe("")
  })

  it("maps a single value to a flat line at vertical center", () => {
    expect(sparklinePoints([5], 280, 40)).toBe("0,20")
  })

  it("puts the max at the top (y=0) and the min at the bottom (y=height)", () => {
    expect(sparklinePoints([0, 10], 280, 40)).toBe("0,40 280,0")
  })
})
