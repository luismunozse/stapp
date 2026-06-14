import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { hasPlanFeature } from "@/lib/subscriptions"
import { encrypt } from "@/lib/whatsapp/encryption"
import { verifyCredentials } from "@/lib/whatsapp/client"

export async function GET() {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { data } = await supabaseAdmin
      .from("whatsapp_config")
      .select("*")
      .eq("organization_id", organizationId!)
      .single()

    if (!data) {
      return NextResponse.json({
        provider: "meta",
        isConfigured: false,
        isVerified: false,
        phoneNumberId: null,
        businessAccountId: null,
        webhookVerifyToken: null,
        evolution: {
          baseUrl: null,
          instanceName: null,
          connectionState: null,
          hasApiKey: false,
        },
      })
    }

    return NextResponse.json({
      provider: data.provider || "meta",
      isConfigured: data.is_configured,
      isVerified: data.is_verified,
      phoneNumberId: data.phone_number_id,
      businessAccountId: data.business_account_id,
      webhookVerifyToken: data.webhook_verify_token,
      hasAccessToken: !!data.access_token_encrypted,
      evolution: {
        baseUrl: data.evolution_base_url,
        instanceName: data.evolution_instance_name,
        connectionState: data.evolution_connection_state,
        hasApiKey: !!data.evolution_api_key_encrypted,
        lastQrAt: data.evolution_last_qr_at,
      },
    })
  } catch (err) {
    console.error("Error fetching WA config:", err)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const hasFeature = await hasPlanFeature(organizationId!, "whatsapp_notifications")
    if (!hasFeature) {
      return NextResponse.json(
        { error: "Las notificaciones por WhatsApp requieren el plan Profesional", code: "FEATURE_REQUIRED", feature: "whatsapp_notifications" },
        { status: 403 }
      )
    }

    const body = await request.json()
    const provider: "meta" | "evolution" = body.provider === "evolution" ? "evolution" : "meta"

    if (provider === "meta") {
      const { phoneNumberId, businessAccountId, accessToken } = body

      if (!phoneNumberId || !accessToken) {
        return NextResponse.json(
          { error: "phoneNumberId y accessToken son requeridos" },
          { status: 400 }
        )
      }

      const verification = await verifyCredentials(phoneNumberId, accessToken)
      const encryptedToken = encrypt(accessToken)

      const configData = {
        organization_id: organizationId!,
        provider: "meta",
        phone_number_id: phoneNumberId,
        business_account_id: businessAccountId || null,
        access_token_encrypted: encryptedToken,
        is_configured: true,
        is_verified: verification.valid,
      }

      const { error: dbError } = await supabaseAdmin
        .from("whatsapp_config")
        .upsert(configData, { onConflict: "organization_id" })

      if (dbError) throw dbError

      return NextResponse.json({
        provider: "meta",
        isConfigured: true,
        isVerified: verification.valid,
        phoneName: verification.phoneName,
        error: verification.valid ? null : verification.error,
      })
    }

    // Evolution: el alta se hace ahora vía POST /api/whatsapp/evolution/connect
    // (servidor compartido de plataforma, sin credenciales por org).
    if (provider === "evolution") {
      return NextResponse.json(
        { error: "Usá Conectar WhatsApp (Evolution compartido). Esta ruta quedó obsoleta para Evolution.", code: "USE_CONNECT" },
        { status: 410 }
      )
    }
  } catch (err) {
    console.error("Error updating WA config:", err)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}

export async function DELETE() {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    await supabaseAdmin
      .from("whatsapp_config")
      .delete()
      .eq("organization_id", organizationId!)

    return NextResponse.json({ message: "Configuración eliminada" })
  } catch (err) {
    console.error("Error deleting WA config:", err)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
