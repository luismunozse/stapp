/**
 * Re-ingresos por garantía atribuidos al técnico de la orden ORIGINAL
 * (decisión 8 del dueño): si una reparación vuelve, cuenta contra quien la
 * reparó, no contra quien atiende el re-ingreso.
 *
 * Qué es un re-ingreso: una orden con es_reingreso. Es la misma definición que
 * usan las comisiones (381: es_reingreso OR una orden de reclamo); la 401 marcó
 * es_reingreso en las órdenes viejas nacidas de un reclamo y todo re-ingreso
 * nuevo nace marcado (lib/garantias/reingreso.ts), así que los dos conjuntos
 * coinciden. Los re-ingresos de una garantía de VENTA no tienen orden original
 * (orden_origen_id null) y no se atribuyen a ningún técnico.
 *
 * El período es el de la fecha de ingreso del re-ingreso.
 */
import { supabaseAdmin } from "@/lib/supabase"

const LOTE = 200

export async function reingresosPorTecnicoOriginal(params: {
  organizationId: string
  desdeISO: string
  /** Solo los de este técnico (insights); sin él, todos (resumen). */
  tecnicoId?: string
}): Promise<Map<string, number>> {
  const { data: reingresos, error } = await supabaseAdmin
    .from("ordenes_servicio")
    .select("id, orden_origen_id")
    .eq("organization_id", params.organizationId)
    .eq("es_reingreso", true)
    .eq("es_practica", false)
    .not("orden_origen_id", "is", null)
    .gte("fecha_ingreso", params.desdeISO)
  if (error) throw error

  const origenes = [...new Set(((reingresos ?? []) as { orden_origen_id: string | null }[])
    .map((r) => r.orden_origen_id)
    .filter((v): v is string => !!v))]

  const tecnicoDe = new Map<string, string>()
  for (let i = 0; i < origenes.length; i += LOTE) {
    let q = supabaseAdmin
      .from("ordenes_servicio")
      .select("id, tecnico_id")
      .eq("organization_id", params.organizationId)
      .in("id", origenes.slice(i, i + LOTE))
    if (params.tecnicoId) q = q.eq("tecnico_id", params.tecnicoId)
    const { data, error: err } = await q
    if (err) throw err
    for (const o of (data ?? []) as { id: string; tecnico_id: string | null }[]) {
      if (o.tecnico_id) tecnicoDe.set(o.id, o.tecnico_id)
    }
  }

  const conteo = new Map<string, number>()
  for (const r of (reingresos ?? []) as { orden_origen_id: string | null }[]) {
    const tecnico = r.orden_origen_id ? tecnicoDe.get(r.orden_origen_id) : undefined
    if (tecnico) conteo.set(tecnico, (conteo.get(tecnico) ?? 0) + 1)
  }
  return conteo
}
