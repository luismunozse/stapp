// @vitest-environment node
import { describe, it, expect } from "vitest"
import { PDFDocument } from "pdf-lib"
import {
  generateResumenCCPDF,
  type ResumenCCPDFData,
  type ResumenCCMovimiento,
} from "@/lib/cuenta-corriente-react-pdf"
import { formatCurrencyValue } from "@/lib/currency"
import { extractReactPdfText, extractReactPdfTextPositions } from "./pdf-text-helper-react"

// Intl separates the currency symbol from the digits with NBSP (U+00A0) or,
// in newer ICU, NNBSP (U+202F), while react-pdf writes a plain space there.
// Written as escapes on purpose: a literal NBSP in the source is invisible
// and does not survive every editor round-trip.
const normalize = (s: string) => s.replace(/[\u00a0\u202f]/g, " ")
const fmt = (n: number) => normalize(formatCurrencyValue(n, "ARS"))

// Movements as cuenta_corriente stores them: monto signed, saldo_posterior
// already carrying the running balance, ordered oldest first.
const movimientos: ResumenCCMovimiento[] = [
  { fecha: "2026-08-03T13:00:00Z", tipo: "CARGO", monto: -8000, saldoPosterior: -8000, referenciaTipo: "ORDEN" },
  { fecha: "2026-08-11T13:00:00Z", tipo: "PAGO", monto: 5000, saldoPosterior: -3000, metodoPago: "EFECTIVO" },
  {
    fecha: "2026-08-19T13:00:00Z",
    tipo: "DEPOSITO",
    monto: 4500,
    saldoPosterior: 1500,
    metodoPago: "TRANSFERENCIA",
    numeroReferencia: "OP-4471",
  },
]

const baseData: ResumenCCPDFData = {
  desde: "2026-08-01",
  hasta: "2026-08-31",
  saldoInicial: 0,
  saldoFinal: 1500,
  movimientos,
  cliente: { nombre: "Juan Pérez", dni: "20123456" },
  nombreEmpresa: "Servicio Técnico SRL",
  moneda: "ARS",
  zonaHoraria: "America/Argentina/Buenos_Aires",
}

describe("generateResumenCCPDF", () => {
  it("renders a parseable A4 page", async () => {
    const buffer = await generateResumenCCPDF(baseData)
    const doc = await PDFDocument.load(buffer)
    expect(doc.getPageCount()).toBe(1)
    const { width, height } = doc.getPage(0).getSize()
    expect(Math.round(width)).toBe(595)
    expect(Math.round(height)).toBe(842)
  })

  it("prints the document identity, the emisor, the cliente and the period", async () => {
    const text = normalize(await extractReactPdfText(await generateResumenCCPDF(baseData)))
    expect(text).toContain("RESUMEN DE CUENTA")
    expect(text).toContain("Servicio Técnico SRL")
    expect(text).toContain("Juan Pérez")
    expect(text).toContain("01/08/2026")
    expect(text).toContain("31/08/2026")
  })

  it("opens with the saldo inicial and closes with the saldo final", async () => {
    const text = normalize(
      await extractReactPdfText(await generateResumenCCPDF({ ...baseData, saldoInicial: -2000 }))
    )
    expect(text).toContain("Saldo inicial")
    expect(text).toContain(fmt(-2000))
    expect(text).toContain("SALDO A FAVOR")
    expect(text).toContain(fmt(1500))
  })

  it("splits signed montos into debe and haber columns", async () => {
    const text = normalize(await extractReactPdfText(await generateResumenCCPDF(baseData)))
    expect(text).toContain("DEBE")
    expect(text).toContain("HABER")
    // The CARGO of -8000 is a debit shown in absolute value...
    expect(text).toContain(fmt(8000))
    // ...and the two credits keep their own amounts.
    expect(text).toContain(fmt(5000))
    expect(text).toContain(fmt(4500))
  })

  it("totals each column over the period", async () => {
    const text = normalize(await extractReactPdfText(await generateResumenCCPDF(baseData)))
    expect(text).toContain("Totales del período")
    // debe = 8000, haber = 5000 + 4500 = 9500
    expect(text).toContain(fmt(9500))
  })

  it("labels a negative closing balance as adeudado, in absolute value", async () => {
    const text = normalize(
      await extractReactPdfText(await generateResumenCCPDF({ ...baseData, saldoFinal: -3000 }))
    )
    expect(text).toContain("SALDO ADEUDADO")
    expect(text).toContain(fmt(3000))
    expect(text).not.toContain("SALDO A FAVOR")
  })

  it("states an empty period instead of rendering a bare table", async () => {
    const text = normalize(
      await extractReactPdfText(
        await generateResumenCCPDF({ ...baseData, movimientos: [], saldoInicial: 1500, saldoFinal: 1500 })
      )
    )
    expect(text).toContain("Sin movimientos en el período")
  })

  it("repeats the column header on every page when the table overflows", async () => {
    let saldo = 0
    const many: ResumenCCMovimiento[] = Array.from({ length: 60 }, (_, i) => {
      saldo += 100
      return {
        fecha: `2026-08-${String((i % 28) + 1).padStart(2, "0")}T13:00:00Z`,
        tipo: "DEPOSITO",
        monto: 100,
        saldoPosterior: saldo,
        metodoPago: "EFECTIVO",
      }
    })

    const buffer = await generateResumenCCPDF({ ...baseData, movimientos: many, saldoFinal: saldo })
    const doc = await PDFDocument.load(buffer)
    expect(doc.getPageCount()).toBeGreaterThan(1)

    const items = await extractReactPdfTextPositions(buffer)
    const headerPages = new Set(items.filter((i) => i.text === "CONCEPTO").map((i) => i.page))
    expect(headerPages.has(1)).toBe(true)
    expect(headerPages.has(2)).toBe(true)
    // Every page stays A4.
    for (let p = 0; p < doc.getPageCount(); p++) {
      expect(Math.round(doc.getPage(p).getSize().width)).toBe(595)
    }
  })
})
