// @vitest-environment node
import { describe, it, expect } from "vitest"
import { textToBytes } from "@/lib/escpos"

describe("textToBytes — mapea acentos españoles a code page 858", () => {
  it("vocales acentuadas → bytes CP858 (no los code points Latin-1)", () => {
    expect(textToBytes("áéíóú")).toEqual([0xa0, 0x82, 0xa1, 0xa2, 0xa3])
  })

  it("ñ y Ñ", () => {
    expect(textToBytes("ñÑ")).toEqual([0xa4, 0xa5])
  })

  it("mayúsculas acentuadas y ü", () => {
    expect(textToBytes("ÁÉÍÓÚÜ")).toEqual([0xb5, 0x90, 0xd6, 0xe0, 0xe9, 0x9a])
  })

  it("signos ¿ ¡ ° y €", () => {
    expect(textToBytes("¿¡°€")).toEqual([0xa8, 0xad, 0xf8, 0xd5])
  })

  it("ASCII pasa igual", () => {
    expect(textToBytes("Abc 123")).toEqual([0x41, 0x62, 0x63, 0x20, 0x31, 0x32, 0x33])
  })

  it("chars no mapeados → '?'", () => {
    expect(textToBytes("好")).toEqual([0x3f])
  })

  it("caso del bug: 'á' NO emite el byte Latin-1 0xE1 (que en CP858 es 'ß')", () => {
    expect(textToBytes("á")).not.toContain(0xe1)
    expect(textToBytes("á")).toEqual([0xa0])
  })
})
