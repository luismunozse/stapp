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

describe("generateCotizacionPDF — informe tecnico", () => {
  const BASE_INFORME = {
    numeroCotizacion: "COT-0042",
    fecha: new Date("2026-09-04T12:00:00Z"),
    cliente: { nombre: "Ana Gomez", telefono: "1122334455" },
    items: [],
    subtotal: 0,
    iva: 0,
    total: 0,
    veredicto: "IRREPARABLE",
    diagnosticoTecnico: "Corrosion generalizada en la placa madre por contacto con liquido.",
    causaDano: "LIQUIDO",
    presentadoAnte: "La Segunda ART",
  }

  it("titula INFORME TECNICO y no dibuja la tabla de items", async () => {
    const buffer = await generateCotizacionPDF(BASE_INFORME as any)
    const text = await extractPdfText(buffer)

    expect(text).toContain("INFORME TÉCNICO")
    // "DETALLE DE ITEMS" y "SUBTOTAL" son rotulos que existen SOLO dentro del
    // bloque 447-569 que se saltea. No usar not.toContain("COTIZACIÓN"): el
    // banner de validez vive fuera del bloque y probablemente diga "Esta
    // cotización es válida hasta...". Tampoco not.toContain("TOTAL"), que
    // matchea de más.
    expect(text).not.toContain("DETALLE DE ITEMS")
    expect(text).not.toContain("SUBTOTAL")
  })

  it("imprime veredicto, causa, diagnostico y destinatario", async () => {
    const buffer = await generateCotizacionPDF(BASE_INFORME as any)
    const text = await extractPdfText(buffer)

    expect(text).toContain("Irreparable")
    expect(text).toContain("Contacto con líquido")
    expect(text).toContain("Corrosion generalizada")
    expect(text).toContain("La Segunda ART")
  })

  it("con items mantiene el titulo COTIZACION y dibuja la tabla", async () => {
    const buffer = await generateCotizacionPDF({
      ...BASE_INFORME,
      veredicto: "REPARABLE",
      items: [{ descripcion: "Cambio de pantalla", cantidad: 1, precioUnitario: 50000, subtotal: 50000 }],
      subtotal: 50000,
      total: 50000,
    } as any)
    const text = await extractPdfText(buffer)

    expect(text).toContain("COTIZACIÓN")
    expect(text).toContain("DETALLE DE ITEMS")
    expect(text).toContain("Reparable")
  })
})
