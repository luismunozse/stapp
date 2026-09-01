import { describe, it, expect } from "vitest"
import { calcularTotalLote, prorratearLote } from "@/lib/lote-utils"

describe("calcularTotalLote", () => {
  it("returns subtotal when no discount", () => {
    expect(calcularTotalLote(1000, null, null)).toBe(1000)
  })
  it("applies percentage discount", () => {
    expect(calcularTotalLote(1000, "porcentaje", 10)).toBe(900)
  })
  it("applies fixed-amount discount", () => {
    expect(calcularTotalLote(1000, "monto", 250)).toBe(750)
  })
  it("floors at zero when discount exceeds subtotal", () => {
    expect(calcularTotalLote(1000, "monto", 1500)).toBe(0)
  })
  it("rounds percentage results to 2 decimals", () => {
    expect(calcularTotalLote(999.99, "porcentaje", 33)).toBe(669.99)
  })
  it("ignores non-positive discount values", () => {
    expect(calcularTotalLote(1000, "monto", 0)).toBe(1000)
  })
})

describe("prorratearLote", () => {
  it("returns proportional shares that sum exactly to the charged total", () => {
    const shares = prorratearLote([100, 200, 300], 540) // 10% off 600
    expect(shares).toEqual([90, 180, 270])
    expect(shares.reduce((a, b) => a + b, 0)).toBe(540)
  })
  it("assigns rounding remainder to the largest share (first index on ties)", () => {
    const shares = prorratearLote([100, 100, 100], 100)
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 2)
    expect(shares[0]).toBe(33.34)
    expect(shares[1]).toBe(33.33)
    expect(shares[2]).toBe(33.33)
  })
  it("returns zeros when subtotal is zero", () => {
    expect(prorratearLote([0, 0], 0)).toEqual([0, 0])
  })
  it("applies the rounding residual to the largest share, never the last one blindly", () => {
    // costos [10, 10, 0], 33.33% discount -> totalCobrado = 13.33 (round2(20 - 20*0.3333)).
    // Naive last-index residual assignment lands on the zero-cost order and can go
    // negative (e.g. -0.01), which is nonsensical for a montoCobro. The residual must
    // land on the largest underlying monto instead (first max on ties).
    const shares = prorratearLote([10, 10, 0], 13.33)
    expect(shares.every((s) => s >= 0)).toBe(true)
    expect(shares[2]).toBe(0)
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(13.33, 2)
  })
})
