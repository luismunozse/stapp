// @vitest-environment node
/**
 * Hojas A4 de la orden: un texto que no entra se corta con "…" visible (nunca
 * en silencio), el diagnóstico de la entrega tiene hasta 5 renglones y la hoja
 * más cargada posible sigue entrando en una página.
 */
import { describe, it, expect } from "vitest"
import { PDFDocument } from "pdf-lib"
import { generateOrdenPDF } from "@/lib/pdf"
import { buildOrdenFixture } from "./orden-fixture"
import { extractPdfText, extractPdfTextPositions } from "./pdf-text-helper"

const largo = (palabra: string, n: number) => Array.from({ length: n }, (_, i) => `${palabra}${i + 1}`).join(" ")

async function render(overrides: Record<string, unknown>) {
  const buffer = await generateOrdenPDF({ ...buildOrdenFixture(), ...overrides } as any)
  const doc = await PDFDocument.load(buffer)
  const text = (await extractPdfText(buffer)).replace(/\s+/g, " ")
  const runs = await extractPdfTextPositions(buffer)
  return { text, runs, pages: doc.getPageCount() }
}

describe("PDF A4 de la orden — textos largos", () => {
  it("entrega: el diagnóstico usa hasta 5 renglones y avisa el corte con …", async () => {
    const { text, runs } = await render({ estado: "ENTREGADO", diagnostico: largo("diag", 200) })
    expect(text).toContain("diag1 ")
    expect(text).not.toContain("diag200")
    const diagRuns = runs.filter((r) => /diag\d/.test(r.text))
    expect(diagRuns).toHaveLength(5)
    expect(diagRuns[diagRuns.length - 1].text.endsWith("…")).toBe(true)
  })

  it("entrega: un diagnóstico corto no lleva …", async () => {
    const { runs } = await render({ estado: "ENTREGADO", diagnostico: "Se cambió el conector." })
    expect(runs.some((r) => r.text.includes("Se cambió el conector.") && !r.text.includes("…"))).toBe(true)
  })

  it("accesorios largos se ven en dos renglones con … (antes se cortaban a 70 caracteres sin aviso)", async () => {
    for (const estado of ["RECIBIDO", "ENTREGADO"]) {
      const { runs } = await render({ estado, accesorios: largo("acc", 80) })
      const accRuns = runs.filter((r) => /acc\d/.test(r.text))
      expect(accRuns.length, estado).toBe(2)
      expect(accRuns[1].text.endsWith("…"), estado).toBe(true)
    }
  })

  it("recepción: la falla larga termina en …", async () => {
    const { runs } = await render({ estado: "RECIBIDO", problemaReportado: largo("falla", 200) })
    const fallaRuns = runs.filter((r) => r.page === 0 && /falla\d/.test(r.text))
    expect(fallaRuns.some((r) => r.text.endsWith("…"))).toBe(true)
  })

  it("la entrega más cargada posible sigue en una página y nada se dibuja fuera de la hoja", async () => {
    const { runs, pages, text } = await render({
      estado: "ENTREGADO",
      problemaReportado: largo("falla", 200),
      diagnostico: largo("diag", 200),
      accesorios: largo("acc", 80),
      notasEntrega: largo("nota", 120),
      trabajos: Array.from({ length: 20 }, (_, i) => ({ nombre: `Repuesto ${i + 1}`, cantidad: 1, importe: 1000 + i })),
      cobros: Array.from({ length: 12 }, () => ({ fecha: new Date(), metodo: "EFECTIVO", referencia: "ref", monto: 100 })),
      garantia: { dias: 90, fechaVencimiento: new Date(), notas: largo("gar", 80) },
      avances: Array.from({ length: 20 }, (_, i) => ({ fecha: new Date(), texto: largo(`av${i}x`, 30) })),
      costoFinal: 50000,
      totalCobrado: 1200,
    })
    expect(pages).toBe(1)
    const minY = Math.min(...runs.map((r) => r.y))
    expect(minY).toBeGreaterThan(0)
    // Lo que no entra se avisa; los totales y el saldo nunca se pierden.
    expect(text).toMatch(/\+\d+ ítems más/)
    expect(text).toContain("TOTAL FINAL")
    expect(text).toContain("SALDO")
  })
})
