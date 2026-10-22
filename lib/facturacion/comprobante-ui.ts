// Helpers de presentacion de comprobantes fiscales, compartidos por la ficha de
// la venta y el listado de /facturacion.

/** Fila del listado (`GET /api/facturacion-electronica/comprobantes`). */
export interface ComprobanteFiscalDTO {
  id: string
  ventaId: string | null
  numeroVenta: number | null
  tipo: string
  puntoVenta: number | null
  numero: string | null
  cae: string | null
  caeVencimiento: string | null
  estado: string
  total: number | null
  errorMsg: string | null
  pdfUrl: string | null
  fechaEmision: string | null
  createdAt: string
  pdfDisponible: boolean
  /** Codigo ARCA (6/11 factura, 8/13 nota de credito). `null` en filas anteriores a la foto fiscal. */
  cbteTipo: number | null
  /** Nota de credito electronica (ARCA), no las "NC-" internas de devoluciones. */
  esNotaCredito: boolean
  /** Solo en una nota de credito: la factura que anula. */
  comprobanteAsociadoId: string | null
  /** Solo en una factura anulada: cuando quedo anulada. */
  anuladoAt: string | null
  /** Solo en una nota de credito: error_factura | devolucion_total | otro. */
  motivo: string | null
  motivoDetalle: string | null
  /** La fila misma cumple lo que exige anular; la ficha suma "sin otra nota de credito en curso". */
  anulable: boolean
  /** Nota de credito pendiente con numero pedido: se puede consultar a ARCA. */
  verificable: boolean
}

export interface ListadoComprobantesResponse {
  items: ComprobanteFiscalDTO[]
  total: number
  page: number
  limit: number
  totalPages: number
  puedeEmitir: boolean
}

const ETIQUETAS_ESTADO: Record<string, string> = {
  emitido: "Emitida",
  pendiente: "En proceso",
  rechazado: "Rechazada",
  anulado: "Anulada",
}

export function etiquetaEstadoComprobante(estado: string): string {
  return ETIQUETAS_ESTADO[estado] ?? estado
}

/**
 * "2026-10-19" o "20261029" -> "19/10/2026". Son fechas de calendario de ARCA
 * (sin hora): se formatean como texto para que ninguna zona horaria las corra un dia.
 */
export function fechaFiscalDMA(valor: string | null | undefined): string {
  if (!valor) return "-"
  const m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(valor)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : valor
}

export function tituloComprobante(tipo: string, numero: string | null, esNotaCredito = false): string {
  const base = `${esNotaCredito ? "Nota de crédito" : "Factura"} ${tipo}`
  return numero ? `${base} ${numero}` : base
}

export function pdfComprobanteHref(id: string): string {
  return `/api/facturacion-electronica/comprobantes/${id}/pdf`
}
