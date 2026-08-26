import { supabaseAdmin } from "@/lib/supabase"

/**
 * Única definición de "qué cotizaciones cuentan para una orden".
 *
 * Estaba copiada en seis lugares (la API de cotizaciones, la de enviar y la de
 * alta), y eso hacía que cualquier cambio en el criterio tuviera que acertarle
 * a los seis. Con una sola definición, el criterio se cambia una vez.
 */
export async function cotizacionesVigentesDeOrden(
  ordenId: string,
  excluirId?: string
): Promise<Array<{ total: number }>> {
  let q = supabaseAdmin
    .from("cotizaciones")
    .select("total")
    .eq("orden_id", ordenId)
    .is("deleted_at", null)
    .is("reemplazada_por", null)
    .neq("estado", "RECHAZADA")
  // El camino de borrado pregunta "¿queda alguna OTRA?", así que necesita
  // sacarse a sí misma de la cuenta. Restarle uno al resultado no sirve: si la
  // fila que se borra ya está rechazada o reemplazada, no estaba en la lista.
  if (excluirId) q = q.neq("id", excluirId)
  const { data } = await q
  return (data || []) as Array<{ total: number }>
}

/** Total presupuestado de una orden y cuántas cotizaciones lo componen. */
export async function totalPresupuestoDeOrden(
  ordenId: string
): Promise<{ total: number; cantidad: number }> {
  const vigentes = await cotizacionesVigentesDeOrden(ordenId)
  const total = vigentes.reduce((sum, c) => sum + Number(c.total), 0)
  return { total, cantidad: vigentes.length }
}
