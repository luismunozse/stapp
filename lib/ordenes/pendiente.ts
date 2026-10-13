/**
 * Pendiente de cobro de una orden: lo facturado (costo final menos el
 * descuento de cobro) menos lo cobrado y menos lo que bajaron la deuda las
 * notas de crédito activas.
 *
 * Espejo TS de `pendiente_orden()` (migración 360). Devuelve el valor crudo,
 * sin redondear ni recortar en 0: cada consumidor sigue redondeando o
 * recortando como lo hacía antes de existir este helper.
 */
export interface MontosPendienteOrden {
  costoFinal: number
  descuentoCobro: number
  totalCobrado: number
  aplicadoNotasCredito: number
}

export function pendienteOrden(m: MontosPendienteOrden): number {
  return m.costoFinal - m.descuentoCobro - m.totalCobrado - m.aplicadoNotasCredito
}

/**
 * Embed de PostgREST que trae lo que necesita `aplicadoNotasCreditoDeOrden`.
 * Va en la misma query que ya lee la orden: sin un SELECT aparte.
 */
export const NOTAS_CREDITO_APLICADO_EMBED = "notas_credito (monto_aplicado_deuda, anulada)"

interface NotaCreditoAplicada {
  monto_aplicado_deuda: string | number | null
  anulada: boolean | null
}

/**
 * Lo que bajaron la deuda las NC activas de una fila de `ordenes_servicio`
 * leída con `NOTAS_CREDITO_APLICADO_EMBED`. Sin el embed da 0.
 */
export function aplicadoNotasCreditoDeOrden(
  orden: { notas_credito?: ReadonlyArray<NotaCreditoAplicada> | null } | null | undefined
): number {
  const total = (orden?.notas_credito ?? []).reduce((suma, nc) => {
    if (nc.anulada) return suma
    return suma + (Number(nc.monto_aplicado_deuda) || 0)
  }, 0)
  return Math.round(total * 100) / 100
}
