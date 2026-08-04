/**
 * Estados de orden que definen la membresia de un lote (recepcion multiple).
 *
 * Fuente unica: la vista del lote, la API de detalle, la API de entrega y la
 * RPC `entregar_lote_recepcion` (migracion 290) tienen que coincidir. Antes
 * habia copias sincronizadas a mano en tres archivos y ya divergian.
 *
 * Semantica del lote: una orden "sale" del lote por dos vias distintas.
 *  - ESTADOS_ENTREGADOS: ya se entrego (por el flujo individual o por una
 *    entrega de lote anterior). Su costo ya esta cobrado o bonificado, asi que
 *    cuenta para el total del lote y para "ya cobrado", pero no se vuelve a
 *    cobrar.
 *  - ESTADOS_EXCLUIDOS_LOTE: ademas de las entregadas, las que quedaron
 *    cerradas sin entrega con cobro (CANCELADO, SIN_REPARACION,
 *    SIN_FALLA_DETECTADA). Ninguna de ellas puede entregarse por la accion de
 *    lote — la maquina de estados las saca del camino REPARADO -> ENTREGADO —
 *    y por eso tampoco pueden bloquear el boton "Entregar lote" ni exigirse en
 *    el payload de la entrega.
 *
 * "Pendiente elegible" = miembro cuyo estado NO esta en ESTADOS_EXCLUIDOS_LOTE.
 */
export const ESTADOS_ENTREGADOS = [
  "ENTREGADO",
  "ENTREGADO_SIN_REPARACION",
  "ENTREGADO_SIN_COBRO",
] as const

export const ESTADOS_EXCLUIDOS_LOTE = [
  ...ESTADOS_ENTREGADOS,
  "CANCELADO",
  "SIN_REPARACION",
  "SIN_FALLA_DETECTADA",
] as const

/** El estado ya cuenta como entrega (el equipo salio del taller). */
export function esEstadoEntregado(estado: string | null | undefined): boolean {
  return estado != null && (ESTADOS_ENTREGADOS as readonly string[]).includes(estado)
}

/** El estado saca a la orden de la accion de lote (entregada o cerrada). */
export function esEstadoExcluidoDeLote(estado: string | null | undefined): boolean {
  return estado != null && (ESTADOS_EXCLUIDOS_LOTE as readonly string[]).includes(estado)
}
