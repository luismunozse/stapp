/**
 * Condiciones de garantía que trae un presupuesto (días + alcance).
 *
 * La garantía de una reparación corre desde la entrega: al convertir el
 * presupuesto en orden solo se guardan estas condiciones en la orden
 * (columnas garantia_presupuesto_dias / garantia_presupuesto_alcance, migración
 * 399) y la entrega las aplica.
 */

export const ALCANCES_GARANTIA = ["REPUESTO", "MANO_OBRA", "AMBOS", "NINGUNA"] as const
export type AlcanceGarantia = (typeof ALCANCES_GARANTIA)[number]

export const ALCANCE_GARANTIA_LABELS: Record<AlcanceGarantia, string> = {
  AMBOS: "Repuesto y mano de obra",
  REPUESTO: "Solo repuesto",
  MANO_OBRA: "Solo mano de obra",
  NINGUNA: "Sin garantía",
}

export function esAlcanceGarantia(v: unknown): v is AlcanceGarantia {
  return typeof v === "string" && (ALCANCES_GARANTIA as readonly string[]).includes(v)
}

export interface CondicionesGarantiaPresupuesto {
  dias: number | null
  alcance: AlcanceGarantia | null
}

/**
 * Lee las condiciones de garantía de `equipo.condiciones` de un presupuesto.
 * Sin alcance válido devuelve nulls: la entrega usa el valor por defecto de la
 * org. Con alcance NINGUNA los días quedan en 0.
 */
export function condicionesGarantiaDePresupuesto(
  condiciones: Record<string, unknown> | null | undefined
): CondicionesGarantiaPresupuesto {
  const alcance = condiciones?.garantiaAlcance
  if (!esAlcanceGarantia(alcance)) return { dias: null, alcance: null }
  if (alcance === "NINGUNA") return { dias: 0, alcance }
  const dias = condiciones?.garantiaDias
  return {
    dias: typeof dias === "number" && Number.isInteger(dias) && dias > 0 ? dias : null,
    alcance,
  }
}

/**
 * Notas de la garantía al entregar: agrega el alcance del presupuesto al
 * principio, salvo que el operador ya lo haya escrito.
 */
export function notasGarantiaConAlcance(
  notas: string | null | undefined,
  alcance: string | null | undefined
): string | null {
  const texto = notas?.trim() || ""
  if (!esAlcanceGarantia(alcance) || alcance === "NINGUNA" || /alcance\s*:/i.test(texto)) {
    return texto || null
  }
  const linea = `Alcance: ${ALCANCE_GARANTIA_LABELS[alcance]}.`
  return texto ? `${linea} ${texto}` : linea
}
