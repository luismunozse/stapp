// @vitest-environment node
/**
 * El ID fiscal impreso en los documentos sigue al pais de la org: CUIT para
 * Argentina (y para toda org sin pais), NIF para Espana. Cubre los tres
 * motores que lo imprimen: el shell react-pdf (recibo/resumen de cuenta
 * corriente), el remito react-pdf y los generadores pdf-lib (factura legacy y
 * orden de servicio).
 */
import { describe, it, expect } from "vitest"
import { generateReciboCCPDF, type ReciboCCPDFData } from "@/lib/cuenta-corriente-react-pdf"
import { generateFacturaPDFReact } from "@/lib/remito-react-pdf"
import { generateFacturaPDFLegacy, generateOrdenPDF } from "@/lib/pdf"
import { extractReactPdfText } from "./pdf-text-helper-react"
import { extractPdfText } from "./pdf-text-helper"
import { buildOrdenFixture } from "./orden-fixture"

const normalize = (s: string) => s.replace(/[  ]/g, " ")

const recibo: ReciboCCPDFData = {
  numeroRecibo: "REC-00007",
  fecha: new Date("2026-08-17T17:32:00Z"),
  tipo: "DEPOSITO",
  monto: 15000,
  saldoPosterior: 10000,
  metodoPago: "EFECTIVO",
  cliente: { nombre: "Juan Pérez", dni: "20123456", telefono: "1122334455" },
  nombreEmpresa: "Servicio Técnico SRL",
  cuitEmpresa: "B12345678",
  moneda: "ARS",
  zonaHoraria: "America/Argentina/Buenos_Aires",
}

const factura = {
  numeroFactura: "0001-00000008",
  fecha: new Date("2026-08-17"),
  estadoPago: "PAGADO",
  cliente: { nombre: "Consumidor Final", dni: "28.456.789" },
  venta: { numeroVenta: 22 },
  cuitEmpresa: "B12345678",
  subtotal: 3000,
  iva: 0,
  total: 3000,
  montoAbonado: 3000,
  pagos: [],
}

describe("shell react-pdf (recibo de cuenta corriente)", () => {
  it("Argentina: header CUIT and client DNI/CUIT", async () => {
    const text = normalize(await extractReactPdfText(await generateReciboCCPDF({ ...recibo, pais: "AR" })))
    expect(text).toContain("CUIT: B12345678")
    expect(text).toContain("DNI/CUIT: 20123456")
  })

  it("no pais: identical to Argentina", async () => {
    const text = normalize(await extractReactPdfText(await generateReciboCCPDF(recibo)))
    expect(text).toContain("CUIT: B12345678")
    expect(text).toContain("DNI/CUIT: 20123456")
  })

  it("Espana: header NIF, no CUIT anywhere", async () => {
    const text = normalize(await extractReactPdfText(await generateReciboCCPDF({ ...recibo, pais: "ES" })))
    expect(text).toContain("NIF: B12345678")
    expect(text).toContain("NIF/NIE: 20123456")
    expect(text).not.toContain("CUIT")
  })
})

describe("remito react-pdf", () => {
  it("Argentina: header CUIT and client CUIT/DNI", async () => {
    const text = await extractReactPdfText(await generateFacturaPDFReact({ ...factura, pais: "AR" } as any))
    expect(text).toContain("CUIT: B12345678")
    expect(text).toContain("CUIT/DNI: 28.456.789")
  })

  it("Espana: header NIF, no CUIT anywhere", async () => {
    const text = await extractReactPdfText(await generateFacturaPDFReact({ ...factura, pais: "ES" } as any))
    expect(text).toContain("NIF: B12345678")
    expect(text).toContain("NIF/NIE: 28.456.789")
    expect(text).not.toContain("CUIT")
  })
})

describe("remito pdf-lib (legacy)", () => {
  it("Argentina: header CUIT and client CUIT/DNI", async () => {
    const text = await extractPdfText(await generateFacturaPDFLegacy({ ...factura, pais: "AR" } as any))
    expect(text).toContain("CUIT: B12345678")
    expect(text).toContain("CUIT/DNI: 28.456.789")
  })

  it("Espana: header NIF, no CUIT anywhere", async () => {
    const text = await extractPdfText(await generateFacturaPDFLegacy({ ...factura, pais: "ES" } as any))
    expect(text).toContain("NIF: B12345678")
    expect(text).toContain("NIF/NIE: 28.456.789")
    expect(text).not.toContain("CUIT")
  })
})

describe("orden de servicio pdf-lib", () => {
  const empresa = {
    ...buildOrdenFixture(),
    soloCliente: true,
    cliente: {
      ...buildOrdenFixture().cliente,
      tipoCliente: "EMPRESA",
      razonSocial: "Talleres Unidos SA",
      cuit: "B12345678",
      dni: "28.456.789",
    },
  }

  it("Argentina: CUIT and DNI suffixes", async () => {
    const text = await extractPdfText(await generateOrdenPDF({ ...empresa, pais: "AR" }))
    expect(text).toContain("CUIT B12345678")
    expect(text).toContain("DNI 28.456.789")
  })

  it("Espana: NIF and DNI/NIE suffixes", async () => {
    const text = await extractPdfText(await generateOrdenPDF({ ...empresa, pais: "ES" }))
    expect(text).toContain("NIF B12345678")
    expect(text).toContain("DNI/NIE 28.456.789")
    expect(text).not.toContain("CUIT")
  })
})
