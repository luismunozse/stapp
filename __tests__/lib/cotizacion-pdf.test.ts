// @vitest-environment node
/**
 * Smoke coverage for generateCotizacionPDF, written BEFORE the monochrome
 * restyle (Phase 2, Task 2) as a safety net for behavior/content — not
 * colors — so it should pass unchanged both before and after the restyle.
 *
 * Covers both `tipo` variants:
 *  - "ORDEN": cotización ligada a una orden existente (no equipo/checklist/
 *    condiciones), exercising the IVA row and per-item discount tag.
 *  - "PRESUPUESTO": card de equipo, checklist de recepción, condiciones
 *    técnicas y firma de aprobación del cliente.
 *
 * Assertions intentionally avoid strings whose casing the restyle is
 * expected to change (e.g. the item table's column headers, which move
 * from mixed-case to bold uppercase per house style) — see the visible
 * section headings, labels and values instead, all of which are already
 * uppercase/stable in the current implementation.
 */
import { describe, it, expect } from "vitest"
import { generateCotizacionPDF } from "@/lib/pdf"
import { extractPdfText } from "./pdf-text-helper"
import { buildCotizacionOrdenFixture, buildCotizacionPresupuestoFixture } from "./cotizacion-fixture"

describe("generateCotizacionPDF — tipo ORDEN", () => {
  it("renders all key sections", async () => {
    const buffer = await generateCotizacionPDF(buildCotizacionOrdenFixture())
    const text = await extractPdfText(buffer)

    expect(text).toContain("COTIZACIÓN")
    expect(text).toContain("Roberto Gómez")
    expect(text).toContain("iPhone 12")
    expect(text).toContain("PANTALLA IPHONE 12 OLED")
    expect(text).toContain("Cotizacion valida hasta") // vencimiento banner
    expect(text).toContain("Gracias por su confianza") // footer, no firma
    expect(buffer.length).toBeGreaterThan(1000)
  })
})

describe("generateCotizacionPDF — tipo PRESUPUESTO", () => {
  it("renders equipo card, checklist, condiciones and approval signature", async () => {
    const buffer = await generateCotizacionPDF(buildCotizacionPresupuestoFixture())
    const text = await extractPdfText(buffer)

    expect(text).toContain("COTIZACIÓN")
    expect(text).toContain("Valentina Ríos")
    expect(text).toContain("Samsung Galaxy S22")
    expect(text).toContain("358400123456999") // IMEI
    expect(text).toContain("LIMPIEZA POR LIQUIDO")

    // Checklist de recepción
    expect(text).toContain("CHECKLIST DE RECEPCIÓN")
    expect(text).toContain("Pantalla con rayones")
    expect(text).toContain("Cargador entregado")

    // Condiciones técnicas
    expect(text).toContain("CONDICIONES TÉCNICAS")
    expect(text).toContain("Garantía:")
    expect(text).toContain("Plazo estimado:")

    // Firma de aprobación (only rendered when firmaAprobacion + firmaMime present)
    expect(text).toContain("Aprobado:")

    // Footer switches message when the document was approved
    expect(text).toContain("Documento aprobado por el cliente")

    expect(buffer.length).toBeGreaterThan(1000)
  })
})
