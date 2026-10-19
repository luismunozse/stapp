/**
 * Foreign-currency conversion: the single implementation for the browser (POS, forms) and for
 * the API routes. Pure: no server imports, no I/O.
 *
 * Normative order (REQ-3.2), each step feeding the next:
 *   1. convert each USD line to the local currency: roundUnit(origin x rate, redondeoConversion)
 *   2. payment-method surcharge on the local unit price
 *   3. line and global discounts
 *   4. IVA according to the regime
 *   5. cash rounding (redondeo_efectivo) on the FINAL total
 * Steps 2-5 are `calcularTotalesVenta`; this module only adds step 1 in front of it, so a sale
 * with no foreign line produces exactly what that function produces today.
 *
 * Only USD is supported as a foreign currency. `moneda` null means "the organization's local
 * currency".
 */

import {
  calcularTotalesVenta,
  round2,
  type DescuentoConfig,
  type FiscalConfig,
  type LineaVenta,
  type VentaTotales,
} from "@/lib/ventas/totales"

export type MonedaExtranjera = "USD"

/** Rates are stored with up to this many decimals (the column is NUMERIC(14,6)). */
export const MAX_DECIMALES_TIPO_CAMBIO = 6

export class TipoCambioInvalidoError extends Error {
  constructor(message = "El tipo de cambio debe ser un número mayor a 0.") {
    super(message)
    this.name = "TipoCambioInvalidoError"
  }
}

export type ValidacionTipoCambio = { ok: true; valor: number } | { ok: false; error: string }

/**
 * A rate must be a finite number greater than 0 with at most 6 decimals. Accepts numeric
 * strings because it validates request bodies and form fields.
 */
export function validarTipoCambio(valor: unknown): ValidacionTipoCambio {
  let n: number
  if (typeof valor === "number") {
    n = valor
  } else if (typeof valor === "string" && valor.trim() !== "") {
    n = Number(valor.trim())
  } else {
    return { ok: false, error: "El tipo de cambio debe ser un número mayor a 0." }
  }
  if (!Number.isFinite(n) || n <= 0) {
    return { ok: false, error: "El tipo de cambio debe ser un número mayor a 0." }
  }
  if (Number(n.toFixed(MAX_DECIMALES_TIPO_CAMBIO)) !== n) {
    return { ok: false, error: `El tipo de cambio admite hasta ${MAX_DECIMALES_TIPO_CAMBIO} decimales.` }
  }
  return { ok: true, valor: n }
}

/**
 * Rounds to the nearest multiple of `unidad`, half up. Without a unit (0 or invalid) it rounds
 * to cents, like every other amount in the app.
 */
export function roundUnit(valor: number, unidad: number): number {
  if (!Number.isFinite(unidad) || unidad <= 0) return round2(valor)
  // toFixed(6) absorbs binary noise so that 14350 / 100 = 143.5 rounds up, not down.
  const pasos = Math.round(Number((valor / unidad).toFixed(6)))
  return round2(pasos * unidad)
}

/** Foreign amount to local currency at `tipoCambio`, rounded to the conversion unit. */
export function convertirALocal(precioOrigen: number, tipoCambio: number, redondeoConversion = 0): number {
  const tc = validarTipoCambio(tipoCambio)
  if (!tc.ok) throw new TipoCambioInvalidoError(tc.error)
  return roundUnit(precioOrigen * tc.valor, redondeoConversion)
}

export interface LineaMultimoneda extends LineaVenta {
  /** null/undefined = local currency: `precioUnitario` is used as is. */
  moneda?: MonedaExtranjera | null
  /** Unit price in `moneda`. Authoritative when `moneda` is set; `precioUnitario` is ignored. */
  precioOrigen?: number | null
}

export interface LineaConvertida extends LineaVenta {
  /** Unit price in local currency (before surcharge). */
  precioUnitario: number
  moneda: MonedaExtranjera | null
  precioOrigen: number | null
  tipoCambio: number | null
}

export interface EntradaTotalesMultimoneda {
  lineas: LineaMultimoneda[]
  /** Required (valid) only when some line is in a foreign currency. */
  tipoCambio?: number | null
  /** Unit the converted prices are rounded to (organizacion_moneda.redondeo_conversion). */
  redondeoConversion?: number
  global?: DescuentoConfig | null
  fiscal?: FiscalConfig | null
  roundCash?: boolean
  /** Payment-method surcharge factor. */
  factor?: number
}

export interface ResultadoTotalesMultimoneda {
  totales: VentaTotales
  lineas: LineaConvertida[]
}

/**
 * Converts the foreign lines and computes the sale totals. Throws TipoCambioInvalidoError when a
 * foreign line has no valid rate; with no foreign line the rate is ignored altogether.
 */
export function calcularTotalesMultimoneda(entrada: EntradaTotalesMultimoneda): ResultadoTotalesMultimoneda {
  const lineas: LineaConvertida[] = entrada.lineas.map((l) => {
    const { moneda: m, precioOrigen: po, ...resto } = l
    if (!m) {
      return { ...resto, moneda: null, precioOrigen: null, tipoCambio: null }
    }
    const tc = validarTipoCambio(entrada.tipoCambio)
    if (!tc.ok) throw new TipoCambioInvalidoError(tc.error)
    const origen = po ?? 0
    return {
      ...resto,
      precioUnitario: convertirALocal(origen, tc.valor, entrada.redondeoConversion ?? 0),
      moneda: m,
      precioOrigen: origen,
      tipoCambio: tc.valor,
    }
  })

  const totales = calcularTotalesVenta(
    lineas,
    entrada.global ?? null,
    entrada.fiscal ?? null,
    entrada.roundCash ?? false,
    entrada.factor ?? 1
  )
  return { totales, lineas }
}
