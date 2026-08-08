// @vitest-environment node
/**
 * Regression coverage for generateOrdenPDF, written BEFORE the monochrome
 * restyle of the client-copy page (Task 4 of the A4 receipts redesign) as a
 * safety net for behavior/content — not colors — so it should pass
 * unchanged both before and after the restyle.
 *
 * Content assertions run against the `soloCliente: true` variant only.
 * The default (non-soloCliente) output merges the client copy + local copy
 * onto one physical A4 page by embedding each rendered page as a Form
 * XObject (see the "ENSAMBLAR" step in generateOrdenPDF) — extractPdfText
 * only decodes Tj operators on the page's own content stream via its own
 * Resources/Font dict, and an embedded XObject carries its own separate
 * Resources, so none of the client/local copy text is visible at that top
 * level (confirmed empirically: extraction returns just the "✂" cut-line
 * glyph). The soloCliente variant returns the client-copy page unwrapped,
 * so it is the one that actually exercises text extraction.
 */
import { describe, it, expect } from "vitest"
import { generateOrdenPDF } from "@/lib/pdf"
import { extractPdfText } from "./pdf-text-helper"
import { buildOrdenFixture } from "./orden-fixture"

describe("generateOrdenPDF", () => {
  it("renders the soloCliente variant with all key sections", async () => {
    const buffer = await generateOrdenPDF({ ...buildOrdenFixture(), soloCliente: true })
    const text = await extractPdfText(buffer)
    for (const section of [
      "COMPROBANTE DE RECEPCIÓN",
      "CLIENTE",
      "PROBLEMA REPORTADO",
      "ACCESORIOS",
      "Juan Pérez", // body content survives
    ]) {
      expect(text).toContain(section)
    }
    expect(buffer.length).toBeGreaterThan(1000)
  })

  it("renders the default (client + local copy merged) variant without throwing", async () => {
    const buffer = await generateOrdenPDF(buildOrdenFixture())
    expect(buffer.length).toBeGreaterThan(1000)
  })

  it("renders the ENTREGADO variant with fotos and firmas", async () => {
    // Minimal 1x1 PNG, embedded as a data: URL so the fotos-de-ingreso fetch
    // works offline (fetch() resolves data: URLs in Node 18+), and reused as
    // a stand-in signature image — same trick as pdf-samples.test.ts.
    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

    const buffer = await generateOrdenPDF({
      ...buildOrdenFixture(),
      estado: "ENTREGADO",
      fotosIngreso: [
        { url: `data:image/png;base64,${pngBase64}`, descripcion: "Pantalla con manchas de humedad" },
        { url: `data:image/png;base64,${pngBase64}`, descripcion: "Puerto de carga oxidado" },
      ],
      fechaEntrega: new Date(),
      firmaClienteEntrega: pngBase64,
      firmaEncargadoEntrega: pngBase64,
      entregadoPor: "María Gómez",
      notasEntrega: "Se entrega el equipo funcionando correctamente. Cliente conforme.",
    })
    expect(buffer.length).toBeGreaterThan(1000)
  })
})
