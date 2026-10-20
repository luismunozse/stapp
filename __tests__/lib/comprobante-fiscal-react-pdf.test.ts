// @vitest-environment node
import { describe, it, expect } from "vitest"
import { PDFDocument } from "pdf-lib"
import {
  generateComprobanteFiscalPDF,
  ComprobanteIncompletoError,
  type ComprobanteFiscalRow,
} from "@/lib/comprobante-fiscal-react-pdf"
import { datosQrDesdeComprobante, urlQrArca } from "@/lib/facturacion/arca/qr"
import { formatCurrencyValue } from "@/lib/currency"
import { extractReactPdfText } from "./pdf-text-helper-react"

const normalize = (s: string) => s.replace(/[  ]/g, " ")
const fmt = (n: number) => normalize(formatCurrencyValue(n, "ARS"))

const emisor = {
  nombreEmpresa: "Servicio Técnico SRL",
  cuitEmpresa: "30-71234567-9",
  condicionIvaEmpresa: "Responsable Inscripto",
  direccionEmpresa: "Av. Siempreviva 742",
  pais: "AR",
}

const filaB: ComprobanteFiscalRow = {
  tipo: "B",
  punto_venta: 3,
  numero: "0003-00000094",
  cae: "70417054367476",
  cae_vencimiento: "20261029",
  fecha_emision: "2026-10-19",
  cuit_emisor: "30712345679",
  cbte_tipo: 6,
  concepto: 1,
  moneda: "PES",
  cotizacion: 1,
  importe_neto: 10000,
  importe_iva: 2100,
  importe_total: 12100,
  receptor_doc_tipo_cod: 99,
  receptor_doc_nro_cod: "0",
  detalle: [{ cantidad: 2, descripcion: "Funda silicona", importeUnitario: 6050, importe: 12100, alicuotaIva: 21 }],
}

const filaC: ComprobanteFiscalRow = {
  ...filaB,
  tipo: "C",
  cbte_tipo: 11,
  importe_neto: 12100,
  importe_iva: 0,
  numero: "0003-00000007",
}

const texto = async (fila: ComprobanteFiscalRow, e = emisor) =>
  normalize(await extractReactPdfText(await generateComprobanteFiscalPDF({ comprobante: fila, emisor: e })))

describe("generateComprobanteFiscalPDF", () => {
  it("renderiza un PDF A4 valido de una pagina", async () => {
    const buf = await generateComprobanteFiscalPDF({ comprobante: filaB, emisor })
    expect(buf.subarray(0, 4).toString()).toBe("%PDF")
    const doc = await PDFDocument.load(buf)
    expect(doc.getPageCount()).toBe(1)
    expect(Math.round(doc.getPage(0).getWidth())).toBe(595)
  })

  it("B: letra, codigo 006, numero, fecha, emisor y receptor consumidor final", async () => {
    const t = await texto(filaB)
    expect(t).toContain("FACTURA")
    expect(t).toContain("COD. 006")
    expect(t).toContain("0003-00000094")
    expect(t).toContain("19/10/2026")
    expect(t).toContain("Servicio Técnico SRL")
    expect(t).toContain("30-71234567-9")
    expect(t).toContain("RESPONSABLE INSCRIPTO")
    expect(t).toContain("Av. Siempreviva 742")
    expect(t).toContain("Consumidor Final")
    expect(t).not.toContain("Documento no válido como comprobante fiscal")
  })

  it("B: detalle, total y IVA contenido (Ley 27.743) persistido", async () => {
    const t = await texto(filaB)
    expect(t).toContain("Funda silicona")
    expect(t).toContain(fmt(12100))
    expect(t).toContain("Ley 27.743")
    expect(t).toContain("IVA contenido")
    expect(t).toContain(fmt(2100))
  })

  it("C: codigo 011 y sin IVA contenido", async () => {
    const t = await texto(filaC)
    expect(t).toContain("COD. 011")
    expect(t).toContain("0003-00000007")
    expect(t).not.toContain("IVA contenido")
    expect(t).not.toContain("27.743")
  })

  it("pie ARCA: autorizado, CAE, vencimiento dd/mm/yyyy y descargo", async () => {
    const t = await texto(filaB)
    expect(t).toContain("Comprobante Autorizado")
    expect(t).toContain("CAE N°: 70417054367476")
    expect(t).toContain("Fecha de Vto. de CAE: 29/10/2026")
    expect(t).toContain("Esta Administración Federal no se responsabiliza por la veracidad de los datos ingresados en el detalle de la operación")
  })

  it("acepta cae_vencimiento ISO ademas de YYYYMMDD", async () => {
    expect(await texto({ ...filaB, cae_vencimiento: "2026-10-29" })).toContain("Fecha de Vto. de CAE: 29/10/2026")
  })

  it("embebe el QR como imagen", async () => {
    const buf = await generateComprobanteFiscalPDF({ comprobante: filaB, emisor })
    const doc = await PDFDocument.load(buf)
    const recursos = doc.getPage(0).node.Resources()
    expect(recursos?.toString()).toContain("/XObject")
  })

  it("sale solo de las columnas: el QR codificaria exactamente la fila persistida", () => {
    const datos = datosQrDesdeComprobante(filaB)!
    expect(datos).toMatchObject({ cuit: 30712345679, ptoVta: 3, tipoCmp: 6, nroCmp: 94, importe: 12100, codAut: 70417054367476 })
    expect(urlQrArca(datos)).toContain("https://www.arca.gob.ar/fe/qr/?p=")
  })

  it("el importe impreso es el persistido, no la suma de las lineas", async () => {
    const t = await texto({ ...filaB, importe_total: 12345.67 })
    expect(t).toContain(fmt(12345.67))
  })

  it("fila legacy sin snapshot: error de datos incompletos, sin QR ni PDF", async () => {
    const legacy = { ...filaB, fecha_emision: null, cuit_emisor: null, cbte_tipo: null }
    await expect(generateComprobanteFiscalPDF({ comprobante: legacy, emisor })).rejects.toBeInstanceOf(ComprobanteIncompletoError)
  })

  it("sin IVA persistido en un B tambien es incompleto", async () => {
    await expect(
      generateComprobanteFiscalPDF({ comprobante: { ...filaB, importe_iva: null }, emisor })
    ).rejects.toBeInstanceOf(ComprobanteIncompletoError)
  })

  it("no filtra null/undefined/NaN", async () => {
    const t = await texto({ ...filaB, detalle: null })
    for (const malo of ["null", "undefined", "NaN"]) expect(t).not.toContain(malo)
  })
})
