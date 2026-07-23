import { hasPlanFeature } from "@/lib/subscriptions"
import { supabaseAdmin } from "@/lib/supabase"

export async function canEmitirFacturaElectronica(organizationId: string): Promise<boolean> {
  try {
    if (!(await hasPlanFeature(organizationId, "facturacion_electronica"))) return false
    const { data: org } = await supabaseAdmin
      .from("organizations")
      .select("pais, facturacion_electronica_habilitada")
      .eq("id", organizationId)
      .single()
    if (!org || org.pais !== "AR" || org.facturacion_electronica_habilitada !== true) return false
    const { data: cred } = await supabaseAdmin
      .from("facturacion_credenciales")
      .select("organization_id")
      .eq("organization_id", organizationId)
      .maybeSingle()
    return !!cred
  } catch {
    return false // fail closed
  }
}
