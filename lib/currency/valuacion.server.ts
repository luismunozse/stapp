import { cargarConfigMoneda, resolverTipoCambio } from "@/lib/currency/tipo-cambio.server"
import { cotizacionDe, precioALocal, valorLocalStock, type MonedaCatalogo } from "@/lib/currency/catalogo"
import type { ConfigMoneda } from "@/lib/currency/config-moneda"
import type { ResultadoTipoCambio } from "@/lib/currency/tipo-cambio"

export type ContextoValuacion = { config: ConfigMoneda; tc: ResultadoTipoCambio | null }

/**
 * Resolves config + exchange rate once per request, only when at least one item is in a foreign
 * currency. Null means every item is local and plain sums are exact.
 */
export async function resolverContextoValuacion(
  organizationId: string,
  items: Array<{ moneda?: MonedaCatalogo | null }>
): Promise<ContextoValuacion | null> {
  if (!items.some((i) => i.moneda != null)) return null
  const { config } = await cargarConfigMoneda(organizationId)
  const tc = await resolverTipoCambio(organizationId)
  return { config, tc }
}

/** Sums `monto` (in each item's own currency) in local currency. */
export function valuarLocal<T extends { moneda?: MonedaCatalogo | null }>(
  items: T[],
  monto: (i: T) => number,
  ctx: ContextoValuacion | null
): { total: number; aproximado: boolean } {
  if (ctx === null) return { total: items.reduce((s, i) => s + monto(i), 0), aproximado: false }
  const r = valorLocalStock(
    items.map((i) => ({ i, moneda: (i.moneda ?? null) as MonedaCatalogo })),
    (w) => monto(w.i),
    ctx.config,
    ctx.tc
  )
  return { total: r.total, aproximado: r.convertido }
}

/** Number of distinct foreign-currency items with no local equivalent. */
export function contarExcluidos(
  items: Array<{ moneda?: MonedaCatalogo | null }>,
  ctx: ContextoValuacion | null
): number {
  if (ctx === null) return 0
  return items.filter((i) => i.moneda != null && cotizacionDe(i.moneda, ctx.config, ctx.tc) === null).length
}

/** One amount (in the item's own currency) in local currency; 0 when it has no equivalent. */
export function montoLocal(monto: number, moneda: MonedaCatalogo | undefined, ctx: ContextoValuacion | null): number {
  if (ctx === null) return monto
  return precioALocal(monto, moneda ?? null, ctx.config, ctx.tc) ?? 0
}
