// @vitest-environment node
/**
 * Approval (characterization) tests for the A4 order PDF.
 *
 * The A5/A6 work adds a second layout next to the A4 one. A4 must stay exactly as it
 * was, so this pins what the A4 generator draws today: page size plus every text run
 * with its position, for both sheets (RECEPCION and ENTREGA). The snapshot was recorded
 * BEFORE any change to lib/pdf.ts, from the unmodified generator.
 *
 * The same fixture goes through three doors that must all end in the identical drawing:
 * no `paperSize`, `paperSize: "A4"` and an unknown value (the org default can come from a
 * column that does not exist yet, so anything that is not A5/A6 must mean A4).
 */
import { describe, it, expect } from "vitest"
import { PDFDocument } from "pdf-lib"
import { generateOrdenPDF } from "@/lib/pdf"
import { extractPdfTextPositions } from "./pdf-text-helper"
import { buildOrdenFixture } from "./orden-fixture"

const FIXED = new Date("2026-03-10T15:00:00.000Z")

/** The shared fixture with every `new Date()` replaced, so the drawing is reproducible. */
function fixedFixture(overrides: Record<string, unknown> = {}) {
  const base = buildOrdenFixture()
  return {
    ...base,
    fechaIngreso: FIXED,
    fechaPrometida: new Date("2026-03-13T15:00:00.000Z"),
    timeline: [{ estado: "RECIBIDO", fecha: FIXED }],
    garantia: { dias: 90, fechaVencimiento: new Date("2026-06-08T15:00:00.000Z"), notas: null },
    cobros: [{ fecha: FIXED, metodo: "EFECTIVO", referencia: null, monto: 10000 }],
    ...overrides,
  }
}

const ENTREGA = {
  estado: "ENTREGADO",
  fechaEntrega: new Date("2026-03-12T15:00:00.000Z"),
  fechaCompletado: new Date("2026-03-12T14:00:00.000Z"),
  entregadoPor: "M. Gomez",
  costoFinal: 48000,
  totalCobrado: 10000,
  diagnostico: "Bateria agotada, se reemplaza.",
  timeline: [
    { estado: "RECIBIDO", fecha: FIXED },
    { estado: "ENTREGADO", fecha: new Date("2026-03-12T15:00:00.000Z") },
  ],
}

async function drawing(buffer: Buffer) {
  const doc = await PDFDocument.load(buffer)
  const runs = await extractPdfTextPositions(buffer)
  return {
    pages: doc.getPages().map((p) => [p.getWidth(), p.getHeight()]),
    runs: runs.map((r) => [r.text, Math.round(r.x * 100) / 100, Math.round(r.y * 100) / 100]),
  }
}

describe("generateOrdenPDF: the A4 drawing is pinned", () => {
  it("RECEPCION sheet: one 595x842 page and every text run where it was", async () => {
    const out = await drawing(await generateOrdenPDF(fixedFixture()))
    expect(out.pages).toEqual([[595, 842]])
    expect(out.runs.length).toBeGreaterThan(40)
    expect(out).toMatchSnapshot()
  })

  it("ENTREGA sheet: one 595x842 page and every text run where it was", async () => {
    const out = await drawing(await generateOrdenPDF(fixedFixture(ENTREGA)))
    expect(out.pages).toEqual([[595, 842]])
    expect(out.runs.length).toBeGreaterThan(40)
    expect(out).toMatchSnapshot()
  })

  it("paperSize A4 and a value that is not a known size draw exactly what no paperSize draws", async () => {
    for (const extra of [{}, ENTREGA]) {
      const plain = await drawing(await generateOrdenPDF(fixedFixture(extra)))
      const explicit = await drawing(await generateOrdenPDF(fixedFixture({ ...extra, paperSize: "A4" })))
      const unknown = await drawing(await generateOrdenPDF(fixedFixture({ ...extra, paperSize: "LEGAL" })))
      const empty = await drawing(await generateOrdenPDF(fixedFixture({ ...extra, paperSize: null })))
      expect(explicit).toEqual(plain)
      expect(unknown).toEqual(plain)
      expect(empty).toEqual(plain)
    }
  })
})
