/**
 * Estados de orden que definen la membresia de un lote (recepcion multiple).
 *
 * Fuente unica: la vista del lote, la API de detalle, la API de entrega y la
 * RPC `entregar_lote_recepcion` (migracion 352) tienen que coincidir. Antes
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
import { round2 } from "@/lib/lote-utils"

export const ESTADOS_ENTREGADOS = [
  "ENTREGADO",
  "ENTREGADO_SIN_REPARACION",
  "ENTREGADO_SIN_COBRO",
] as const

/**
 * Cerradas sin entrega con cobro. Ademas de no poder entregarse en lote, estas
 * salen de TODAS las lineas de dinero del lote (subtotal, total, ya cobrado,
 * pendiente): no se cobran ni se negociaron, asi que su presupuesto no puede
 * inflar el total que ve el operador. Siguen apareciendo en la lista de
 * equipos.
 */
export const ESTADOS_CERRADOS_SIN_ENTREGA = ["CANCELADO", "SIN_REPARACION", "SIN_FALLA_DETECTADA"] as const

export const ESTADOS_EXCLUIDOS_LOTE = [...ESTADOS_ENTREGADOS, ...ESTADOS_CERRADOS_SIN_ENTREGA] as const

/** El estado ya cuenta como entrega (el equipo salio del taller). */
export function esEstadoEntregado(estado: string | null | undefined): boolean {
  return estado != null && (ESTADOS_ENTREGADOS as readonly string[]).includes(estado)
}

/** El estado saca a la orden de la accion de lote (entregada o cerrada). */
export function esEstadoExcluidoDeLote(estado: string | null | undefined): boolean {
  return estado != null && (ESTADOS_EXCLUIDOS_LOTE as readonly string[]).includes(estado)
}

/**
 * Entregadas "aparte": ENTREGADO_SIN_COBRO (el taller regalo el equipo:
 * cortesia, garantia, desistio) y ENTREGADO_SIN_REPARACION (retiro sin
 * reparar, que se liquido por su cuenta al entregar y puede traer un
 * costo_final que no se cobro entero). Salieron del taller, pero nunca
 * formaron parte de lo negociado en el lote: quedan FUERA de todas las lineas
 * de dinero (subtotal, base del descuento, ya cobrado). No suben ni bajan lo
 * que pagan los demas equipos.
 */
export function esEstadoEntregadoAparte(estado: string | null | undefined): boolean {
  return estado === "ENTREGADO_SIN_COBRO" || estado === "ENTREGADO_SIN_REPARACION"
}

/** Entregada de forma normal (ENTREGADO): la unica que cuenta como "ya cobrado" del lote. */
export function esEstadoEntregadoNormal(estado: string | null | undefined): boolean {
  return esEstadoEntregado(estado) && !esEstadoEntregadoAparte(estado)
}

/** La orden no entra en los montos del lote (cerrada sin entrega o entregada aparte). */
export function esEstadoFueraDeLosMontos(estado: string | null | undefined): boolean {
  return esEstadoCerradoSinEntrega(estado) || esEstadoEntregadoAparte(estado)
}

export interface MiembroEntregadoPrevio {
  estado: string | null | undefined
  costo_final?: number | string | null
  descuento_cobro?: number | string | null
}

/**
 * Lo que los miembros ya entregados (ENTREGADO) aportan a la liquidacion del
 * lote: su costo (base del descuento) y lo que se les cobro neto. Fuente unica
 * para la ruta de entrega y el detalle, asi servidor y pantalla no divergen.
 */
export function liquidarEntregadosPrevios(miembros: MiembroEntregadoPrevio[]): {
  subtotal: number
  yaCobrado: number
} {
  const previos = miembros.filter((m) => esEstadoEntregadoNormal(m.estado))
  return {
    subtotal: round2(previos.reduce((a, m) => a + Number(m.costo_final ?? 0), 0)),
    yaCobrado: round2(
      previos.reduce((a, m) => a + round2(Number(m.costo_final ?? 0) - Number(m.descuento_cobro ?? 0)), 0),
    ),
  }
}

/** La orden se cerro sin entrega con cobro: no entra en los montos del lote. */
export function esEstadoCerradoSinEntrega(estado: string | null | undefined): boolean {
  return estado != null && (ESTADOS_CERRADOS_SIN_ENTREGA as readonly string[]).includes(estado)
}
