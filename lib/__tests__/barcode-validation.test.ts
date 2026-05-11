import { describe, it, expect } from "vitest"
import {
  isValidEAN13,
  isValidEAN8,
  isValidUPCA,
  computeEAN13CheckDigit,
  validateBarcode,
} from "../barcode-validation"

describe("isValidEAN13", () => {
  it("acepta EAN-13 con checksum correcto", () => {
    expect(isValidEAN13("4006381333931")).toBe(true)
  })

  it("acepta EAN-13 generado por computeChecksum", () => {
    // 590123412345 + check
    const check = computeEAN13CheckDigit("590123412345")
    expect(isValidEAN13("590123412345" + check)).toBe(true)
  })

  it("rechaza checksum incorrecto", () => {
    expect(isValidEAN13("4006381333930")).toBe(false)
    expect(isValidEAN13("0000000000001")).toBe(false)
  })

  it("rechaza longitud incorrecta", () => {
    expect(isValidEAN13("400638133393")).toBe(false)
    expect(isValidEAN13("40063813339311")).toBe(false)
    expect(isValidEAN13("")).toBe(false)
  })

  it("rechaza no-dígitos", () => {
    expect(isValidEAN13("400638133393A")).toBe(false)
    expect(isValidEAN13("ABCDEFGHIJKLM")).toBe(false)
  })
})

describe("isValidEAN8", () => {
  it("acepta EAN-8 conocido", () => {
    // 96385074 — EAN-8 ejemplo Wikipedia
    expect(isValidEAN8("96385074")).toBe(true)
  })

  it("rechaza checksum mal", () => {
    expect(isValidEAN8("96385075")).toBe(false)
  })

  it("rechaza longitud incorrecta", () => {
    expect(isValidEAN8("9638507")).toBe(false)
    expect(isValidEAN8("963850740")).toBe(false)
  })
})

describe("isValidUPCA", () => {
  it("acepta UPC-A conocido", () => {
    // 036000291452 — Wikipedia ejemplo
    expect(isValidUPCA("036000291452")).toBe(true)
  })

  it("rechaza checksum mal", () => {
    expect(isValidUPCA("036000291453")).toBe(false)
  })

  it("rechaza longitud incorrecta", () => {
    expect(isValidUPCA("03600029145")).toBe(false)
  })
})

describe("computeEAN13CheckDigit", () => {
  it("calcula dígito conocido", () => {
    // Wikipedia: 400638133393 + 1
    expect(computeEAN13CheckDigit("400638133393")).toBe("1")
  })

  it("retorna null si input no son 12 dígitos", () => {
    expect(computeEAN13CheckDigit("40063813339")).toBeNull()
    expect(computeEAN13CheckDigit("4006381333931")).toBeNull()
    expect(computeEAN13CheckDigit("ABCDEFGHIJKL")).toBeNull()
  })

  it("dígito calculado produce EAN-13 válido", () => {
    const prefix = "590123412345"
    const check = computeEAN13CheckDigit(prefix)
    expect(check).not.toBeNull()
    expect(isValidEAN13(prefix + check)).toBe(true)
  })
})

describe("validateBarcode", () => {
  it("retorna null para CODE128 alfanumérico", () => {
    expect(validateBarcode("ABC-123")).toBeNull()
    expect(validateBarcode("PROD_42_X")).toBeNull()
  })

  it("retorna null para EAN-13 válido", () => {
    expect(validateBarcode("4006381333931")).toBeNull()
  })

  it("retorna error para EAN-13 con checksum mal", () => {
    const err = validateBarcode("4006381333930")
    expect(err).not.toBeNull()
    expect(err?.kind).toBe("invalid_ean13")
    expect(err?.expected).toBe("4006381333931")
  })

  it("retorna error para EAN-8 con checksum mal", () => {
    const err = validateBarcode("96385075")
    expect(err?.kind).toBe("invalid_ean8")
    expect(err?.expected).toBe("96385074")
  })

  it("retorna error para UPC-A con checksum mal", () => {
    const err = validateBarcode("036000291453")
    expect(err?.kind).toBe("invalid_upca")
    expect(err?.expected).toBe("036000291452")
  })

  it("acepta longitudes no-EAN sin validar checksum", () => {
    expect(validateBarcode("12345")).toBeNull()
    expect(validateBarcode("123456789")).toBeNull()
    expect(validateBarcode("12345678901234")).toBeNull()
  })

  it("12 dígitos con checksum UPC válido pasa", () => {
    expect(validateBarcode("036000291452")).toBeNull()
  })
})
