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

export function tituloComprobante(tipo: string, numero: string | null): string {
  return numero ? `Factura ${tipo} ${numero}` : `Factura ${tipo}`
}

export function pdfComprobanteHref(id: string): string {
  return `/api/facturacion-electronica/comprobantes/${id}/pdf`
}
