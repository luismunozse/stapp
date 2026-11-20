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

/**
 * Detalle que acompaña al presupuesto en la hoja de recepción: lo que el taller
 * escribió en "Trabajo a realizar" o, si ese campo está vacío, los servicios y
 * repuestos ya cargados en la orden. Así el monto nunca sale como un
 * "Presupuesto estimado" suelto cuando la orden ya dice de qué es.
 *
 * Los ítems se acotan al mismo tope que el campo de texto (los que no entran se
 * resumen en "+N más"): las hojas son de alto fijo y están medidas para ese largo.
 */
export function detallePresupuesto(
  texto: string | null | undefined,
  items?: Array<{ nombre?: string | null; cantidad?: number | null }> | null,
): string[] {
  const escritos = parseTrabajosARealizar(texto)
  if (escritos.length > 0) return escritos

  const nombres = (items || [])
    .map((it) => {
      const nombre = String(it?.nombre ?? "").replace(/[\r\n]+/g, " ").trim()
      const cantidad = Number(it?.cantidad) || 0
      return nombre && cantidad > 1 ? `${nombre} x${cantidad}` : nombre
    })
    .filter(Boolean)

  const detalle: string[] = []
  let largo = 0
  for (const nombre of nombres) {
    if (detalle.length > 0 && largo + nombre.length > TRABAJO_A_REALIZAR_MAX) break
    detalle.push(nombre.slice(0, TRABAJO_A_REALIZAR_MAX))
    largo += nombre.length
  }
  const resto = nombres.length - detalle.length
  if (resto > 0) detalle.push(`+${resto} más`)
  return detalle
}
