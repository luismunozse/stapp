/**
 * Qué impide tocar una venta. La ruta lo chequea antes de llamar al RPC para
 * dar un mensaje claro (y para proteger aunque la migración 328 todavía no
 * esté aplicada); el SQL repite los mismos controles dentro de la transacción.
 *
 * Los comprobantes fiscales de una venta son facturas y, si alguna se anuló
 * desde el sistema, sus notas de crédito electrónicas. Se distinguen por
 * `cbte_tipo` (8 / 13 = nota de crédito; el resto, o NULL en filas legadas, es
 * factura): esa columna existe desde la migración 370, así que esta lectura no
 * depende de la 371.
 */
import { esNotaCreditoFiscal } from "@/lib/facturacion/cbte-tipo"

/** Relaciones que hay que traer con la venta para decidir. */
export const RELACIONES_BLOQUEO_VENTA =
  "facturas(id, estado_pago), devoluciones_venta(id), notas_credito(id, anulada), comprobantes_fiscales(id, estado, cbte_tipo), inventario_series(id)"

/**
 * Texto del trigger `proteger_anulacion_venta` (migración 371) sin el prefijo
 * `VENTA_NO_ANULABLE:`. Un test lo compara con el SQL: si cambia uno, cambia el otro.
 */
export const MENSAJE_FACTURA_ANULAR_PRIMERO =
  'La venta tiene una factura electrónica emitida: anulala primero con "Anular factura" en el bloque Factura electrónica.'

interface ComprobanteFila {
  estado?: string
  cbte_tipo?: number | null
}

function lista<T = any>(x: unknown): T[] {
  if (Array.isArray(x)) return x as T[]
  return x ? [x as T] : []
}

const comprobantesDe = (venta: any) => lista<ComprobanteFila>(venta?.comprobantes_fiscales)

const estaVigente = (c: ComprobanteFila) => c.estado === "emitido" || c.estado === "pendiente"

/**
 * Hay una FACTURA electrónica (ARCA) emitida o en proceso de emisión. Las notas
 * de crédito, las facturas anuladas y los intentos rechazados no cuentan.
 */
export function tieneFacturaFiscalVigente(venta: any): boolean {
  return comprobantesDe(venta).some((c) => !esNotaCreditoFiscal(c.cbte_tipo) && estaVigente(c))
}

/** Hay una nota de crédito electrónica emitida o en proceso de emisión. */
export function tieneNotaCreditoFiscalVigente(venta: any): boolean {
  return comprobantesDe(venta).some((c) => esNotaCreditoFiscal(c.cbte_tipo) && estaVigente(c))
}

/**
 * Motivo por el que la venta no se puede editar, o null si se puede. Los
 * textos son los mismos que levanta editar_venta_atomica (P0021).
 */
export function motivoNoEditable(venta: any): string | null {
  if (tieneFacturaFiscalVigente(venta)) return "La venta tiene una factura electrónica emitida."
  // Hasta la migración 372, editar_venta_atomica cuenta también las notas de
  // crédito como "factura emitida": una venta con la factura ya anulada seguiría
  // bloqueada con un texto que no le corresponde. Se dice lo que hay de verdad;
  // la 372 saca este caso (y su test) cuando el RPC deje de contarlas.
  if (tieneNotaCreditoFiscalVigente(venta)) return "La venta tiene una nota de crédito electrónica (ARCA)."
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
 * trigger proteger_anulacion_venta (mig 371, P0022). Solo una FACTURA vigente
 * bloquea: una vez anulada con su nota de crédito, la venta se puede anular.
 */
export function motivoNoAnulable(venta: any): string | null {
  if (tieneFacturaFiscalVigente(venta)) return MENSAJE_FACTURA_ANULAR_PRIMERO
  if (lista<{ estado_pago?: string }>(venta?.facturas).some((f) => f.estado_pago !== "ANULADA")) {
    return "La venta tiene un remito vigente: anulalo primero desde Facturación."
  }
  return null
}

/**
 * Motivo por el que una venta (ya anulada) no se puede borrar, o null. Borrar
 * se llevaría el remito o los comprobantes fiscales y su numeración (mig 329
 * deja esas FK en NO ACTION). Una factura anulada y su nota de crédito también
 * cuentan: son documentos emitidos en ARCA. Solo los intentos rechazados no
 * bloquean: no tienen CAE y la ruta los borra antes.
 */
export function motivoNoEliminable(venta: any): string | null {
  if (tieneFacturaFiscalVigente(venta)) return "La venta tiene una factura electrónica emitida."
  if (comprobantesDe(venta).some((c) => c.estado === "emitido" || c.estado === "pendiente" || c.estado === "anulado")) {
    return "La venta tiene una factura electrónica anulada y su nota de crédito: borrarla perdería su numeración."
  }
  if (lista(venta?.facturas).length > 0) return "La venta tiene un remito: borrarla perdería su numeración."
  return null
}

/** Mensaje de un error P0021/P0022 del SQL sin el prefijo técnico. */
export function mensajeBloqueoSql(message: string | undefined): string {
  return (message || "").replace(/^VENTA_NO_(EDITABLE|ANULABLE):\s*/, "")
}
