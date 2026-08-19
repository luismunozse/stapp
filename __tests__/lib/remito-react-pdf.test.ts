// @vitest-environment node
import { describe, it, expect } from "vitest"
import { PDFDocument } from "pdf-lib"
import { generateFacturaPDFReact } from "@/lib/remito-react-pdf"
import { generateFacturaPDF, generateFacturaPDFLegacy } from "@/lib/pdf"
import { extractReactPdfText, extractReactPdfTextPositions } from "./pdf-text-helper-react"
import { extractPdfText } from "./pdf-text-helper"

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

describe("react-pdf text extraction", () => {
  it("reads text content from react-pdf output", async () => {
    const buffer = await generateFacturaPDFReact(baseData as any)
    const text = await extractReactPdfText(buffer)
    expect(text).toContain("REMITO")
    expect(text).toContain("Documento no válido como comprobante fiscal")
    expect(text).toContain("Consumidor Final")
  })
  it("reports positions with page numbers", async () => {
    const buffer = await generateFacturaPDFReact(baseData as any)
    const items = await extractReactPdfTextPositions(buffer)
    const remito = items.find((i) => i.text.includes("REMITO"))
    expect(remito).toBeDefined()
    expect(remito!.page).toBe(1)
    expect(remito!.y).toBeGreaterThan(600) // upper third of the A4 page
  })
})

describe("generateFacturaPDF dispatcher", () => {
  it("uses the react engine by default", async () => {
    delete process.env.REMITO_PDF_ENGINE
    const buffer = await generateFacturaPDF(baseData as any)
    const doc = await PDFDocument.load(buffer)
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1)

    // Fingerprint the engine. `extractReactPdfText` (pdfjs-dist) is NOT a
    // valid discriminator on its own: pdfjs-dist happily decodes pdf-lib's
    // Type0/ToUnicode-CMap output too, so both engines' buffers contain
    // "REMITO" under it (verified empirically). The reliable signal is the
    // OTHER direction: `extractPdfText` (./pdf-text-helper) walks content
    // streams assuming pdf-lib's own conventions — hex `<...> Tj` CID codes
    // decoded via each font's ToUnicode CMap, positioned by a literal
    // `1 0 0 1 x y Tm` immediately before the Tj. react-pdf's output uses
    // literal-string Tj operators and a different operator sequence, so that
    // walk structurally cannot decode anything from it and returns "" — a
    // deterministic, non-flaky "this is NOT pdf-lib output" check.
    const text = await extractReactPdfText(buffer)
    expect(text).toContain("REMITO")
    expect(await extractPdfText(buffer)).toBe("")
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
