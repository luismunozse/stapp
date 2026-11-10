import { describe, it, expect } from "vitest"
import { generateDescription } from "@/lib/audit"

describe("audit descriptions", () => {
  it("names the commission rules instead of the raw entity key", () => {
    const text = generateDescription("UPDATE", "comisiones_config", "org-123456", { before: {}, after: {} })
    expect(text).toContain("reglas de comisiones")
    expect(text).not.toContain("comisiones_config")
  })
})
