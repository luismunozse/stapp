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

// Las funciones puras viven en lib/ventas/totales.ts para que el POS (navegador)
// use exactamente las mismas que el servidor.
export { factorRecargo, metodoCondicion } from "@/lib/ventas/totales"
