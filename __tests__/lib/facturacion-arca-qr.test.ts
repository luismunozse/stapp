import { describe, it, expect } from "vitest"
import { datosQrDesdeComprobante, urlQrArca, type ComprobanteQrRow } from "@/lib/facturacion/arca/qr"

// Ejemplo oficial de la especificacion del QR de ARCA (RG 4892).
const EJEMPLO_OFICIAL = {
  ver: 1,
  fecha: "2020-10-13",
  cuit: 30000000007,
  ptoVta: 10,
  tipoCmp: 1,
  nroCmp: 94,
  importe: 12100,
  moneda: "DOL",
  ctz: 65,
  tipoDocRec: 80,
  nroDocRec: 20000000001,
  tipoCodAut: "E",
  codAut: 70417054367476,
}

const filaOficial: ComprobanteQrRow = {
  fecha_emision: "2020-10-13",
  cuit_emisor: "30000000007",
  cbte_tipo: 1,
  punto_venta: 10,
  numero: "0010-00000094",
  importe_total: 12100,
  moneda: "DOL",
  cotizacion: 65,
  receptor_doc_tipo_cod: 80,
  receptor_doc_nro_cod: "20000000001",
  cae: "70417054367476",
}

const decodificar = (url: string) => {
  const p = new URL(url).searchParams.get("p")!
  return Buffer.from(p, "base64").toString("utf8")
}

describe("datosQrDesdeComprobante", () => {
  it("reproduce el ejemplo oficial de ARCA, mismo orden de claves", () => {
    const datos = datosQrDesdeComprobante(filaOficial)
    expect(datos).toEqual(EJEMPLO_OFICIAL)
    expect(JSON.stringify(datos)).toBe(JSON.stringify(EJEMPLO_OFICIAL))
  })

  it("emite numeros JSON (no strings) para cuit, ptoVta, tipoCmp, nroCmp, importe, ctz, doc y codAut", () => {
    const datos = datosQrDesdeComprobante(filaOficial)!
    for (const k of ["ver", "cuit", "ptoVta", "tipoCmp", "nroCmp", "importe", "ctz", "tipoDocRec", "nroDocRec", "codAut"] as const) {
      expect(typeof datos[k]).toBe("number")
    }
    expect(datos.tipoCodAut).toBe("E")
    expect(datos.fecha).toBe("2020-10-13")
  })

  it("parsea nroCmp desde 'PPPP-NNNNNNNN'", () => {
    expect(datosQrDesdeComprobante({ ...filaOficial, numero: "0003-00001234" })!.nroCmp).toBe(1234)
  })

  it("acepta importes que llegan como string numerico (NUMERIC)", () => {
    const d = datosQrDesdeComprobante({ ...filaOficial, importe_total: "1234.50" as unknown as number, cotizacion: "1.000000" as unknown as number })!
    expect(d.importe).toBe(1234.5)
    expect(d.ctz).toBe(1)
  })

  it("consumidor final sin identificar: manda 99 y 0", () => {
    const d = datosQrDesdeComprobante({ ...filaOficial, cbte_tipo: 6, receptor_doc_tipo_cod: 99, receptor_doc_nro_cod: "0" })!
    expect(d.tipoDocRec).toBe(99)
    expect(d.nroDocRec).toBe(0)
  })

  it("receptor sin snapshot: cae a 99/0 (de corresponder)", () => {
    const d = datosQrDesdeComprobante({ ...filaOficial, receptor_doc_tipo_cod: null, receptor_doc_nro_cod: null })!
    expect([d.tipoDocRec, d.nroDocRec]).toEqual([99, 0])
  })

  it.each([
    "fecha_emision",
    "cuit_emisor",
    "cbte_tipo",
    "punto_venta",
    "numero",
    "importe_total",
    "moneda",
    "cotizacion",
    "cae",
  ] as const)("devuelve null si falta %s", (campo) => {
    expect(datosQrDesdeComprobante({ ...filaOficial, [campo]: null })).toBeNull()
    expect(datosQrDesdeComprobante({ ...filaOficial, [campo]: undefined })).toBeNull()
  })

  it("devuelve null si el numero o el CAE no son parseables", () => {
    expect(datosQrDesdeComprobante({ ...filaOficial, numero: "abc" })).toBeNull()
    expect(datosQrDesdeComprobante({ ...filaOficial, cae: "no-es-numero" })).toBeNull()
  })
})

describe("urlQrArca", () => {
  it("usa la base de arca.gob.ar y el JSON en base64 estandar", () => {
    const url = urlQrArca(datosQrDesdeComprobante(filaOficial)!)
    expect(url.startsWith("https://www.arca.gob.ar/fe/qr/?p=")).toBe(true)
    expect(JSON.parse(decodificar(url))).toEqual(EJEMPLO_OFICIAL)
  })

  it("ida y vuelta exacta: el JSON decodificado conserva el orden y los numeros grandes", () => {
    const json = decodificar(urlQrArca(datosQrDesdeComprobante(filaOficial)!))
    expect(json).toBe(JSON.stringify(EJEMPLO_OFICIAL))
    expect(json).toContain('"cuit":30000000007')
    expect(json).toContain('"codAut":70417054367476')
  })
})
