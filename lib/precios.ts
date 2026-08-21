// Núcleo puro de precio mayorista por cliente.
//
// Sin React, sin Supabase, sin dependencia de lib/lote-utils.ts (ese módulo
// no existe todavía en main — ver design ADR-6: acoplar esta PR a un módulo
// que vive en una branch sin mergear la dejaría indeployable). `round2` se
// declara acá y `lote-utils` lo va a reexportar cuando esa branch mergee.

export const round2 = (n: number): number => Math.round(n * 100) / 100

export type TipoPrecio = "MINORISTA" | "MAYORISTA"

export interface ClientePricing {
  tipoPrecio?: string | null
  descuentoPct?: number | null
}

/**
 * % efectivo del cliente para sugerir precio. 0 salvo MAYORISTA con un %
 * válido en (0, 100]. Nunca lanza, acepta cliente null/undefined.
 */
export function descuentoClientePct(c: ClientePricing | null | undefined): number {
  if (!c || c.tipoPrecio !== "MAYORISTA") return 0
  const pct = c.descuentoPct
  if (pct == null || !isFinite(pct) || pct <= 0 || pct > 100) return 0
  return pct
}

/** Neto sugerido: round2(lista * (1 - pct/100)). NaN si lista no es finito. */
export function aplicarDescuento(precioLista: number, pct: number): number {
  if (!isFinite(precioLista)) return NaN
  return round2(precioLista * (1 - pct / 100))
}

/** Composición multiplicativa de dos %, NO suma: componerDescuentos(15,10) === 23.5 */
export function componerDescuentos(a: number, b: number): number {
  return round2((1 - (1 - a / 100) * (1 - b / 100)) * 100)
}

/**
 * % efectivo real derivado de dinero (no de porcentajes almacenados). Usado
 * por el guard de composición del lote — ver design ADR-4.
 */
export function pctEfectivo(subtotalLista: number, total: number): number {
  if (!isFinite(subtotalLista) || subtotalLista <= 0) return 0
  return round2((1 - total / subtotalLista) * 100)
}

/**
 * Regla de prefill del presupuesto en los formularios de alta. Una vez que
 * el operador tocó el campo (`tocado`), la sugerencia deja de pisar lo que
 * escribió — el override siempre gana (REQ-8).
 */
export function sugerirPresupuesto(input: {
  precioLista: number | undefined
  pct: number
  tocado: boolean
  actual: number | undefined
}): number | undefined {
  const { precioLista, pct, tocado, actual } = input
  if (tocado) return actual
  if (precioLista == null || !isFinite(precioLista)) return undefined
  return aplicarDescuento(precioLista, pct)
}
