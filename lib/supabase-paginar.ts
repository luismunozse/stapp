/**
 * Trae todas las filas de una consulta, de a `pagina` (PostgREST devuelve como
 * máximo 1000 por pedido y corta en silencio: un reporte mensual con más
 * ventas o items daba números de menos sin avisar).
 *
 * `armar` crea la consulta desde cero en cada página: los builders de
 * supabase-js no se reusan después de un await. Tiene que tener un orden
 * estable (p. ej. `.order("id")`) para que las páginas no se pisen.
 */
export async function traerTodas<T = any>(
  armar: () => any,
  { pagina = 1000, maximo = 100_000 }: { pagina?: number; maximo?: number } = {}
): Promise<{ data: T[]; error: unknown }> {
  const filas: T[] = []
  for (let desde = 0; desde < maximo; desde += pagina) {
    const { data, error } = await armar().range(desde, desde + pagina - 1)
    if (error) return { data: filas, error }
    const lote = (data || []) as T[]
    filas.push(...lote)
    if (lote.length < pagina) break
  }
  return { data: filas, error: null }
}
