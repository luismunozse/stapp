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
      // Migración 299 (provider) no aplicada todavía: degradar al chequeo
      // previo (solo existencia de la fila) — tier A (design ADR-13). Toda
      // fila en ese esquema es implícitamente 'tusfacturas': 'arca' no
      // existía como proveedor antes de esta migración.
      result = await supabaseAdmin
        .from("facturacion_credenciales")
        .select("organization_id")
        .eq("organization_id", organizationId)
        .maybeSingle()
      return !!result.data
    }

    const cred = result.data as {
      organization_id: string
      provider?: string | null
      cert_not_after?: string | null
    } | null
    if (!cred) return false

    // El proveedor ARCA directo ya emite (Fase 4, ArcaDirectProvider). Lo
    // que queda es el gate del certificado: `estado` puede haber quedado en
    // 'conectado' desde el ultimo guardado mientras el certificado vencia,
    // asi que la vigencia se deriva en lectura. Sin `cert_not_after` no se
    // puede afirmar nada -> fail closed.
    if (cred.provider === "arca") {
      if (!cred.cert_not_after) return false
      return new Date(cred.cert_not_after).getTime() > Date.now()
    }

    return cred.provider === "tusfacturas"
  } catch {
    return false // fail closed
  }
}
