/**
 * Reglas de plata de una nota de crédito (spec, "Reglas de plata"), espejo TS
 * de registrar_devolucion_monto (migración 365). Lo usa el diálogo para
 * mostrar en vivo lo que la base va a hacer; la base es la que decide.
 *
 * Los casos de __tests__/lib/notas-credito-reparto.test.ts son los de los
 * probes de la 365: si cambia uno, cambia el otro.
 */

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100

/** Lo que queda por acreditar: facturado − Σ monto de las NC activas. Nunca negativo. */
export function disponibleParaAcreditar(facturado: number, acreditadoPrevio: number): number {
  return Math.max(round2(facturado - acreditadoPrevio), 0)
}

export interface RepartoNC {
  /** Parte que baja lo que el cliente todavía debe. */
  aplicado: number
  /** Parte que se le devuelve al cliente. */
  reembolso: number
  /** Lo que el cliente sigue debiendo después de la NC. */
  pendienteResultante: number
}

/**
 * Primero baja la deuda; solo el resto se devuelve.
 *   aplicado  = min(monto, pendiente)
 *   reembolso = monto − aplicado
 * @param pendiente lo que el cliente todavía debe de la operación
 *   (facturado − cobrado − Σ aplicado por NC activas). Negativo cuenta como 0.
 */
export function repartoNC(monto: number, pendiente: number): RepartoNC {
  const m = Math.max(round2(monto), 0)
  const p = Math.max(round2(pendiente), 0)
  const aplicado = Math.min(m, p)
  return { aplicado, reembolso: round2(m - aplicado), pendienteResultante: round2(p - aplicado) }
}
