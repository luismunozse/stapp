/**
 * dolarapi.com client for market exchange rates. Never throws: any failure or invalid
 * value yields null (and is not cached). Successful quotes are cached 5 minutes in memory.
 */
import type { FuenteTipoCambio } from "./config-moneda"
import { validarTipoCambio, type MonedaExtranjera } from "./convert"
import type { CotizacionMercado } from "./tipo-cambio"

const BASE = "https://dolarapi.com/v1"
const TTL_MS = 5 * 60_000
const TIMEOUT_MS = 4000

type FuenteMercado = Exclude<FuenteTipoCambio, "MANUAL">

const cache = new Map<string, { at: number; cotizacion: CotizacionMercado }>()

/** Test-only: empties the in-memory cache. */
export function __resetCacheCotizaciones(): void {
  cache.clear()
}

function urlPara(moneda: MonedaExtranjera, fuente: FuenteMercado): string | null {
  if (moneda === "EUR") return fuente === "OFICIAL" ? `${BASE}/cotizaciones/eur` : null
  const casa = { OFICIAL: "oficial", BLUE: "blue", MEP: "bolsa" }[fuente]
  return casa ? `${BASE}/dolares/${casa}` : null
}

export async function obtenerCotizacionMercado(
  moneda: MonedaExtranjera,
  fuente: FuenteMercado
): Promise<CotizacionMercado | null> {
  const url = urlPara(moneda, fuente)
  if (!url) return null
  const clave = `${moneda}:${fuente}`
  const hit = cache.get(clave)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.cotizacion

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) return null
    const data = await res.json()
    const venta = data?.venta
    if (typeof venta !== "number" || !Number.isFinite(venta)) return null
    const v = validarTipoCambio(Number(venta.toFixed(6)))
    if (!v.ok) return null
    const en =
      typeof data.fechaActualizacion === "string" && !Number.isNaN(Date.parse(data.fechaActualizacion))
        ? data.fechaActualizacion
        : new Date().toISOString()
    const cotizacion = { valor: v.valor, en }
    cache.set(clave, { at: Date.now(), cotizacion })
    return cotizacion
  } catch {
    return null
  }
}
