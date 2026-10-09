/**
 * Textos de la orden de ingreso (comprobante de recepción): el trabajo que el
 * taller planea hacer y los días de garantía que se comprometen. Compartido
 * entre las APIs, el PDF A4 y los comprobantes térmicos para que todos
 * apliquen las mismas reglas de omisión.
 */

export const TRABAJO_A_REALIZAR_MAX = 2000

/** Texto libre opcional: recorta espacios y deja `null` si queda vacío. */
export function normalizarTrabajoARealizar(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

/**
 * "Garantía: N días desde la entrega". Devuelve `null` (la línea se omite) si
 * los días son 0, nulos, negativos o no numéricos.
 */
export function garantiaDesdeEntregaTexto(dias: unknown): string | null {
  const n = typeof dias === "string" ? Number(dias) : dias
  if (typeof n !== "number" || !Number.isFinite(n)) return null
  const entero = Math.floor(n)
  if (entero <= 0) return null
  return `Garantía: ${entero} ${entero === 1 ? "día" : "días"} desde la entrega`
}
