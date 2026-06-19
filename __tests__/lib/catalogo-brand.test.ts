import { describe, it, expect } from "vitest"
import { getBrandTheme } from "@/lib/catalogo/brand"

describe("getBrandTheme", () => {
  it("dark brand gets white foreground", () => {
    expect(getBrandTheme("#1d4ed8").brandForeground).toBe("#ffffff")
  })
  it("light brand gets dark foreground", () => {
    expect(getBrandTheme("#fde047").brandForeground).toBe("#1a1a1a")
  })
  it("normalizes #rgb shorthand to #rrggbb", () => {
    expect(getBrandTheme("#abc").brand).toBe("#aabbcc")
  })
  it("normalizes to lowercase 6-digit hex", () => {
    expect(getBrandTheme("#1D4ED8").brand).toBe("#1d4ed8")
  })
  it("falls back to a safe default for invalid input", () => {
    expect(getBrandTheme("not-a-color").brand).toBe("#0f172a")
    expect(getBrandTheme("").brand).toBe("#0f172a")
  })
  it("builds tint and tintStrong as 8-digit hex (rgb + alpha)", () => {
    const t = getBrandTheme("#1d4ed8")
    expect(t.tint).toBe("#1d4ed814")
    expect(t.tintStrong).toBe("#1d4ed826")
  })
})
