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

  it("recepción A4: sin trabajo ni ítems cargados queda como antes", async () => {
    const { text } = await render({ estado: "RECIBIDO", presupuesto: 115000, trabajoARealizar: null, trabajos: null })
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

  const ITEMS = [
    { nombre: "Cambio de módulo", cantidad: 1, importe: 90000 },
    { nombre: "Vidrio templado", cantidad: 2, importe: 25000 },
  ]

  it("recepción A4: sin trabajo escrito, el detalle son los servicios y repuestos cargados", async () => {
    const { text, pages } = await render({ estado: "RECIBIDO", presupuesto: 115000, trabajoARealizar: null, trabajos: ITEMS })
    expect(text).toContain("Cambio de módulo · Vidrio templado x2")
    expect(text).toContain("TRABAJO A REALIZAR")
    expect(text).not.toContain("PRESUPUESTO ESTIMADO")
    expect(pages).toBe(1)
  })

  it("recepción A4: el trabajo escrito le gana a los ítems cargados", async () => {
    const { text } = await render({ estado: "RECIBIDO", presupuesto: 115000, trabajoARealizar: "Cambio de batería", trabajos: ITEMS })
    expect(text).toContain("Cambio de batería")
    expect(text).not.toContain("Vidrio templado")
  })

  it("recepción A5: lista los ítems cargados en lugar de 'Presupuesto estimado'", async () => {
    const { text } = await render({
      estado: "RECIBIDO",
      paperSize: "A5",
      presupuesto: 115000,
      trabajoARealizar: null,
      trabajos: ITEMS,
    })
    expect(text).toContain("Cambio de módulo")
    expect(text).toContain("Vidrio templado x2")
    expect(text).toContain("Presupuesto total")
    expect(text).not.toContain("Presupuesto estimado")
  })

  it("recepción A4 y A5: muchos ítems no agregan páginas", async () => {
    const muchos = Array.from({ length: 30 }, (_, i) => ({ nombre: `Repuesto de prueba número ${i + 1}`, cantidad: 1, importe: 1000 }))
    for (const paperSize of ["A4", "A5"]) {
      const base = { estado: "RECIBIDO", paperSize, presupuesto: 30000, trabajoARealizar: null }
      const sinItems = await render({ ...base, trabajos: null })
      const { pages, text } = await render({ ...base, trabajos: muchos })
      expect(pages).toBe(sinItems.pages)
      if (paperSize === "A5") expect(text).toMatch(/\+\d+ más/)
    }
  })
})
