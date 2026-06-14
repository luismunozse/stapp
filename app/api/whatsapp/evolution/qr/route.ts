import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { hasPlanFeature } from "@/lib/subscriptions"
import { getPlatformEvolutionConfig, buildInstanceName } from "@/lib/whatsapp/platform-config"
import { connectInstance, getConnectionState } from "@/lib/whatsapp/providers/evolution"

async function resolveCreds(organizationId: string) {
  const platform = getPlatformEvolutionConfig()
  if (!platform) return null
  return { baseUrl: platform.baseUrl, instanceName: buildInstanceName(organizationId), apiKey: platform.apiKey }
}

async function persistState(organizationId: string, state: string, qr?: boolean) {
  await supabaseAdmin
    .from("whatsapp_config")
    .update({
      evolution_connection_state: state,
      ...(qr ? { evolution_last_qr_at: new Date().toISOString() } : {}),
      is_verified: state === "open",
    })
    .eq("organization_id", organizationId)

  if (state === "open") {
    await supabaseAdmin
      .from("organizations")
      .update({ notificaciones_whatsapp: true })
      .eq("id", organizationId)
  }
}

/** POST: pide QR / pairing code. */
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

    const creds = await resolveCreds(organizationId!)
    if (!creds) {
      return NextResponse.json({ error: "WhatsApp no disponible (plataforma)", code: "PLATFORM_UNCONFIGURED" }, { status: 503 })
    }

    const result = await connectInstance(creds)
    await persistState(organizationId!, result.state, !!result.qrBase64)

    return NextResponse.json({
      state: result.state,
      qrBase64: result.qrBase64 || null,
      pairingCode: result.pairingCode || null,
      error: result.error || null,
    })
  } catch (err) {
    console.error("Error fetching Evolution QR:", err)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}

/** GET: poll de estado. Activa notificaciones al quedar open. */
export async function GET() {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const creds = await resolveCreds(organizationId!)
    if (!creds) {
      return NextResponse.json({ error: "WhatsApp no disponible (plataforma)", code: "PLATFORM_UNCONFIGURED" }, { status: 503 })
    }

    const state = await getConnectionState(creds)
    await persistState(organizationId!, state.state)

    return NextResponse.json({ state: state.state, error: state.error || null })
  } catch (err) {
    console.error("Error polling Evolution state:", err)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
