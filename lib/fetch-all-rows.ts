import { supabaseAdmin } from "@/lib/supabase"

/** PostgREST devuelve como maximo 1000 filas por request, sin error. */
export const FETCH_PAGE_SIZE = 1000

type Row = Record<string, unknown>

/**
 * Lee TODAS las filas de una consulta, paginando de a FETCH_PAGE_SIZE.
 *
 * Un `select` sin paginar se trunca en silencio a 1000 filas: las filas que
 * quedan afuera parecen "no existir" y el chequeo de error nunca se dispara.
 * Para los crons eso significa orgs activas que parecen inactivas.
 *
 * - `apply` agrega filtros a la consulta (`(q) => q.in("organization_id", ids)`).
 * - El orden siempre termina en `id` (unico) para que las paginas sean estables.
 * - Si cualquier pagina falla, lanza: un error nunca se degrada a "sin filas".
 */
export async function fetchAllRows<T = Row>(
  table: string,
  select: string,
  apply: (query: any) => any,
  orderBy: Array<{ column: string; ascending?: boolean }> = []
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += FETCH_PAGE_SIZE) {
    let query = apply(supabaseAdmin.from(table).select(select))
    for (const { column, ascending } of orderBy) {
      query = query.order(column, { ascending: ascending !== false })
    }
    const { data, error } = await query
      .order("id", { ascending: true })
      .range(from, from + FETCH_PAGE_SIZE - 1)

    if (error) throw new Error(`${table}: ${error.message}`)
    rows.push(...((data ?? []) as T[]))
    if (!data || data.length < FETCH_PAGE_SIZE) break
  }
  return rows
}
