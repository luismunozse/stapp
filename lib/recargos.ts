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

/**
 * Método que fija el precio de la venta: el pago de mayor monto (empate => el
 * primero). Sin pagos => el metodoPago de fallback.
 */
export function metodoCondicion(
  pagos: Array<{ metodo: string; monto: number }> | undefined,
  metodoPagoFallback: string
): string {
  if (!pagos || pagos.length === 0) return metodoPagoFallback
  let elegido = pagos[0]
  for (const p of pagos) {
    if (p.monto > elegido.monto) elegido = p
  }
  return elegido.metodo
}
