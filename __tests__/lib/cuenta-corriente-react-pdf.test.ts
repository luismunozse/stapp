// @vitest-environment node
import { describe, it, expect, afterEach, vi } from "vitest"
import { PDFDocument } from "pdf-lib"
import { generateReciboCCPDF, type ReciboCCPDFData } from "@/lib/cuenta-corriente-react-pdf"
import { formatCurrencyValue } from "@/lib/currency"
import { extractReactPdfText } from "./pdf-text-helper-react"

// Intl currency output uses NBSP ( ) and, in newer ICU, NNBSP ( )
// between the symbol and the digits, while pdfjs hands back whatever byte
// react-pdf actually wrote. Normalize both sides instead of asserting on a
// specific space codepoint, which would make these tests ICU-version bound.
const normalize = (s: string) => s.replace(/[\u00a0\u202f]/g, " ")
const fmt = (n: number) => normalize(formatCurrencyValue(n, "ARS"))

const baseData: ReciboCCPDFData = {
  numeroRecibo: "REC-00007",
  fecha: new Date("2026-08-17T17:32:00Z"),
  tipo: "DEPOSITO",
  // Signed exactly as cuenta_corriente stores it (migration 066 + 234):
  // positive = haber (DEPOSITO/PAGO/DEVOLUCION), negative = debe (CARGO/USO).
  monto: 15000,
  saldoPosterior: 10000,
  metodoPago: "EFECTIVO",
  cliente: { nombre: "Juan Pérez", dni: "20123456", telefono: "1122334455" },
  nombreEmpresa: "Servicio Técnico SRL",
  moneda: "ARS",
  zonaHoraria: "America/Argentina/Buenos_Aires",
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("generateReciboCCPDF", () => {
  it("renders a parseable A4 page", async () => {
    const buffer = await generateReciboCCPDF(baseData)
    expect(buffer.length).toBeGreaterThan(0)
    const doc = await PDFDocument.load(buffer)
    expect(doc.getPageCount()).toBe(1)
    const { width, height } = doc.getPage(0).getSize()
    expect(Math.round(width)).toBe(595)
    expect(Math.round(height)).toBe(842)
  })

  it("prints the document identity, the emisor and the cliente", async () => {
    const text = normalize(await extractReactPdfText(await generateReciboCCPDF(baseData)))
    expect(text).toContain("RECIBO")
    expect(text).toContain("REC-00007")
    expect(text).toContain("Servicio Técnico SRL")
    expect(text).toContain("Juan Pérez")
    expect(text).toContain("20123456")
  })

  it("prints the received amount and the movement detail", async () => {
    const text = normalize(await extractReactPdfText(await generateReciboCCPDF(baseData)))
    expect(text).toContain(fmt(15000))
    expect(text).toContain("Depósito en cuenta corriente")
    expect(text).toContain("Efectivo")
  })

  it("derives saldo anterior from saldo posterior minus the signed monto", async () => {
    // 10000 - 15000 = -5000 before the deposit landed.
    const text = normalize(await extractReactPdfText(await generateReciboCCPDF(baseData)))
    expect(text).toContain("Saldo anterior")
    expect(text).toContain(fmt(-5000))
  })

  it("labels a positive closing balance as saldo a favor", async () => {
    const text = normalize(await extractReactPdfText(await generateReciboCCPDF(baseData)))
    expect(text).toContain("SALDO A FAVOR")
    expect(text).not.toContain("SALDO ADEUDADO")
  })

  it("labels a still-negative closing balance as saldo adeudado, in absolute value", async () => {
    // A PAGO that only covers part of the debt: the client still owes 3000.
    const text = normalize(
      await extractReactPdfText(
        await generateReciboCCPDF({
          ...baseData,
          tipo: "PAGO",
          monto: 5000,
          saldoPosterior: -3000,
          metodoPago: "TRANSFERENCIA",
          numeroReferencia: "OP-99812",
        })
      )
    )
    expect(text).toContain("SALDO ADEUDADO")
    expect(text).not.toContain("SALDO A FAVOR")
    // Absolute value in the headline bar — no minus sign for the client to
    // misread as a credit.
    expect(text).toContain(fmt(3000))
    expect(text).toContain("Pago de cuenta corriente")
    expect(text).toContain("OP-99812")
  })

  it("carries the non-fiscal disclaimer", async () => {
    const text = normalize(await extractReactPdfText(await generateReciboCCPDF(baseData)))
    expect(text).toContain("no válido como comprobante fiscal")
  })

  it("prints observaciones when present and omits the block when absent", async () => {
    const withObs = normalize(
      await extractReactPdfText(
        await generateReciboCCPDF({ ...baseData, observaciones: "Adelanto por reparación" })
      )
    )
    expect(withObs).toContain("Adelanto por reparación")

    const without = normalize(await extractReactPdfText(await generateReciboCCPDF(baseData)))
    expect(without).not.toContain("Observaciones")
  })

  it("degrades to no logo when the logo fetch fails, instead of rejecting", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ENOTFOUND")))
    const buffer = await generateReciboCCPDF({ ...baseData, logoUrl: "https://example.test/logo.png" })
    const doc = await PDFDocument.load(buffer)
    expect(doc.getPageCount()).toBe(1)
  })
})
