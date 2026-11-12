/**
 * Catalog currency logic (inventario, servicios): pure, no I/O, importable from the browser
 * and from API routes.
 *
 * A catalog item's `moneda` is null (the organization's local currency) or exactly the
 * organization's single foreign currency. An item in a currency other than the current foreign
 * one, or with no rate available, has no local equivalent (null).
 */

import { round2 } from "@/lib/ventas/totales"
import { convertirALocal, unidadRedondeo, type MonedaExtranjera } from "@/lib/currency/convert"
import type { ConfigMoneda, FuenteTipoCambio } from "@/lib/currency/config-moneda"
import type { ResultadoTipoCambio } from "@/lib/currency/tipo-cambio"

export type MonedaCatalogo = MonedaExtranjera | null

export type ValidacionMonedaCatalogo = { ok: true; moneda: MonedaCatalogo } | { ok: false; error: string }

/**
 * Validates the `moneda` of a catalog write. `pedida` undefined keeps `actual`; null (local) is
 * always allowed; the same code the item already has is kept even if the feature was turned off
 * or the foreign currency changed; a new code needs the feature on and the org's foreign currency.
 */
export function validarMonedaEscritura(
  pedida: unknown,
  actual: MonedaCatalogo | undefined,
  config: ConfigMoneda
): ValidacionMonedaCatalogo {
  if (pedida === undefined) return { ok: true, moneda: actual ?? null }
  if (pedida === null) return { ok: true, moneda: null }
  if ((pedida === "USD" || pedida === "EUR") && pedida === actual) return { ok: true, moneda: pedida }
  if (!config.habilitada) return { ok: false, error: "La moneda extranjera está deshabilitada" }
  if (pedida === config.monedaExtranjera) return { ok: true, moneda: config.monedaExtranjera }
  return { ok: false, error: `La moneda del precio debe ser la moneda local o ${config.monedaExtranjera}` }
}

/** Rate to turn one unit of `moneda` into local: 1 for local, null when there is none. */
export function cotizacionDe(
  moneda: MonedaCatalogo,
  config: ConfigMoneda,
  tc: ResultadoTipoCambio | null
): number | null {
  if (moneda === null) return 1
  if (moneda === config.monedaExtranjera && tc?.disponible) return tc.valor
  return null
}

/** Price in local currency, or null when it has no equivalent (no rate, other currency, invalid price). */
export function precioALocal(
  precio: number | null | undefined,
  moneda: MonedaCatalogo,
  config: ConfigMoneda,
  tc: ResultadoTipoCambio | null
): number | null {
  if (typeof precio !== "number" || !Number.isFinite(precio)) return null
  if (moneda === null) return precio
  if (precio < 0) return null
  const cotizacion = cotizacionDe(moneda, config, tc)
  if (cotizacion === null) return null
  return convertirALocal(precio, cotizacion, unidadRedondeo(config.redondeoConversion, config.monedaLocal))
}

/** Converts a catalog price between local and foreign currency at `tc` (used when switching an item's currency). */
export function convertirPrecioCatalogo(
  precio: number,
  de: MonedaCatalogo,
  a: MonedaCatalogo,
  tc: number,
  unidad: number
): number {
  if (de === a) return precio
  if (de === null) return round2(precio / tc)
  return convertirALocal(precio, tc, unidad)
}

const ETIQUETAS_FUENTE: Record<FuenteTipoCambio, string> = {
  MANUAL: "Manual",
  OFICIAL: "Oficial",
  BLUE: "Blue",
  MEP: "MEP",
}

export function etiquetaFuente(f: FuenteTipoCambio): string {
  return ETIQUETAS_FUENTE[f]
}

/** Kit cost in local currency; null if any component has no equivalent. */
export function costoKitLocal(
  componentes: { cantidad: number; precioCompra: number | null; moneda: MonedaCatalogo }[],
  config: ConfigMoneda,
  tc: ResultadoTipoCambio | null
): number | null {
  let total = 0
  for (const c of componentes) {
    const local = precioALocal(c.precioCompra ?? 0, c.moneda, config, tc)
    if (local === null) return null
    total += c.cantidad * local
  }
  return round2(total)
}

/** Stock value in local currency; `excluidos` counts items with no equivalent, `convertido` flags an approximation. */
export function valorLocalStock<T extends { moneda: MonedaCatalogo }>(
  items: T[],
  monto: (i: T) => number,
  config: ConfigMoneda,
  tc: ResultadoTipoCambio | null
): { total: number; excluidos: number; convertido: boolean } {
  let total = 0
  let excluidos = 0
  let convertido = false
  for (const i of items) {
    const local = precioALocal(monto(i), i.moneda, config, tc)
    if (local === null) {
      excluidos++
      continue
    }
    if (i.moneda !== null) convertido = true
    total += local
  }
  return { total: round2(total), excluidos, convertido }
}
