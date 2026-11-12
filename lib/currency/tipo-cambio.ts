/**
 * Pure decision of which exchange rate applies to an organization right now.
 * No I/O: the live quote and the clock are passed in.
 */
import type { ConfigMoneda, FuenteTipoCambio } from "./config-moneda"
import type { MonedaExtranjera } from "./convert"

/** Max age of the stored reference rate when the live source is down. */
export const REFERENCIA_MAX_HORAS = 24

export type CotizacionMercado = { valor: number; en: string }

export type ResultadoTipoCambio =
  | {
      disponible: true
      valor: number
      fuente: FuenteTipoCambio
      moneda: MonedaExtranjera
      en: string
      estado: "vivo" | "referencia"
    }
  | { disponible: false; motivo: "DESHABILITADA" | "SIN_COTIZACION" }

export function decidirTipoCambio(
  config: ConfigMoneda,
  vivo: CotizacionMercado | null,
  ahora: Date,
  manualEn?: string | null
): ResultadoTipoCambio {
  if (!config.habilitada) return { disponible: false, motivo: "DESHABILITADA" }
  const base = { fuente: config.fuente, moneda: config.monedaExtranjera }

  if (config.fuente === "MANUAL") {
    if (config.tipoCambioManual == null) return { disponible: false, motivo: "SIN_COTIZACION" }
    return {
      disponible: true,
      ...base,
      valor: config.tipoCambioManual,
      en: manualEn ?? ahora.toISOString(),
      estado: "vivo",
    }
  }

  if (vivo) return { disponible: true, ...base, valor: vivo.valor, en: vivo.en, estado: "vivo" }

  if (config.tipoCambioReferencia != null && config.referenciaEn) {
    const edadMs = ahora.getTime() - new Date(config.referenciaEn).getTime()
    if (Number.isFinite(edadMs) && edadMs <= REFERENCIA_MAX_HORAS * 3_600_000) {
      return {
        disponible: true,
        ...base,
        valor: config.tipoCambioReferencia,
        en: config.referenciaEn,
        estado: "referencia",
      }
    }
  }
  return { disponible: false, motivo: "SIN_COTIZACION" }
}
