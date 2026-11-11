import { supabaseAdmin } from "@/lib/supabase"
import { tipoEmisionDeFila } from "@/lib/facturacion/derive"
import type { TipoComprobante } from "@/lib/facturacion/types"

/**
 * Letra (B o C) con la que la org emitiría hoy, para mostrarla antes de emitir.
 * Solo lee `condicion_fiscal`: ni secretos ni el resto de la configuración
 * fiscal salen de acá. `null` si no hay credenciales o no se pudo leer.
 */
export async function tipoEmisionOrganizacion(organizationId: string): Promise<TipoComprobante | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from("facturacion_credenciales")
      .select("condicion_fiscal")
      .eq("organization_id", organizationId)
      .maybeSingle()
    if (error || !data) return null
    return tipoEmisionDeFila(data as { condicion_fiscal?: string | null })
  } catch {
    return null
  }
}
