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
  const { data, error } = await q
  // Un error acá NO puede degradarse a "esta orden no tiene cotizaciones".
  // Esa respuesta es indistinguible de la verdadera, y los seis llamadores la
  // usan para escribir plata: con cantidad 0 la orden vuelve a EN_DIAGNOSTICO
  // y su `presupuesto`/`costo_final` quedan en NULL. El caso concreto que lo
  // dispara: contra una base sin la migración 311 la columna
  // `reemplazada_por` no existe y Postgres devuelve 42703 (undefined_column)
  // en CADA recálculo — el presupuesto de toda orden tocada se borraría en
  // silencio. Fallar fuerte deja la fila como está y el error a la vista.
  if (error) {
    throw new Error(
      `No se pudieron leer las cotizaciones vigentes de la orden ${ordenId}: ${error.message}`
    )
  }
  return (data || []) as Array<{ total: number }>
}

/**
 * Lo que las rutas de cotizaciones escriben en presupuesto/costo_final de la
 * orden: cotizaciones vigentes + servicios y repuestos que NO están incluidos
 * en ellas (sin cotización vigente, todas las líneas). Lo calcula
 * suma_lineas_orden (migración 421), la misma función que usa la
 * sincronización de las líneas: antes cada camino escribía su propio número
 * (solo cotizaciones / solo líneas) y se pisaban — la orden 82 cobraba el pin
 * de la cotización y perdía el servicio cargado aparte.
 *
 * `cotizaciones` es cuántas cotizaciones vigentes hay: los llamadores la usan
 * para decidir si la orden se quedó sin presupuesto. Igual que arriba, un error
 * explota en vez de devolver 0.
 */
export async function montoCalculadoDeOrden(
  ordenId: string
): Promise<{ monto: number; cotizaciones: number }> {
  const vigentes = await cotizacionesVigentesDeOrden(ordenId)
  const { data, error } = await supabaseAdmin.rpc("suma_lineas_orden", { p_orden_id: ordenId })
  if (error) {
    throw new Error(`No se pudo calcular el monto de la orden ${ordenId}: ${error.message}`)
  }
  return { monto: Number(data ?? 0), cotizaciones: vigentes.length }
}

/** Total presupuestado de una orden y cuántas cotizaciones lo componen. */
export async function totalPresupuestoDeOrden(
  ordenId: string
): Promise<{ total: number; cantidad: number }> {
  const vigentes = await cotizacionesVigentesDeOrden(ordenId)
  const total = vigentes.reduce((sum, c) => sum + Number(c.total), 0)
  return { total, cantidad: vigentes.length }
}
