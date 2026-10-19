/**
 * Reglas de plata de una nota de crédito (spec, "Reglas de plata"), espejo TS
 * de registrar_devolucion_monto (migración 365). Lo usa el diálogo para
 * mostrar en vivo lo que la base va a hacer; la base es la que decide.
 *
 * Los casos de __tests__/lib/notas-credito-reparto.test.ts son los de los
 * probes de la 365: si cambia uno, cambia el otro.
 */

/**
 * Centavos como ROUND(x, 2) de Postgres: sobre el valor decimal, la mitad se
 * aleja del cero (2.135 → 2.14, −2.135 → −2.14).
 *
 * Multiplicar por 100 en binario no alcanza: 2.135 es 2.13499999… y daría 2.13.
 * toExponential() sin argumento da el decimal más corto que identifica al
 * número (el que tipeó el usuario o mandó la base, "2.135e+0"); correr el
 * exponente sobre ese texto da 213.5 exacto, y ahí sí se redondea.
 */
export const round2 = (n: number): number => {
  // Desde 2^53 / 100 un double ya no tiene centavos: no hay nada que redondear
  // (y el texto del número pasaría a notación exponencial).
  if (!Number.isFinite(n) || Math.abs(n) >= Number.MAX_SAFE_INTEGER / 100) return n
  const [mantisa, exponente] = Math.abs(n).toExponential().split("e")
  const centavos = Math.round(Number(`${mantisa}e${Number(exponente) + 2}`))
  if (centavos === 0) return 0
  const r = Number(`${centavos}e-2`)
  return n < 0 ? -r : r
}

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
