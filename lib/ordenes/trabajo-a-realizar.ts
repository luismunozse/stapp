/**
 * "Trabajo a realizar" admite varios trabajos. Se guardan en la misma columna
 * de texto (`ordenes_servicio.trabajo_a_realizar`, tope de 200 caracteres en
 * total), uno por línea, para no necesitar una migración.
 */

/** Tope total de la columna (CHECK de la migración 415). */
export const TRABAJO_A_REALIZAR_MAX = 200

/** Lista de trabajos a partir del texto guardado (uno por línea, sin vacíos). */
export function parseTrabajosARealizar(texto: string | null | undefined): string[] {
  if (!texto) return []
  return texto
    .split(/\r?\n/)
    .map((t) => t.trim())
    .filter(Boolean)
}

/** Texto a guardar a partir de la lista; null si no queda ningún trabajo. */
export function joinTrabajosARealizar(trabajos: string[]): string | null {
  const limpios = trabajos.map((t) => t.replace(/[\r\n]+/g, " ").trim()).filter(Boolean)
  return limpios.length > 0 ? limpios.join("\n") : null
}
