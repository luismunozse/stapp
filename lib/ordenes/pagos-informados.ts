/**
 * Pagos informados por el cliente desde el seguimiento público.
 *
 * El cliente avisa que pagó (transferencia / Mercado Pago, con comprobante) o
 * que paga en efectivo al retirar. No es un cobro: queda PENDIENTE hasta que
 * el taller lo confirma (ahí se registra el cobro) o lo rechaza. Tabla:
 * `pagos_informados` (migración 419).
 */

export const METODOS_PAGO_INFORMADO = ["TRANSFERENCIA", "MERCADOPAGO", "EFECTIVO"] as const
export type MetodoPagoInformado = (typeof METODOS_PAGO_INFORMADO)[number]

export type EstadoPagoInformado = "PENDIENTE" | "CONFIRMADO" | "RECHAZADO"

export const METODO_PAGO_INFORMADO_LABEL: Record<MetodoPagoInformado, string> = {
  TRANSFERENCIA: "Transferencia",
  MERCADOPAGO: "Mercado Pago",
  EFECTIVO: "Efectivo al retirar",
}

/** Métodos que exigen comprobante (el efectivo se paga en el local). */
export function requiereComprobante(metodo: MetodoPagoInformado): boolean {
  return metodo !== "EFECTIVO"
}

/**
 * Estados de la orden en los que el cliente puede informar un pago: cuando el
 * equipo está listo para retirar, que es cuando el taller le avisa.
 */
export const ESTADOS_PAGO_INFORMADO: readonly string[] = ["REPARADO"]

/** ¿Se le ofrece al cliente informar un pago? Estado habilitado y saldo a favor del taller. */
export function puedeInformarPago(estado: string | null | undefined, saldo: number): boolean {
  return !!estado && ESTADOS_PAGO_INFORMADO.includes(estado) && saldo > 0.009
}

/** Redondeo a centavos (los montos viajan como number). */
export function redondearMonto(n: number): number {
  return Math.round(n * 100) / 100
}

export const COMPROBANTE_MAX_BYTES = 5 * 1024 * 1024

export type ComprobanteMime = "image/jpeg" | "image/png" | "image/webp" | "application/pdf"

/**
 * Tipo real del comprobante por sus primeros bytes (el Content-Type que manda
 * el navegador se puede falsificar). Acepta JPG, PNG, WEBP y PDF.
 */
export function detectarMimeComprobante(buf: Uint8Array): ComprobanteMime | null {
  if (buf.length < 12) return null
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg"
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) return "image/png"
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return "image/webp"
  // "%PDF-"
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46 && buf[4] === 0x2d) return "application/pdf"
  return null
}

export const EXTENSION_COMPROBANTE: Record<ComprobanteMime, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
}

/** Prefijo de los comprobantes de una orden dentro del bucket comprobantes-gastos. */
export function prefijoComprobantesOrden(organizationId: string, ordenId: string): string {
  return `${organizationId}/pagos-informados/${ordenId}`
}

/** Clave de idempotencia del cobro que nace al confirmar un aviso: confirmar dos veces no cobra dos veces. */
export function claveCobroPagoInformado(pagoInformadoId: string): string {
  return `pago-informado:${pagoInformadoId}`
}
