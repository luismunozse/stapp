import { describe, it, expect } from "vitest"
import { parseStock, parsePrecio } from "@/lib/catalogo/inline-edit"

describe("parseStock", () => {
  it("empty string -> null (sin tracking)", () => {
    expect(parseStock("")).toEqual({ ok: true, value: null })
    expect(parseStock("   ")).toEqual({ ok: true, value: null })
  })
  it("0 is valid (agotado)", () => {
    expect(parseStock("0")).toEqual({ ok: true, value: 0 })
  })
  it("positive integer ok", () => {
    expect(parseStock("12")).toEqual({ ok: true, value: 12 })
  })
  it("rejects decimals", () => {
    expect(parseStock("1.5")).toEqual({ ok: false })
  })
  it("rejects negatives", () => {
    expect(parseStock("-3")).toEqual({ ok: false })
  })
  it("rejects non-numeric", () => {
    expect(parseStock("abc")).toEqual({ ok: false })
  })
  it("accepts leading zeros (007 -> 7)", () => {
    expect(parseStock("007")).toEqual({ ok: true, value: 7 })
  })
  it("rejects explicit plus sign", () => {
    expect(parseStock("+5")).toEqual({ ok: false })
  })
})

describe("parsePrecio", () => {
  it("empty string -> null (Consultar)", () => {
    expect(parsePrecio("")).toEqual({ ok: true, value: null })
    expect(parsePrecio("  ")).toEqual({ ok: true, value: null })
  })
  it("integer ok", () => {
    expect(parsePrecio("1000")).toEqual({ ok: true, value: 1000 })
  })
  it("two decimals with dot ok", () => {
    expect(parsePrecio("99.50")).toEqual({ ok: true, value: 99.5 })
  })
  it("comma is normalized to dot", () => {
    expect(parsePrecio("99,50")).toEqual({ ok: true, value: 99.5 })
  })
  it("0 is valid", () => {
    expect(parsePrecio("0")).toEqual({ ok: true, value: 0 })
  })
  it("rejects more than 2 decimals", () => {
    expect(parsePrecio("1.999")).toEqual({ ok: false })
  })
  it("rejects negatives", () => {
    expect(parsePrecio("-5")).toEqual({ ok: false })
  })
  it("rejects non-numeric", () => {
    expect(parsePrecio("10x")).toEqual({ ok: false })
  })
  it("rejects trailing dot", () => {
    expect(parsePrecio("1.")).toEqual({ ok: false })
  })
  it("rejects explicit plus sign", () => {
    expect(parsePrecio("+5")).toEqual({ ok: false })
  })
})
