// @vitest-environment node
/**
 * Hoja RECEPCION de generateOrdenPDF: fila "Trabajo a realizar" bajo la falla
 * y linea "Garantia: N dias desde la entrega" junto a los terminos. La hoja
 * ENTREGA no cambia.
 *
 * Se usa la variante soloCliente (como el resto de los tests de la hoja): es
 * el mismo bloque de la parte cliente y extractPdfText lo ve completo.
 */
import { describe, it, expect } from "vitest"
import { generateOrdenPDF } from "@/lib/pdf"
import { extractPdfText, extractPdfTextPositions } from "./pdf-text-helper"
import { buildOrdenFixture, buildMaxContentOrdenFixture } from "./orden-fixture"

const GARANTIA_30 = "Garantía: 30 días desde la entrega"

describe("generateOrdenPDF - RECEPCION: trabajo a realizar", () => {
  it("dibuja la fila con su texto cuando hay trabajo", async () => {
    const buffer = await generateOrdenPDF({
      ...buildOrdenFixture(),
      soloCliente: true,
      trabajoARealizar: "Cambio de pantalla + bateria",
    } as any)
    const text = await extractPdfText(buffer)
    expect(text).toContain("TRABAJO A REALIZAR")
    expect(text).toContain("Cambio de pantalla + bateria")
  })

  it("la fila queda debajo de la falla declarada", async () => {
    const buffer = await generateOrdenPDF({
      ...buildOrdenFixture(),
      soloCliente: true,
      trabajoARealizar: "Cambio de pantalla",
    } as any)
    const text = await extractPdfText(buffer)
    expect(text.indexOf("TRABAJO A REALIZAR")).toBeGreaterThan(text.indexOf("FALLA DECLARADA"))
  })

  it("envuelve textos largos en varias lineas sin perderlos", async () => {
    const largo = "Reemplazo de modulo de pantalla original, cambio de bateria, limpieza interna completa y actualizacion de software"
    const buffer = await generateOrdenPDF({ ...buildOrdenFixture(), soloCliente: true, trabajoARealizar: largo } as any)
    const text = await extractPdfText(buffer)
    expect(text).toContain("Reemplazo de modulo")
    expect(text).toContain("actualizacion de software")
  })

  it("omite la fila si trabajo es null, vacio o solo espacios", async () => {
    for (const trabajoARealizar of [null, undefined, "", "   "]) {
      const buffer = await generateOrdenPDF({ ...buildOrdenFixture(), soloCliente: true, trabajoARealizar } as any)
      const text = await extractPdfText(buffer)
      expect(text).not.toContain("TRABAJO A REALIZAR")
    }
  })

  it("tambien aparece en la hoja impresa completa (cliente + talon)", async () => {
    const buffer = await generateOrdenPDF({ ...buildOrdenFixture(), trabajoARealizar: "Cambio de pantalla" } as any)
    const text = await extractPdfText(buffer)
    expect(text).toContain("TRABAJO A REALIZAR")
    expect(text).toContain("TALÓN INTERNO")
  })
})

describe("generateOrdenPDF - RECEPCION: garantia desde la entrega", () => {
  it("imprime 'Garantía: N días desde la entrega' junto a los terminos", async () => {
    const buffer = await generateOrdenPDF({
      ...buildOrdenFixture(),
      soloCliente: true,
      recepcionTerminos: "El equipo no retirado en 90 dias se considera abandonado.",
      garantiaDiasDefault: 30,
    } as any)
    const text = await extractPdfText(buffer)
    expect(text).toContain(GARANTIA_30)
    expect(text).toContain("El equipo no retirado en 90 dias")
  })

  it("usa singular para 1 dia", async () => {
    const buffer = await generateOrdenPDF({ ...buildOrdenFixture(), soloCliente: true, garantiaDiasDefault: 1 } as any)
    const text = await extractPdfText(buffer)
    expect(text).toContain("Garantía: 1 día desde la entrega")
    expect(text).not.toContain("1 días")
  })

  it("imprime la garantia aunque no haya terminos configurados", async () => {
    const buffer = await generateOrdenPDF({
      ...buildOrdenFixture(),
      soloCliente: true,
      recepcionTerminos: null,
      garantiaDiasDefault: 30,
    } as any)
    expect(await extractPdfText(buffer)).toContain(GARANTIA_30)
  })

  it("omite la linea con 0, null o sin dato", async () => {
    for (const garantiaDiasDefault of [0, null, undefined]) {
      const buffer = await generateOrdenPDF({ ...buildOrdenFixture(), soloCliente: true, garantiaDiasDefault } as any)
      const text = await extractPdfText(buffer)
      expect(text).not.toContain("Garantía:")
    }
  })

  it("la hoja completa tambien la imprime una sola vez (parte cliente, no el talon)", async () => {
    const buffer = await generateOrdenPDF({ ...buildOrdenFixture(), garantiaDiasDefault: 30 } as any)
    const text = await extractPdfText(buffer)
    expect(text.split(GARANTIA_30).length - 1).toBe(1)
  })
})

describe("generateOrdenPDF - RECEPCION: el contenido nuevo entra en la hoja A4", () => {
  it("con trabajo de 3 lineas + garantia sobre el fixture maximo, nada se dibuja bajo el margen", async () => {
    const buffer = await generateOrdenPDF({
      ...buildMaxContentOrdenFixture(),
      trabajoARealizar: "Reemplazo de modulo de pantalla original ".repeat(12),
      garantiaDiasDefault: 30,
    } as any)
    const positions = await extractPdfTextPositions(buffer)
    expect(Math.min(...positions.map((p) => p.y))).toBeGreaterThanOrEqual(28)
  })
})

describe("generateOrdenPDF - hoja ENTREGA no cambia", () => {
  it("no imprime trabajo ni garantia en la hoja de entrega", async () => {
    const buffer = await generateOrdenPDF({
      ...buildOrdenFixture(),
      estado: "ENTREGADO",
      fechaEntrega: new Date(),
      trabajoARealizar: "Cambio de pantalla",
      garantiaDiasDefault: 30,
    } as any)
    const text = await extractPdfText(buffer)
    expect(text).not.toContain("TRABAJO A REALIZAR")
    expect(text).not.toContain("Cambio de pantalla")
    expect(text).not.toContain("desde la entrega")
  })
})
