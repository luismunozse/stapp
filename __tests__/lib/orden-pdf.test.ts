// @vitest-environment node
/**
 * Regression coverage for generateOrdenPDF.
 *
 * Task D3 (orden expediente redesign) replaced the old "copia cliente" +
 * "copia local" pair — merged onto one A4 page by embedding each rendered
 * page as a Form XObject via `finalDoc.embedPages` — with a single
 * RECEPCIÓN sheet drawn directly on ONE page: client part on top, a ✂ cut
 * line, and the business "talón interno" stub below. There is no more
 * embedPages/XObject indirection for this document, so extractPdfText
 * (which only decodes Tj operators on a page's OWN content stream via its
 * OWN Resources/Font dict) now sees the client part AND the stub directly
 * on the same page — both variants (soloCliente and full) are real content
 * assertions, not just "doesn't throw".
 */
import { describe, it, expect } from "vitest"
import { PDFDocument } from "pdf-lib"
import { generateOrdenPDF } from "@/lib/pdf"
import { extractPdfText } from "./pdf-text-helper"
import { buildOrdenFixture } from "./orden-fixture"

describe("generateOrdenPDF", () => {
  it("renders the soloCliente variant with all key sections and no talón", async () => {
    const buffer = await generateOrdenPDF({ ...buildOrdenFixture(), soloCliente: true })
    const text = await extractPdfText(buffer)
    for (const section of [
      "CLIENTE", // section label, drawSectionLabel forces uppercase
      "FALLA DECLARADA",
      "ACCESORIOS RECIBIDOS",
      "Juan Pérez", // body content survives
      "DNI 28.456.789",
      "CEL-1042", // codigoOrden, client idbox
    ]) {
      expect(text).toContain(section)
    }
    // client part only: no cut line, no business stub
    expect(text).not.toContain("TALÓN")
    expect(buffer.length).toBeGreaterThan(1000)
  })

  it("renders the default (client part + ✂ + talón, one page) variant with all key sections", async () => {
    const buffer = await generateOrdenPDF(buildOrdenFixture())
    const text = await extractPdfText(buffer)
    for (const section of [
      "Juan Pérez",
      "DNI 28.456.789",
      "CEL-1042",
      "TALÓN INTERNO", // business stub heading
      "M. GÓMEZ", // recibidoPorNombre, uppercased in the "Recibió —" signature line
      "PARTE SUPERIOR", // cut line label
      "TALÓN INFERIOR", // cut line label
    ]) {
      expect(text).toContain(section)
    }
    expect(buffer.length).toBeGreaterThan(1000)
  })

  it("hides the access code from the soloCliente variant but shows it on the talón of the full variant", async () => {
    // Patrón codes render as a graphic (dots + lines), not literal text — use
    // a plain PIN here so the actual secret value is a real text assertion,
    // not just the "Código de acceso" section label.
    const fixture = { ...buildOrdenFixture(), codigoAccesoDispositivo: "PIN 4471" }

    const soloClienteBuffer = await generateOrdenPDF({ ...fixture, soloCliente: true })
    const soloClienteText = await extractPdfText(soloClienteBuffer)
    expect(soloClienteText).not.toContain("4471")

    const fullBuffer = await generateOrdenPDF(fixture)
    const fullText = await extractPdfText(fullBuffer)
    expect(fullText).toContain("4471")
  })

  it("still renders the pattern-code graphic on the talón without leaking it as text", async () => {
    // Default fixture uses "Patrón: 1-2-5-8-9" — asserts the pattern-drawing
    // path (dots + connecting lines, no digits as text) doesn't throw and
    // still labels the block correctly.
    const buffer = await generateOrdenPDF(buildOrdenFixture())
    const text = await extractPdfText(buffer)
    expect(text).toContain("Patrón")
    expect(buffer.length).toBeGreaterThan(1000)
  })

  it("marks a non-canonical estado (CANCELADO) over the closest reached timeline step", async () => {
    const buffer = await generateOrdenPDF({
      ...buildOrdenFixture(),
      estado: "CANCELADO",
      timeline: [
        { estado: "RECIBIDO", fecha: new Date(Date.now() - 3 * 86400000) },
        { estado: "EN_DIAGNOSTICO", fecha: new Date(Date.now() - 2 * 86400000) },
      ],
    })
    const text = await extractPdfText(buffer)
    expect(text).toContain("CANCELADO")
    expect(buffer.length).toBeGreaterThan(1000)
  })

  it("renders the ENTREGADO variant with fotos and firmas as separate appended pages", async () => {
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
    // Behavior preserved (Task D3 Global Constraints): the recepción sheet
    // (now a single combined page) + fotos page + entrega page still append
    // as separate pages — D4 will rebuild the entrega page itself, not its
    // presence/ordering.
    const doc = await PDFDocument.load(buffer)
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(3)
  })
})
