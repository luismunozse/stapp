import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { hasPlanFeature } from "@/lib/subscriptions"
import { decrypt } from "@/lib/whatsapp/encryption"
import { connectInstance, getConnectionState } from "@/lib/whatsapp/providers/evolution"

/**
 * Pide QR / pairing code a Evolution para vincular el numero.
 * Devuelve base64 PNG y/o pairingCode segun configuracion del server.
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

    const { data: config } = await supabaseAdmin
      .from("whatsapp_config")
      .select("provider, evolution_base_url, evolution_instance_name, evolution_api_key_encrypted")
      .eq("organization_id", organizationId!)
      .single()

    if (!config || config.provider !== "evolution") {
      return NextResponse.json({ error: "Provider Evolution no configurado" }, { status: 400 })
    }
    if (!config.evolution_base_url || !config.evolution_instance_name || !config.evolution_api_key_encrypted) {
      return NextResponse.json({ error: "Credenciales Evolution incompletas" }, { status: 400 })
    }

    const creds = {
      baseUrl: config.evolution_base_url,
      instanceName: config.evolution_instance_name,
      apiKey: decrypt(config.evolution_api_key_encrypted),
    }

    const result = await connectInstance(creds)

    // Persistir estado
    await supabaseAdmin
      .from("whatsapp_config")
      .update({
        evolution_connection_state: result.state,
        evolution_last_qr_at: result.qrBase64 ? new Date().toISOString() : undefined,
        is_verified: result.state === "open",
      })
      .eq("organization_id", organizationId!)

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

/**
 * GET: solo poll de estado (sin pedir QR nuevo).
 */
export async function GET() {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { data: config } = await supabaseAdmin
      .from("whatsapp_config")
      .select("provider, evolution_base_url, evolution_instance_name, evolution_api_key_encrypted")
      .eq("organization_id", organizationId!)
      .single()

    if (!config || config.provider !== "evolution") {
      return NextResponse.json({ error: "Provider Evolution no configurado" }, { status: 400 })
    }
    if (!config.evolution_base_url || !config.evolution_instance_name || !config.evolution_api_key_encrypted) {
      return NextResponse.json({ error: "Credenciales Evolution incompletas" }, { status: 400 })
    }

    const creds = {
      baseUrl: config.evolution_base_url,
      instanceName: config.evolution_instance_name,
      apiKey: decrypt(config.evolution_api_key_encrypted),
    }

    const state = await getConnectionState(creds)

    await supabaseAdmin
      .from("whatsapp_config")
      .update({
        evolution_connection_state: state.state,
        is_verified: state.state === "open",
      })
      .eq("organization_id", organizationId!)

    return NextResponse.json({ state: state.state, error: state.error || null })
  } catch (err) {
    console.error("Error polling Evolution state:", err)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
