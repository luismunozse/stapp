// @vitest-environment node
/**
 * "Trabajo a realizar" and the warranty line on the A5 / A6 intake order (RECEPCION), mirroring
 * the A4 sheet: page 1 (customer copy) prints the row under "Falla declarada" and
 * "Garantía: N días desde la entrega" above the terms; page 2 (shop copy) prints the row too.
 * The delivery sheet (ENTREGA) prints neither.
 */
import { describe, it, expect } from "vitest"
import { generateOrdenPDF } from "@/lib/pdf"
import { generateOrdenCompactPDF, type FitReport } from "@/lib/pdf-orden-compact"
import { extractPdfTextPositions, type PositionedText } from "./pdf-text-helper"
import { buildOrdenFixture, buildWorstCaseRecepcionFixture } from "./orden-fixture"

type Compact = "A5" | "A6"
const PAPERS: Compact[] = ["A5", "A6"]
const GARANTIA_30 = "Garantía: 30 días desde la entrega"
const TRABAJO = "Cambio de pantalla + bateria"
const LEAN = {
  observaciones: null,
  checklistItems: null,
  checklistNotas: null,
  metadataCampos: null,
  recepcionTerminos: "1. Conserve este comprobante para retirar su equipo.\n2. El presupuesto puede variar.",
}

const pageText = (runs: PositionedText[], page: number) =>
  runs.filter((r) => r.page === page).map((r) => r.text).join(" ").replace(/\s+/g, " ")

async function render(paper: Compact, overrides: Record<string, unknown> = {}) {
  const buffer = await generateOrdenPDF({ ...buildOrdenFixture(), ...LEAN, paperSize: paper, ...overrides } as any)
  const runs = await extractPdfTextPositions(buffer)
  return { runs, pages: new Set(runs.map((r) => r.page)).size }
}

describe.each(PAPERS)("%s RECEPCION: trabajo a realizar y garantía", (paper) => {
  it("page 1 prints the trabajo row under 'Falla declarada'", async () => {
    const { runs } = await render(paper, { soloCliente: true, trabajoARealizar: TRABAJO })
    const p1 = pageText(runs, 0)
    expect(p1).toContain("TRABAJO A REALIZAR")
    expect(p1).toContain(TRABAJO)
    expect(p1.indexOf("TRABAJO A REALIZAR")).toBeGreaterThan(p1.indexOf("FALLA DECLARADA"))
  })

  it("omits the row when trabajo is null, empty or blank", async () => {
    for (const trabajoARealizar of [null, undefined, "", "   "]) {
      const { runs } = await render(paper, { trabajoARealizar })
      expect(pageText(runs, 0)).not.toContain("TRABAJO A REALIZAR")
      expect(pageText(runs, 1)).not.toContain("TRABAJO A REALIZAR")
    }
  })

  it("page 1 prints the warranty line above the terms; 0, null or missing omit it", async () => {
    const { runs } = await render(paper, { soloCliente: true, garantiaDiasDefault: 30 })
    const p1 = pageText(runs, 0)
    expect(p1).toContain(GARANTIA_30)
    expect(p1.indexOf(GARANTIA_30)).toBeLessThan(p1.indexOf("TÉRMINOS Y CONDICIONES"))
    for (const garantiaDiasDefault of [0, null, undefined]) {
      const out = await render(paper, { soloCliente: true, garantiaDiasDefault })
      expect(pageText(out.runs, 0)).not.toContain("Garantía:")
    }
  })

  it("the shop copy (page 2) prints the trabajo row, and the warranty line stays on page 1 only", async () => {
    const { runs, pages } = await render(paper, { trabajoARealizar: TRABAJO, garantiaDiasDefault: 30 })
    expect(pages).toBe(2)
    expect(pageText(runs, 0)).toContain(TRABAJO)
    const p2 = pageText(runs, 1)
    expect(p2).toContain("COPIA PARA EL LOCAL")
    expect(p2).toContain("TRABAJO A REALIZAR")
    expect(p2).toContain(TRABAJO)
    expect(p2).not.toContain("Garantía:")
    expect(pageText(runs, 0).split(GARANTIA_30).length - 1).toBe(1)
  })

  it("the delivery sheet (ENTREGA) prints neither", async () => {
    const { runs } = await render(paper, {
      estado: "ENTREGADO",
      fechaEntrega: new Date(),
      trabajoARealizar: TRABAJO,
      garantiaDiasDefault: 30,
    })
    const all = pageText(runs, 0)
    expect(all).not.toContain("TRABAJO A REALIZAR")
    expect(all).not.toContain("desde la entrega")
  })

  it("worst case (long trabajo + warranty + full fixture): page 1 still fits and both pages stay inside the margin", async () => {
    let report: FitReport | undefined
    const data = { ...buildWorstCaseRecepcionFixture(), paperSize: paper }
    const buffer = await generateOrdenCompactPDF(data as any, paper, { report: (r) => (report = r) })
    const runs = await extractPdfTextPositions(buffer)
    expect(report!.slack).toBeGreaterThanOrEqual(-0.01)
    expect(new Set(runs.map((r) => r.page)).size).toBe(2)
    expect(Math.min(...runs.map((r) => r.y))).toBeGreaterThanOrEqual(8)
    expect(pageText(runs, 0)).toContain("Garantía:")
    expect(pageText(runs, 1)).toContain("TRABAJO A REALIZAR")
  }, 20000)
})
