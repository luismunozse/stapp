import { supabaseAdmin } from "@/lib/supabase"

/**
 * Mapa metodo_pago → porcentaje de recargo (precio efectivo) de la org.
 * Solo filas activas. Fail-safe: ante error devuelve {} (sin recargos).
 */
export async function getRecargosMetodo(
  organizationId: string
): Promise<Record<string, number>> {
  const { data, error } = await supabaseAdmin
    .from("recargos_metodo_pago")
    .select("metodo_pago, porcentaje")
    .eq("organization_id", organizationId)
    .eq("activo", true)

  if (error || !data) return {}
  const map: Record<string, number> = {}
  for (const row of data) {
    map[row.metodo_pago] = parseFloat(String(row.porcentaje)) || 0
  }
  return map
}

/** Factor multiplicador del precio para un método: 1 + %/100. Sin config => 1. */
export function factorRecargo(
  recargos: Record<string, number>,
  metodo: string
): number {
  return 1 + (recargos[metodo] ?? 0) / 100
}
