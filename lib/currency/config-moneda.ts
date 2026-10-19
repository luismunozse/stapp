/**
 * Resolves the effective multi-currency settings of an organization from its
 * `organizacion_moneda` row (which may not exist yet) and its country. Pure.
 *
 * The table stores what the admin chose; this function applies the rules that depend on the
 * country and on the local currency, so every consumer (API, hook, POS) sees the same thing:
 *  - AR: every rate source is offered; with no row the suggestion is BLUE and the conversion
 *    rounding is 10. Any other country: only MANUAL, rounding 0.
 *  - A stored value is a choice and is kept as is (a stored rounding of 0 stays 0).
 *  - If the local currency is USD there is nothing to convert: the feature is off.
 *  - USD cash and USD change need the feature on.
 */

import { getCountryConfig } from "@/lib/countries"
import { CURRENCIES, DEFAULT_CURRENCY, type CurrencyCode } from "@/lib/currency"

export type FuenteTipoCambio = "MANUAL" | "OFICIAL" | "BLUE" | "MEP"
export type VueltoMoneda = "LOCAL" | "USD"

/** Columns of organizacion_moneda, all optional: the row may be missing or partial. */
export interface FilaOrganizacionMoneda {
  multimoneda_habilitada?: boolean | null
  tipo_cambio_fuente?: string | null
  tipo_cambio_manual?: number | null
  tipo_cambio_referencia?: number | null
  referencia_en?: string | null
  redondeo_conversion?: number | null
  acepta_usd_efectivo?: boolean | null
  vuelto_moneda_default?: string | null
}

export interface ConfigMoneda {
  monedaLocal: CurrencyCode
  /** Effective flag: false when the local currency is USD, whatever the row says. */
  habilitada: boolean
  fuentesDisponibles: FuenteTipoCambio[]
  fuente: FuenteTipoCambio
  tipoCambioManual: number | null
  tipoCambioReferencia: number | null
  referenciaEn: string | null
  redondeoConversion: number
  aceptaUsdEfectivo: boolean
  vueltoMonedaDefault: VueltoMoneda
}

const TODAS: FuenteTipoCambio[] = ["MANUAL", "OFICIAL", "BLUE", "MEP"]
const FUENTES = new Set<string>(TODAS)

function monedaLocalDe(pais: string | null | undefined, monedaLocal?: string | null): CurrencyCode {
  if (monedaLocal && Object.hasOwn(CURRENCIES, monedaLocal)) return monedaLocal as CurrencyCode
  return pais ? getCountryConfig(pais).defaultCurrency : DEFAULT_CURRENCY
}

export function resolverConfigMoneda(
  fila: FilaOrganizacionMoneda | null | undefined,
  pais: string | null | undefined,
  monedaLocal?: string | null
): ConfigMoneda {
  const local = monedaLocalDe(pais, monedaLocal)
  const esAR = pais === "AR"
  const fuentesDisponibles: FuenteTipoCambio[] = esAR ? [...TODAS] : ["MANUAL"]

  const guardada = fila?.tipo_cambio_fuente
  const fuente: FuenteTipoCambio =
    guardada && FUENTES.has(guardada) && fuentesDisponibles.includes(guardada as FuenteTipoCambio)
      ? (guardada as FuenteTipoCambio)
      : esAR
        ? "BLUE"
        : "MANUAL"

  const redondeoGuardado = fila?.redondeo_conversion
  const redondeoConversion =
    typeof redondeoGuardado === "number" && Number.isFinite(redondeoGuardado) && redondeoGuardado >= 0
      ? redondeoGuardado
      : esAR
        ? 10
        : CURRENCIES[local].decimals === 0
          ? 1
          : 0

  const habilitada = local !== "USD" && fila?.multimoneda_habilitada === true

  return {
    monedaLocal: local,
    habilitada,
    fuentesDisponibles,
    fuente,
    tipoCambioManual: fila?.tipo_cambio_manual ?? null,
    tipoCambioReferencia: fila?.tipo_cambio_referencia ?? null,
    referenciaEn: fila?.referencia_en ?? null,
    redondeoConversion,
    aceptaUsdEfectivo: habilitada && fila?.acepta_usd_efectivo === true,
    vueltoMonedaDefault: habilitada && fila?.vuelto_moneda_default === "USD" ? "USD" : "LOCAL",
  }
}
