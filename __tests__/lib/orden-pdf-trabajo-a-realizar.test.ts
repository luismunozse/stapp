// @vitest-environment node
/**
 * "Trabajo a realizar": en la hoja de recepción el cliente lee qué se le va a hacer
 * al equipo junto al monto, en lugar de la etiqueta genérica "Presupuesto estimado".
 */
import { describe, it, expect } from "vitest"
import { PDFDocument } from "pdf-lib"
import { generateOrdenPDF } from "@/lib/pdf"
import { buildOrdenFixture } from "./orden-fixture"
import { extractPdfText } from "./pdf-text-helper"

async function render(overrides: Record<string, unknown>) {
  const buffer = await generateOrdenPDF({ ...buildOrdenFixture(), ...overrides } as any)
  const doc = await PDFDocument.load(buffer)
  const text = (await extractPdfText(buffer)).replace(/\s+/g, " ")
  return { text, pages: doc.getPageCount() }
}

describe("PDF de la orden — trabajo a realizar", () => {
  it("recepción A4: muestra el trabajo y el monto deja de decir 'estimado'", async () => {
    const { text, pages } = await render({
      estado: "RECIBIDO",
      presupuesto: 115000,
      trabajoARealizar: "Cambio de batería iPhone 13",
    })
    expect(text).toContain("Cambio de batería iPhone 13")
    expect(text).toContain("TRABAJO A REALIZAR")
    expect(text).not.toContain("PRESUPUESTO ESTIMADO")
    expect(pages).toBe(1)
  })

  it("recepción A4: sin trabajo cargado queda como antes", async () => {
    const { text } = await render({ estado: "RECIBIDO", presupuesto: 115000, trabajoARealizar: null })
    expect(text).toContain("PRESUPUESTO ESTIMADO")
    expect(text).not.toContain("TRABAJO A REALIZAR")
  })

  it("recepción A4: un trabajo de 200 caracteres no saca la hoja de una página", async () => {
    const { pages } = await render({ estado: "RECIBIDO", presupuesto: 115000, trabajoARealizar: "x".repeat(200) })
    expect(pages).toBe(1)
  })

  it("recepción A5: el trabajo ocupa el lugar de 'Presupuesto estimado'", async () => {
    const { text } = await render({
      estado: "RECIBIDO",
      paperSize: "A5",
      presupuesto: 115000,
      trabajoARealizar: "Cambio de batería iPhone 13",
    })
    expect(text).toContain("Cambio de batería iPhone 13")
    expect(text).not.toContain("Presupuesto estimado")
  })
})
