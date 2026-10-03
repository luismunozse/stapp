import { describe, it, expect } from "vitest"
import {
  checkCompatibility,
  detectFormat,
  resolveLabelContent,
  type LabelContentOptions,
} from "@/lib/labels/label-content"

const base: LabelContentOptions = {
  outputFormat: "PDF",
  barcodeFormat: "AUTO",
  showBarcode: true,
  showName: true,
  showCode: true,
  showPrice: true,
}

const withCode = { nombre: "Cable USB", codigo: "ABC-1", barcode: null, precioVenta: 10 }
const noCode = { nombre: "Mano de obra", codigo: "", barcode: null, precioVenta: 10 }

describe("detectFormat / checkCompatibility", () => {
  it("detecta formatos por largo", () => {
    expect(detectFormat("7790001000017")).toBe("EAN13")
    expect(detectFormat("123456789012")).toBe("UPC")
    expect(detectFormat("12345678")).toBe("EAN8")
    expect(detectFormat("ABC")).toBe("CODE128")
  })
  it("rechaza vacío y largo incorrecto", () => {
    expect(checkCompatibility("  ", "AUTO").ok).toBe(false)
    expect(checkCompatibility("123", "EAN13").ok).toBe(false)
    expect(checkCompatibility("ABC", "CODE128").ok).toBe(true)
  })
})

describe("resolveLabelContent en PDF", () => {
  it("item con código compatible imprime con código de barras", () => {
    const r = resolveLabelContent(withCode, base)
    expect(r.printable).toBe(true)
    expect(r.barcode).toBe(true)
    expect(r.code).toBe("ABC-1")
    expect(r.showCodeText).toBe(true)
    expect(r.notice).toBeUndefined()
  })

  it("item sin código imprime como etiqueta de precio y no está bloqueado", () => {
    const r = resolveLabelContent(noCode, base)
    expect(r.printable).toBe(true)
    expect(r.barcode).toBe(false)
    expect(r.showCodeText).toBe(false)
    expect(r.showName).toBe(true)
    expect(r.showPrice).toBe(true)
    expect(r.notice).toMatch(/Sin código/)
  })

  it("usa barcode antes que codigo y recorta espacios", () => {
    const r = resolveLabelContent({ ...withCode, barcode: " 999 " }, base)
    expect(r.code).toBe("999")
  })

  it("un barcode solo con espacios no tapa un codigo valido", () => {
    const r = resolveLabelContent({ ...withCode, barcode: "  " }, base)
    expect(r.code).toBe("ABC-1")
    expect(r.barcode).toBe(true)
  })

  it("código incompatible con el formato imprime sin barras y avisa el motivo", () => {
    const r = resolveLabelContent(withCode, { ...base, barcodeFormat: "EAN13" })
    expect(r.printable).toBe(true)
    expect(r.barcode).toBe(false)
    expect(r.notice).toMatch(/^Se imprime sin código de barras: /)
    expect(r.notice).toMatch(/13 dígitos/)
  })

  it("con showBarcode apagado nunca lleva barras y no avisa por incompatibilidad", () => {
    const r = resolveLabelContent(withCode, { ...base, showBarcode: false, barcodeFormat: "EAN13" })
    expect(r.printable).toBe(true)
    expect(r.barcode).toBe(false)
    expect(r.notice).toBeUndefined()
  })

  it("la línea de código solo sale si hay código y showCode", () => {
    expect(resolveLabelContent(withCode, { ...base, showCode: false }).showCodeText).toBe(false)
    expect(resolveLabelContent(noCode, base).showCodeText).toBe(false)
  })

  it("sin nombre, precio ni barras no es imprimible", () => {
    const r = resolveLabelContent(noCode, { ...base, showName: false, showPrice: false })
    expect(r.printable).toBe(false)
  })

  it("con código y solo barras sigue siendo imprimible", () => {
    const r = resolveLabelContent(withCode, { ...base, showName: false, showPrice: false })
    expect(r.printable).toBe(true)
  })
})

describe("resolveLabelContent en ZPL/EPL", () => {
  it.each(["ZPL", "EPL"] as const)("%s: sin código queda bloqueado con motivo claro", (outputFormat) => {
    const r = resolveLabelContent(noCode, { ...base, outputFormat })
    expect(r.printable).toBe(false)
    expect(r.blockedReason).toBe("Sin código: las plantillas Zebra requieren código de barras")
  })

  it("con código imprime y no valida el formato", () => {
    const r = resolveLabelContent(withCode, { ...base, outputFormat: "ZPL", barcodeFormat: "EAN13" })
    expect(r.printable).toBe(true)
    expect(r.barcode).toBe(true)
    expect(r.notice).toBeUndefined()
  })

  it("ignora showBarcode apagado", () => {
    const r = resolveLabelContent(withCode, { ...base, outputFormat: "EPL", showBarcode: false })
    expect(r.printable).toBe(true)
  })
})
