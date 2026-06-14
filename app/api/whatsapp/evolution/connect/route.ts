import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { hasPlanFeature } from "@/lib/subscriptions"
import { getPlatformEvolutionConfig, buildInstanceName } from "@/lib/whatsapp/platform-config"
import { createInstance, connectInstance } from "@/lib/whatsapp/providers/evolution"

/**
 * Conecta WhatsApp de la org contra el servidor Evolution COMPARTIDO de plataforma.
 * Sin entrada del tenant: baseUrl/apiKey vienen del env, instanceName es autogenerado.
 * Crea la instancia (idempotente), pide el QR y persiste el estado.
 */
export async function POST() {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const hasFeature = await hasPlanFeature(organizationId!, "whatsapp_notifications")
    if (!hasFeature) {
      return NextResponse.json(
        { error: "Requiere plan Profesional", code: "FEATURE_REQUIRED", feature: "whatsapp_notifications" },
        { status: 403 }
      )
    }

    const platform = getPlatformEvolutionConfig()
    if (!platform) {
      return NextResponse.json(
        { error: "WhatsApp no disponible (configuración de plataforma incompleta)", code: "PLATFORM_UNCONFIGURED" },
        { status: 503 }
      )
    }

    const instanceName = buildInstanceName(organizationId!)
    const creds = { baseUrl: platform.baseUrl, instanceName, apiKey: platform.apiKey }

    const created = await createInstance(creds)
    if (!created.success) {
      return NextResponse.json({ error: `No se pudo crear instancia: ${created.error}` }, { status: 502 })
    }

    const result = await connectInstance(creds)

    await supabaseAdmin
      .from("whatsapp_config")
      .upsert(
        {
          organization_id: organizationId!,
          provider: "evolution",
          evolution_instance_name: instanceName,
          evolution_connection_state: result.state,
          evolution_last_qr_at: result.qrBase64 ? new Date().toISOString() : undefined,
          is_configured: true,
          is_verified: result.state === "open",
        },
        { onConflict: "organization_id" }
      )

    return NextResponse.json({
      state: result.state,
      qrBase64: result.qrBase64 || null,
      pairingCode: result.pairingCode || null,
      error: result.error || null,
    })
  } catch (err) {
    console.error("Error connect Evolution:", err)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
