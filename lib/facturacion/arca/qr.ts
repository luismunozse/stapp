// QR fiscal de ARCA (RG 4892), construido SOLO desde las columnas persistidas
// del comprobante: nunca desde la venta, que puede editarse despues de emitir.
//
// Especificacion: el QR codifica `{URL}?p={DATOS_CMP}` con DATOS_CMP = base64
// estandar del JSON. Los campos numericos van como NUMEROS JSON y el orden de
// claves es el del ejemplo oficial.

export const URL_QR_ARCA = "https://www.arca.gob.ar/fe/qr/"

/** Receptor "de corresponder": sin dato se informa consumidor final (99 / 0). */
const DOC_TIPO_CONSUMIDOR_FINAL = 99

export interface DatosQr {
  ver: 1
  fecha: string
  cuit: number
  ptoVta: number
  tipoCmp: number
  nroCmp: number
  importe: number
  moneda: string
  ctz: number
  tipoDocRec: number
  nroDocRec: number
  tipoCodAut: "E"
  codAut: number
}

/** Las columnas de `comprobantes_fiscales` que alimentan el QR. */
export interface ComprobanteQrRow {
  fecha_emision?: string | null
  cuit_emisor?: string | null
  cbte_tipo?: number | null
  punto_venta?: number | string | null
  /** 'PPPP-NNNNNNNN' */
  numero?: string | null
  importe_total?: number | string | null
  moneda?: string | null
  cotizacion?: number | string | null
  receptor_doc_tipo_cod?: number | null
  receptor_doc_nro_cod?: string | null
  cae?: string | null
}

const REQUERIDO_VACIO = (v: unknown) => v === null || v === undefined || v === ""

function numero(v: unknown): number | null {
  if (REQUERIDO_VACIO(v)) return null
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/** Solo digitos -> numero (los 20 digitos de nroDocRec entran sobrados en un double para CUIT/DNI). */
function digitos(v: unknown): number | null {
  if (REQUERIDO_VACIO(v)) return null
  const s = String(v)
  return /^\d+$/.test(s) ? Number(s) : null
}

/** Devuelve null si falta cualquier campo obligatorio: sin QR valido no se imprime un QR. */
export function datosQrDesdeComprobante(row: ComprobanteQrRow): DatosQr | null {
  const cuit = digitos(row.cuit_emisor)
  const codAut = digitos(row.cae)
  const tipoCmp = numero(row.cbte_tipo)
  const ptoVta = numero(row.punto_venta)
  const importe = numero(row.importe_total)
  const ctz = numero(row.cotizacion)
  const partes = typeof row.numero === "string" ? /^(\d+)-(\d+)$/.exec(row.numero.trim()) : null

  if (
    REQUERIDO_VACIO(row.fecha_emision) ||
    REQUERIDO_VACIO(row.moneda) ||
    cuit === null ||
    codAut === null ||
    tipoCmp === null ||
    ptoVta === null ||
    importe === null ||
    ctz === null ||
    !partes ||
    Number(partes[2]) < 1
  ) {
    return null
  }

  const tipoDocRec = numero(row.receptor_doc_tipo_cod)
  const nroDocRec = digitos(row.receptor_doc_nro_cod)
  // Un documento fuera del rango entero seguro perderia digitos al serializarse.
  if (nroDocRec !== null && !Number.isSafeInteger(nroDocRec)) return null
  const conReceptor = tipoDocRec !== null && nroDocRec !== null

  return {
    ver: 1,
    fecha: String(row.fecha_emision),
    cuit,
    ptoVta,
    tipoCmp,
    nroCmp: Number(partes[2]),
    importe,
    moneda: String(row.moneda),
    ctz,
    tipoDocRec: conReceptor ? tipoDocRec : DOC_TIPO_CONSUMIDOR_FINAL,
    nroDocRec: conReceptor ? nroDocRec : 0,
    tipoCodAut: "E",
    codAut,
  }
}

export function urlQrArca(datos: DatosQr): string {
  return `${URL_QR_ARCA}?p=${Buffer.from(JSON.stringify(datos), "utf8").toString("base64")}`
}

/** Campos extra que el PDF fiscal exige ademas de los del QR. */
export interface ComprobantePdfRow extends ComprobanteQrRow {
  tipo?: string | null
  cae_vencimiento?: string | null
  importe_iva?: number | string | null
}

/**
 * Una fila puede renderizar el PDF fiscal solo con la foto completa: datos del
 * QR, vencimiento del CAE y, en B, el IVA contenido. Fuente unica para el
 * generador (que tira ComprobanteIncompletoError) y el listado (pdfDisponible).
 */
export function pdfFiscalDisponible(row: ComprobantePdfRow): boolean {
  const ivaOk = row.tipo === "C" || (row.importe_iva !== null && row.importe_iva !== undefined)
  return datosQrDesdeComprobante(row) !== null && ivaOk && !REQUERIDO_VACIO(row.cae_vencimiento)
}
