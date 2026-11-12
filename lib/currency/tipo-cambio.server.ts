/**
 * Server-side resolver of the exchange rate that applies to an organization: loads its
 * multi-currency settings, asks the market when needed and decides with the pure function.
 */
import { supabaseAdmin } from "@/lib/supabase"
import { resolverConfigMoneda, type ConfigMoneda, type FilaOrganizacionMoneda } from "./config-moneda"
import { obtenerCotizacionMercado } from "./dolarapi.server"
import { decidirTipoCambio, type ResultadoTipoCambio } from "./tipo-cambio"

type FilaConFechas = FilaOrganizacionMoneda & { updated_at?: string | null }

/** Max age of the stored reference before it is refreshed from a live quote. */
const REFERENCIA_REFRESCO_MS = 5 * 60_000

/** Postgres: undefined_table / undefined_column (migration not applied yet). */
const ERRORES_MIGRACION_PENDIENTE = new Set(["42P01", "42703"])

export async function cargarConfigMoneda(
  organizationId: string
): Promise<{ config: ConfigMoneda; fila: FilaConFechas | null }> {
  const { data: org, error: orgError } = await supabaseAdmin
    .from("organizations")
    .select("pais, moneda")
    .eq("id", organizationId)
    .single()
  // PGRST116 = no row: tolerated (defaults). Anything else could silently mis-resolve the country.
  if (orgError && orgError.code !== "PGRST116") {
    throw new Error(`organizations: ${orgError.message}`)
  }

  const { data, error } = await supabaseAdmin
    .from("organizacion_moneda")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle()

  if (error && !ERRORES_MIGRACION_PENDIENTE.has(error.code)) {
    throw new Error(`organizacion_moneda: ${error.message}`)
  }
  const fila: FilaConFechas | null = error ? null : ((data as FilaConFechas | null) ?? null)
  return { config: resolverConfigMoneda(fila, org?.pais, org?.moneda), fila }
}

export async function resolverTipoCambio(
  organizationId: string,
  ahora: Date = new Date()
): Promise<ResultadoTipoCambio> {
  const { config, fila } = await cargarConfigMoneda(organizationId)

  const deMercado = config.habilitada && config.fuente !== "MANUAL"
  const vivo = deMercado
    ? await obtenerCotizacionMercado(
        config.monedaExtranjera,
        config.fuente as Exclude<ConfigMoneda["fuente"], "MANUAL">
      )
    : null

  const resultado = decidirTipoCambio(config, vivo, ahora, fila?.updated_at)

  if (vivo && resultado.disponible && resultado.estado === "vivo") {
    const refEn = fila?.referencia_en ? new Date(fila.referencia_en).getTime() : NaN
    const vieja = !Number.isFinite(refEn) || ahora.getTime() - refEn > REFERENCIA_REFRESCO_MS
    if (vivo.valor !== fila?.tipo_cambio_referencia || vieja) {
      try {
        const { error } = await supabaseAdmin
          .from("organizacion_moneda")
          .update({ tipo_cambio_referencia: vivo.valor, referencia_en: ahora.toISOString() })
          .eq("organization_id", organizationId)
        if (error) console.error("[tipo-cambio] no se pudo guardar la referencia:", error.message)
      } catch (e) {
        console.error("[tipo-cambio] no se pudo guardar la referencia:", e)
      }
    }
  }
  return resultado
}
