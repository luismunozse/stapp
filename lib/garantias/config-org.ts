import { supabaseAdmin } from "@/lib/supabase"
import { CONFIG_GARANTIAS_DEFAULT, configGarantiasDeFila, type ConfigGarantiasOrg } from "./config"

/**
 * Configuración de garantías de una org (migración 402), acotada por
 * organization_id. select("*") a propósito: si la 402 todavía no corrió, las
 * columnas faltan y se usan los defaults en vez de tirar la consulta. Una
 * falla nunca tumba al que la pide (un PDF, la lista, el seguimiento).
 */
export async function leerConfigGarantias(organizationId: string): Promise<ConfigGarantiasOrg> {
  try {
    const { data, error } = await supabaseAdmin
      .from("organizations")
      .select("*")
      .eq("id", organizationId)
      .maybeSingle()
    if (error || !data) return { ...CONFIG_GARANTIAS_DEFAULT }
    return configGarantiasDeFila(data as Record<string, unknown>)
  } catch {
    return { ...CONFIG_GARANTIAS_DEFAULT }
  }
}
