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
import { CURRENCIES, type CurrencyCode } from "@/lib/currency"

export type MonedaExtranjera = "USD"

/** Rates are stored with up to this many decimals (the column is NUMERIC(14,6)). */
export const MAX_DECIMALES_TIPO_CAMBIO = 6

export class TipoCambioInvalidoError extends Error {
  constructor(message = "El tipo de cambio debe ser un número mayor a 0.") {
    super(message)
    this.name = "TipoCambioInvalidoError"
  }
}

export class PrecioOrigenInvalidoError extends Error {
  constructor(message = "El precio en moneda de origen debe ser un número mayor o igual a 0.") {
    super(message)
    this.name = "PrecioOrigenInvalidoError"
  }
}

/** NUMERIC(14,6) holds 8 integer digits: anything from 1e8 up overflows the column. */
export const MAX_TIPO_CAMBIO = 1e8

/** Plain decimal notation only: no exponent, hex, binary or separators. */
const DECIMAL_PLANO = /^(\d+(\.\d+)?|\.\d+)$/

export type ValidacionTipoCambio = { ok: true; valor: number } | { ok: false; error: string }

/**
 * A rate must be a finite number greater than 0 with at most 6 decimals. Accepts numeric
 * strings because it validates request bodies and form fields.
 */
export function validarTipoCambio(valor: unknown): ValidacionTipoCambio {
  let n: number
  if (typeof valor === "number") {
    n = valor
  } else if (typeof valor === "string" && DECIMAL_PLANO.test(valor.trim())) {
    n = Number(valor.trim())
  } else {
    return { ok: false, error: "El tipo de cambio debe ser un número mayor a 0." }
  }
  if (!Number.isFinite(n) || n <= 0) {
    return { ok: false, error: "El tipo de cambio debe ser un número mayor a 0." }
  }
  if (n >= MAX_TIPO_CAMBIO) {
    return { ok: false, error: "El tipo de cambio es demasiado grande." }
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

/**
 * Effective rounding unit: the explicit one if positive; otherwise 1 for a 0-decimal local
 * currency (rounding CLP to cents would invent fractions of a peso), else 0 (cents).
 */
export function unidadRedondeo(redondeoConversion: number | undefined, monedaLocal?: string | null): number {
  if (typeof redondeoConversion === "number" && Number.isFinite(redondeoConversion) && redondeoConversion > 0) {
    return redondeoConversion
  }
  return decimalesDe(monedaLocal) === 0 ? 1 : 0
}

/** Decimals of a currency code; unknown or missing codes count as 2. */
export function decimalesDe(codigo: string | null | undefined): number {
  if (codigo && Object.hasOwn(CURRENCIES, codigo)) return CURRENCIES[codigo as CurrencyCode].decimals
  return 2
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
  /**
   * Unit the converted prices are rounded to (organizacion_moneda.redondeo_conversion). 0 or
   * missing means "no explicit unit": the smallest unit of the local currency (1 for a
   * 0-decimal currency such as CLP, cents otherwise).
   */
  redondeoConversion?: number
  /**
   * The organization's local currency. A line whose `moneda` equals it (or is null) is already
   * local and is never converted. Without it, any line with a `moneda` is converted.
   */
  monedaLocal?: string | null
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
  const unidad = unidadRedondeo(entrada.redondeoConversion, entrada.monedaLocal)
  const lineas: LineaConvertida[] = entrada.lineas.map((l) => {
    const { moneda: m, precioOrigen: po, ...resto } = l
    if (!m || m === entrada.monedaLocal) {
      return { ...resto, moneda: null, precioOrigen: null, tipoCambio: null }
    }
    const tc = validarTipoCambio(entrada.tipoCambio)
    if (!tc.ok) throw new TipoCambioInvalidoError(tc.error)
    if (typeof po !== "number" || !Number.isFinite(po) || po < 0) throw new PrecioOrigenInvalidoError()
    const origen = po
    return {
      ...resto,
      precioUnitario: convertirALocal(origen, tc.valor, unidad),
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
