/**
 * Estados de orden que nunca devengan ingreso en los reportes de rentabilidad
 * (estado de resultados y tendencia financiera): sus cobros no cuentan como
 * adelanto y la orden no entra en los terminales del período.
 */
export const ESTADOS_ORDEN_NUNCA_DEVENGAN: ReadonlySet<string> = new Set([
  "CANCELADO",
  "SIN_REPARACION",
  "SIN_FALLA_DETECTADA",
])

/** Embed para saber el estado de la orden de cada nota de crédito. */
export const NC_ORDEN_ESTADO_EMBED = "ordenes_servicio(estado)"

/**
 * Una nota de crédito resta ingreso devengado solo si su orden puede devengar.
 * Si la orden nunca devenga, su ingreso no está en el reporte y restar la NC
 * la contaría dos veces. Sin orden resta como siempre.
 *
 * Solo para reportes de devengado: en los de caja el cobro de una orden
 * cancelada sigue sumando y su NC tiene que seguir restando.
 */
export function notaCreditoRestaDevengado(nc: {
  orden_id?: string | null
  ordenes_servicio?: { estado?: string | null } | null
}): boolean {
  if (!nc.orden_id) return true
  const estado = nc.ordenes_servicio?.estado
  return !(estado && ESTADOS_ORDEN_NUNCA_DEVENGAN.has(estado))
}
