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
      .select("organization_id, provider")
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

    const cred = result.data as { organization_id: string; provider?: string | null } | null
    if (!cred) return false

    // P1a (review PR2, engram #1125): emisión implementada SOLO para
    // 'tusfacturas' hasta que la Fase 4 conecte ArcaDirectProvider. Una fila
    // 'arca' tiene las columnas legacy de token en NULL (migración 299 las
    // hizo nullable justamente para esto) — si esta función devolviera true,
    // emitir/route.ts llegaría a decryptSecret(cred.apitoken_enc) con
    // apitoken_enc=null y explotaría con un TypeError sin manejar. El gate
    // de certificado vencido queda sin efecto mientras tanto (no hay nada
    // que emitir con él todavía); se reintroduce cuando Fase 4 habilite
    // 'arca' acá.
    return cred.provider === "tusfacturas"
  } catch {
    return false // fail closed
  }
}
