// @vitest-environment node
/**
 * Avances de la orden en el PDF: solo en la hoja de entrega, solo los que
 * llegan (las rutas ya filtran los internos), y la hoja sigue en una página.
 */
import { describe, it, expect } from "vitest"
import { PDFDocument } from "pdf-lib"
import { generateOrdenPDF } from "@/lib/pdf"
import { buildOrdenFixture } from "./orden-fixture"
import { extractPdfText } from "./pdf-text-helper"

const avances = [
  { fecha: new Date("2026-11-05T15:00:00Z"), texto: "Se desarmó el equipo, hay sulfato en el conector" },
  { fecha: new Date("2026-11-07T15:00:00Z"), texto: "Se reemplazó el conector de carga" },
]

async function render(overrides: Record<string, unknown>) {
  const buffer = await generateOrdenPDF({ ...buildOrdenFixture(), ...overrides } as any)
  const doc = await PDFDocument.load(buffer)
  const text = (await extractPdfText(buffer)).replace(/\s+/g, " ")
  return { text, pages: doc.getPageCount() }
}

describe("PDF de la orden — avances", () => {
  it("la hoja de entrega A4 lista los avances con su fecha", async () => {
    const { text } = await render({ estado: "ENTREGADO", avances })
    expect(text).toMatch(/Avances de la reparación/i)
    expect(text).toContain("05/11 Se desarmó el equipo")
    expect(text).toContain("07/11 Se reemplazó el conector de carga")
  })

  it("la hoja de recepción no los muestra", async () => {
    const { text } = await render({ estado: "RECIBIDO", avances })
    expect(text).not.toMatch(/Avances de la reparación/i)
    expect(text).not.toContain("Se reemplazó el conector")
  })

  it("con muchos avances quedan los últimos, avisa cuántos se omiten y sigue en una página", async () => {
    const muchos = Array.from({ length: 20 }, (_, i) => ({
      fecha: new Date(Date.UTC(2026, 10, 1 + i, 15)),
      texto: `Paso número ${i + 1} de la reparación del equipo`,
    }))
    const { text, pages } = await render({ estado: "ENTREGADO", avances: muchos })
    expect(text).toContain("Paso número 20")
    expect(text).not.toContain("Paso número 1 ")
    expect(text).toMatch(/\+\d+ avances anteriores/)
    expect(pages).toBe(1)
  })

  it("A6: los avances van con el diagnóstico", async () => {
    const { text } = await render({ estado: "ENTREGADO", avances, paperSize: "A6", soloCliente: true })
    expect(text).toMatch(/Diagnóstico y avances/i)
    expect(text).toContain("Se reemplazó el conector de carga")
  })
})
