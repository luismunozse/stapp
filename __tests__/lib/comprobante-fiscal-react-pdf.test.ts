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
import type { ComprobanteAsociado } from "@/lib/facturacion/comprobante-asociado"
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

const texto = async (fila: ComprobanteFiscalRow, e = emisor, asociado?: ComprobanteAsociado | null) =>
  normalize(await extractReactPdfText(await generateComprobanteFiscalPDF({ comprobante: fila, emisor: e, asociado })))

// Nota de credito B (cbte_tipo 8) que anula la factura 0003-00000094 del 19/10/2026 (filaB).
const filaNcB: ComprobanteFiscalRow = {
  ...filaB,
  numero: "0003-00000002",
  cae: "70417054399999",
  cae_vencimiento: "20261030",
  fecha_emision: "2026-10-20",
  cbte_tipo: 8,
}
const asociadoB: ComprobanteAsociado = { tipo: "B", numero: "0003-00000001", fecha: "2026-10-15" }

const filaNcC: ComprobanteFiscalRow = { ...filaC, numero: "0003-00000004", cbte_tipo: 13 }
const asociadoC: ComprobanteAsociado = { tipo: "C", numero: "0002-00000007", fecha: "2026-10-12" }

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

describe("generateComprobanteFiscalPDF - nota de credito electronica", () => {
  it("B: titulo NOTA DE CREDITO, codigo 008, numero y fecha propios", async () => {
    const t = await texto(filaNcB, emisor, asociadoB)
    expect(t).toContain("NOTA DE CRÉDITO")
    expect(t).toContain("COD. 008")
    expect(t).toContain("0003-00000002")
    expect(t).toContain("Fecha de emisión: 20/10/2026")
    // Ni el titulo ni el codigo de una factura.
    expect(t).not.toContain("FACTURA")
    expect(t).not.toContain("COD. 006")
  })

  it("C: codigo 013 y sin IVA contenido", async () => {
    const t = await texto(filaNcC, emisor, asociadoC)
    expect(t).toContain("NOTA DE CRÉDITO")
    expect(t).toContain("COD. 013")
    expect(t).not.toContain("IVA contenido")
  })

  it("imprime la linea del comprobante asociado con su numero y fecha", async () => {
    expect(await texto(filaNcB, emisor, asociadoB)).toContain(
      "Comprobante asociado: Factura B 0003-00000001 del 15/10/2026"
    )
    expect(await texto(filaNcC, emisor, asociadoC)).toContain(
      "Comprobante asociado: Factura C 0002-00000007 del 12/10/2026"
    )
  })

  it("si la fecha de la factura no se conoce, omite la fecha (no imprime null ni 'del')", async () => {
    const t = await texto(filaNcB, emisor, { ...asociadoB, fecha: null })
    expect(t).toContain("Comprobante asociado: Factura B 0003-00000001")
    expect(t).not.toContain("0003-00000001 del")
    for (const malo of ["null", "undefined", "NaN"]) expect(t).not.toContain(malo)
  })

  it("imprime sus propios totales (positivos), el IVA contenido de B y el pie con SU CAE", async () => {
    const t = await texto(filaNcB, emisor, asociadoB)
    expect(t).toContain(fmt(12100))
    expect(t).toContain("IVA contenido")
    expect(t).toContain(fmt(2100))
    expect(t).not.toContain("-" + fmt(12100))
    expect(t).toContain("CAE N°: 70417054399999")
    expect(t).toContain("Fecha de Vto. de CAE: 30/10/2026")
    expect(t).not.toContain("70417054367476")
  })

  it("copia las lineas del detalle propio cuando las tiene", async () => {
    const t = await texto(filaNcB, emisor, asociadoB)
    expect(t).toContain("Funda silicona")
    expect(t).not.toContain("Anulación de la factura")
  })

  it.each([
    ["detalle NULL", null],
    ["detalle vacio", []],
    ["detalle ilegible", "no es una lista"],
  ])("%s: UNA linea sintetica por el total, con el texto del armado de la NC", async (_n, detalle) => {
    const t = await texto({ ...filaNcB, detalle }, emisor, asociadoB)
    expect(t).toContain("Anulación de la factura B 0003-00000001")
    // La fila entera: descripcion, cantidad 1, precio unitario y importe, ambos por el total de la NC.
    expect(t).toContain(["Anulación de la factura B 0003-00000001", "1", fmt(12100), fmt(12100)].join("\n"))
    expect(t.split("Anulación de la factura").length - 1).toBe(1)
  })

  it("una factura sin detalle NO inventa la linea de anulacion, aunque reciba un comprobante asociado", async () => {
    const t = await texto({ ...filaB, detalle: null }, emisor, asociadoB)
    expect(t).not.toContain("Anulación de la factura")
    expect(t).not.toContain("Comprobante asociado")
    expect(t).toContain("FACTURA")
  })

  it("la linea sintetica de una NC C nombra a su factura C", async () => {
    const t = await texto({ ...filaNcC, detalle: null }, emisor, asociadoC)
    expect(t).toContain("Anulación de la factura C 0002-00000007")
  })

  it("el QR sale de las columnas propias de la NC: tipoCmp 8, su CAE, su total y su numero", () => {
    expect(datosQrDesdeComprobante(filaNcB)).toMatchObject({
      tipoCmp: 8,
      nroCmp: 2,
      importe: 12100,
      codAut: 70417054399999,
      fecha: "2026-10-20",
    })
    expect(datosQrDesdeComprobante(filaNcC)).toMatchObject({ tipoCmp: 13, nroCmp: 4 })
  })

  it("renderiza una pagina A4 con el QR embebido", async () => {
    const buf = await generateComprobanteFiscalPDF({ comprobante: filaNcB, emisor, asociado: asociadoB })
    const doc = await PDFDocument.load(buf)
    expect(doc.getPageCount()).toBe(1)
    expect(Math.round(doc.getPage(0).getWidth())).toBe(595)
    expect(doc.getPage(0).node.Resources()?.toString()).toContain("/XObject")
  })

  it("una NC sin factura asociada es incompleta: no se imprime sin 'Comprobante asociado'", async () => {
    await expect(generateComprobanteFiscalPDF({ comprobante: filaNcB, emisor })).rejects.toBeInstanceOf(
      ComprobanteIncompletoError
    )
    await expect(
      generateComprobanteFiscalPDF({ comprobante: filaNcB, emisor, asociado: null })
    ).rejects.toBeInstanceOf(ComprobanteIncompletoError)
  })

  it("una NC sin foto fiscal (snapshot NULL) es incompleta aunque tenga asociada", async () => {
    await expect(
      generateComprobanteFiscalPDF({ comprobante: { ...filaNcB, cuit_emisor: null }, emisor, asociado: asociadoB })
    ).rejects.toBeInstanceOf(ComprobanteIncompletoError)
  })

  it("una factura ignora el comprobante asociado: sigue titulandose FACTURA", async () => {
    const t = await texto(filaB, emisor, asociadoB)
    expect(t).toContain("FACTURA")
    expect(t).toContain("COD. 006")
    expect(t).not.toContain("Comprobante asociado")
    expect(t).not.toContain("NOTA DE CRÉDITO")
  })
})

describe("generateComprobanteFiscalPDF - factura anulada", () => {
  it("el PDF de una factura anulada dice exactamente lo mismo que cuando estaba emitida", async () => {
    const emitida = await texto({ ...filaB, estado: "emitido" } as ComprobanteFiscalRow)
    const anulada = await texto({ ...filaB, estado: "anulado" } as ComprobanteFiscalRow)
    expect(anulada).toBe(emitida)
    expect(anulada).toContain("FACTURA")
    expect(anulada).not.toMatch(/anulad/i)
  })

  it("una factura anulada sin foto fiscal (legacy) sigue siendo 'datos incompletos'", async () => {
    const legacy = { ...filaB, estado: "anulado", fecha_emision: null, cuit_emisor: null, cbte_tipo: null }
    await expect(
      generateComprobanteFiscalPDF({ comprobante: legacy as ComprobanteFiscalRow, emisor })
    ).rejects.toBeInstanceOf(ComprobanteIncompletoError)
  })
})
