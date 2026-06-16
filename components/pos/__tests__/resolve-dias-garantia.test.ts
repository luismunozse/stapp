import { describe, it, expect } from "vitest"
import { resolveDiasGarantia } from "../pos-types"

describe("resolveDiasGarantia", () => {
  it("returns productDefault when it is a finite non-negative number", () => {
    expect(resolveDiasGarantia(10, 30)).toBe(10)
  })

  it("returns 0 (explicit product default) as a valid value, not unset", () => {
    expect(resolveDiasGarantia(0, 30)).toBe(0)
  })

  it("falls through to orgDefault when productDefault is null", () => {
    expect(resolveDiasGarantia(null, 30)).toBe(30)
  })

  it("falls through to orgDefault when productDefault is undefined", () => {
    expect(resolveDiasGarantia(undefined, 30)).toBe(30)
  })

  it("falls through to orgDefault when productDefault is NaN", () => {
    expect(resolveDiasGarantia(NaN, 30)).toBe(30)
  })

  it("falls through to orgDefault when productDefault is negative", () => {
    expect(resolveDiasGarantia(-1, 30)).toBe(30)
  })

  it("returns 0 when both productDefault and orgDefault are null", () => {
    expect(resolveDiasGarantia(null, null)).toBe(0)
  })

  it("returns 0 when both productDefault and orgDefault are undefined", () => {
    expect(resolveDiasGarantia(undefined, undefined)).toBe(0)
  })

  it("returns 0 when orgDefault is NaN and productDefault is null", () => {
    expect(resolveDiasGarantia(null, NaN)).toBe(0)
  })

  it("returns 0 when orgDefault is negative and productDefault is null", () => {
    expect(resolveDiasGarantia(null, -5)).toBe(0)
  })

  it("uses orgDefault (0) when productDefault is null and orgDefault is 0", () => {
    expect(resolveDiasGarantia(null, 0)).toBe(0)
  })

  it("returns productDefault of 5 over orgDefault of 90", () => {
    expect(resolveDiasGarantia(5, 90)).toBe(5)
  })
})
