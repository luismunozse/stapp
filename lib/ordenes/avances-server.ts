import { supabaseAdmin } from "@/lib/supabase"
import { TIPO_AVANCE, avancesVisibles, type AvancePDF } from "@/lib/ordenes/avances"

/**
 * Avances marcados "visible para el cliente", para el PDF. Si la consulta
 * falla, el PDF sale sin avances: no vale la pena tirar el comprobante por eso.
 */
export async function cargarAvancesVisibles(ordenId: string, organizationId: string): Promise<AvancePDF[] | null> {
  const { data, error } = await supabaseAdmin
    .from("orden_eventos")
    .select("descripcion, created_at, metadata")
    .eq("orden_id", ordenId)
    .eq("organization_id", organizationId)
    .eq("tipo", TIPO_AVANCE)
    .order("created_at", { ascending: true })
  if (error) {
    console.error("[pdf] avances lookup failed:", error)
    return null
  }
  const avances = avancesVisibles(data)
  return avances.length > 0 ? avances : null
}
