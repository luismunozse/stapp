import { cargarConfigMoneda, resolverTipoCambio } from "@/lib/currency/tipo-cambio.server"
import { precioALocal, type MonedaCatalogo } from "@/lib/currency/catalogo"
import type { ConfigMoneda } from "@/lib/currency/config-moneda"
import type { ResultadoTipoCambio } from "@/lib/currency/tipo-cambio"

/** `config` null means the context could not be resolved: every foreign-currency item has no equivalent. */
export type ContextoValuacion = { config: ConfigMoneda | null; tc: ResultadoTipoCambio | null }

/**
 * Resolves config + exchange rate once per request, only when at least one item is in a foreign
 * currency. Null means every item is local and plain sums are exact. If the resolution fails the
 * foreign items degrade to "no rate" (excluded and counted) instead of failing the request.
 */
export async function resolverContextoValuacion(
  organizationId: string,
  items: Array<{ moneda?: MonedaCatalogo | null }>
): Promise<ContextoValuacion | null> {
  if (!items.some((i) => i.moneda != null)) return null
  try {
    const { config } = await cargarConfigMoneda(organizationId)
    const tc = await resolverTipoCambio(organizationId)
    return { config, tc }
  } catch (err) {
    console.error("Error resolviendo la cotización para la valuación de stock:", err)
    return { config: null, tc: null }
  }
}

/** One amount (in the item's own currency) in local currency; null when it has no equivalent. */
export function montoLocal(
  monto: number | null | undefined,
  moneda: MonedaCatalogo | undefined,
  ctx: ContextoValuacion | null
): number | null {
  if (moneda == null || ctx === null) return typeof monto === "number" && Number.isFinite(monto) ? monto : null
  if (ctx.config === null) return null
  return precioALocal(monto, moneda, ctx.config, ctx.tc)
}

/** Sums `monto` (in each item's own currency) in local currency; items with no equivalent are left out. */
export function valuarLocal<T extends { moneda?: MonedaCatalogo | null }>(
  items: T[],
  monto: (i: T) => number,
  ctx: ContextoValuacion | null
): { total: number; aproximado: boolean } {
  if (ctx === null) return { total: items.reduce((s, i) => s + monto(i), 0), aproximado: false }
  let total = 0
  let aproximado = false
  for (const i of items) {
    const local = montoLocal(monto(i), i.moneda ?? null, ctx)
    if (local === null) continue
    if (i.moneda != null) aproximado = true
    total += local
  }
  return { total: Math.round(total * 100) / 100, aproximado }
}

/** Number of distinct foreign-currency items with no local equivalent. */
export function contarExcluidos(
  items: Array<{ moneda?: MonedaCatalogo | null }>,
  ctx: ContextoValuacion | null
): number {
  if (ctx === null) return 0
  return items.filter((i) => i.moneda != null && montoLocal(0, i.moneda, ctx) === null).length
}
