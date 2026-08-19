import { hasPlanFeature } from "@/lib/subscriptions"
import { supabaseAdmin } from "@/lib/supabase"
import { isMissingColumnError } from "@/lib/db-errors"

export async function canEmitirFacturaElectronica(organizationId: string): Promise<boolean> {
  try {
    if (!(await hasPlanFeature(organizationId, "facturacion_electronica"))) return false
    const { data: org } = await supabaseAdmin
      .from("organizations")
      .select("pais, facturacion_electronica_habilitada")
      .eq("id", organizationId)
      .single()
    if (!org || org.pais !== "AR" || org.facturacion_electronica_habilitada !== true) return false

    let result = await supabaseAdmin
      .from("facturacion_credenciales")
      .select("organization_id, provider, cert_not_after")
      .eq("organization_id", organizationId)
      .maybeSingle()

    if (isMissingColumnError(result.error)) {
      // Migración 299 (provider/cert_not_after) no aplicada todavía: degradar
      // al chequeo previo (solo existencia de la fila), sin el gate de
      // certificado vencido — tier A (design ADR-13).
      result = await supabaseAdmin
        .from("facturacion_credenciales")
        .select("organization_id")
        .eq("organization_id", organizationId)
        .maybeSingle()
    }

    const cred = result.data as { organization_id: string; provider?: string; cert_not_after?: string | null } | null
    if (!cred) return false

    // cert_vencido bloquea en el gate (design, resolved open question #4):
    // intentarlo igual solo cuesta un round-trip WSAA para un SOAP fault
    // críptico frente al cliente.
    if (cred.provider === "arca" && cred.cert_not_after) {
      if (new Date(cred.cert_not_after).getTime() <= Date.now()) return false
    }

    return true
  } catch {
    return false // fail closed
  }
}
