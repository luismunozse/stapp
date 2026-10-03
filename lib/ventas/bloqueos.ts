/**
 * Qué impide tocar una venta. La ruta lo chequea antes de llamar al RPC para
 * dar un mensaje claro (y para proteger aunque la migración 328 todavía no
 * esté aplicada); el SQL repite los mismos controles dentro de la transacción.
 */

/** Relaciones que hay que traer con la venta para decidir. */
export const RELACIONES_BLOQUEO_VENTA =
  "facturas(id, estado_pago), devoluciones_venta(id), notas_credito(id, anulada), comprobantes_fiscales(id, estado), inventario_series(id)"

function lista<T = any>(x: unknown): T[] {
  if (Array.isArray(x)) return x as T[]
  return x ? [x as T] : []
}

/** Factura electrónica (ARCA) emitida o en proceso de emisión. */
export function tieneComprobanteFiscal(venta: any): boolean {
  return lista<{ estado?: string }>(venta?.comprobantes_fiscales).some(
    (c) => c.estado === "emitido" || c.estado === "pendiente"
  )
}

/**
 * Motivo por el que la venta no se puede editar, o null si se puede. Los
 * textos son los mismos que levanta editar_venta_atomica (P0021).
 */
export function motivoNoEditable(venta: any): string | null {
  if (tieneComprobanteFiscal(venta)) return "La venta tiene una factura electrónica emitida."
  if (lista<{ estado_pago?: string }>(venta?.facturas).some((f) => f.estado_pago !== "ANULADA")) {
    return "La venta tiene un remito generado."
  }
  if (lista(venta?.devoluciones_venta).length > 0) return "La venta tiene devoluciones registradas."
  if (lista<{ anulada?: boolean }>(venta?.notas_credito).some((n) => !n.anulada)) {
    return "La venta tiene una nota de crédito."
  }
  if (venta?.comision_pagada) return "La comisión de esta venta ya se liquidó al vendedor."
  if (lista(venta?.inventario_series).length > 0) return "La venta tiene productos con número de serie."
  return null
}

/**
 * Motivo por el que la venta no se puede anular, o null. Mismos textos que el
 * trigger proteger_anulacion_venta (mig 329, P0022). La nota de crédito
 * electrónica todavía no se emite desde el sistema: con CAE, la NC se hace en
 * ARCA y acá se registra la devolución.
 */
export function motivoNoAnulable(venta: any): string | null {
  if (tieneComprobanteFiscal(venta)) {
    return "La venta tiene una factura electrónica emitida: para anularla hay que emitir una nota de crédito en ARCA. Registrá la devolución de los productos."
  }
  if (lista<{ estado_pago?: string }>(venta?.facturas).some((f) => f.estado_pago !== "ANULADA")) {
    return "La venta tiene un remito vigente: anulalo primero desde Facturación."
  }
  return null
}

/**
 * Motivo por el que una venta (ya anulada) no se puede borrar, o null. Borrar
 * se llevaría el remito o el comprobante fiscal y su numeración (mig 329 deja
 * esas FK en NO ACTION). Los intentos de factura electrónica rechazados no
 * cuentan: no tienen CAE y la ruta los borra antes.
 */
export function motivoNoEliminable(venta: any): string | null {
  if (tieneComprobanteFiscal(venta)) return "La venta tiene una factura electrónica emitida."
  if (lista(venta?.facturas).length > 0) return "La venta tiene un remito: borrarla perdería su numeración."
  return null
}

/** Mensaje de un error P0021/P0022 del SQL sin el prefijo técnico. */
export function mensajeBloqueoSql(message: string | undefined): string {
  return (message || "").replace(/^VENTA_NO_(EDITABLE|ANULABLE):\s*/, "")
}
