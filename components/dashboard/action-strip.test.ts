import { describe, it, expect } from "vitest"
import { buildAdminActions } from "./action-strip"

const base = {
  moneda: "ARS" as const,
  cobrosCount: 0,
  deudaTotal: 0,
  slaVencidasCount: 0,
  garantiasCount: 0,
  stockBajoCount: 0,
}

describe("buildAdminActions", () => {
  it("returns no items when every count is zero", () => {
    expect(buildAdminActions(base)).toEqual([])
  })

  it("includes only the concerns whose count is > 0", () => {
    const items = buildAdminActions({ ...base, cobrosCount: 8, deudaTotal: 320000, stockBajoCount: 5 })
    expect(items.map((i) => i.id)).toEqual(["cobros", "stock"])
  })

  it("uses danger tone for cobros and SLA, warning for garantias and stock", () => {
    const items = buildAdminActions({ ...base, cobrosCount: 1, slaVencidasCount: 1, garantiasCount: 1, stockBajoCount: 1 })
    const tone = (id: string) => items.find((i) => i.id === id)?.tone
    expect(tone("cobros")).toBe("danger")
    expect(tone("sla")).toBe("danger")
    expect(tone("garantias")).toBe("warning")
    expect(tone("stock")).toBe("warning")
  })
})
