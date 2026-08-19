// @vitest-environment node
import { describe, it, expect } from "vitest"
import { PDFDocument } from "pdf-lib"
import { generateFacturaPDFReact } from "@/lib/remito-react-pdf"
import { generateFacturaPDF, generateFacturaPDFLegacy } from "@/lib/pdf"

const baseData = {
  numeroFactura: "0001-00000008",
  fecha: new Date("2026-08-17"),
  estadoPago: "PAGADO",
  cliente: { nombre: "Consumidor Final" },
  venta: { numeroVenta: 22 },
  subtotal: 3000,
  iva: 0,
  total: 3000,
  montoAbonado: 3000,
  pagos: [],
}

describe("generateFacturaPDFReact — skeleton", () => {
  it("renders a parseable A4 PDF", async () => {
    const buffer = await generateFacturaPDFReact(baseData as any)
    expect(buffer.length).toBeGreaterThan(0)
    const doc = await PDFDocument.load(buffer)
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1)
    const { width, height } = doc.getPage(0).getSize()
    expect(Math.round(width)).toBe(595)
    expect(Math.round(height)).toBe(842)
  })
})

describe("generateFacturaPDF dispatcher", () => {
  it("uses the react engine by default", async () => {
    delete process.env.REMITO_PDF_ENGINE
    const buffer = await generateFacturaPDF(baseData as any)
    const doc = await PDFDocument.load(buffer)
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1)
  })
  it("falls back to pdf-lib when REMITO_PDF_ENGINE=pdflib", async () => {
    process.env.REMITO_PDF_ENGINE = "pdflib"
    try {
      const buffer = await generateFacturaPDF(baseData as any)
      const legacy = await generateFacturaPDFLegacy(baseData as any)
      expect(buffer.length).toBeGreaterThan(0)
      expect(Math.abs(buffer.length - legacy.length)).toBeLessThan(legacy.length * 0.2)
    } finally {
      delete process.env.REMITO_PDF_ENGINE
    }
  })
})
