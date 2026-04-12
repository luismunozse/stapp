import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { hasPlanFeature } from "@/lib/subscriptions"
import { decrypt } from "@/lib/whatsapp/encryption"
import { sendTextMessage } from "@/lib/whatsapp/client"

export async function POST(request: Request) {
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
    const { phoneNumber } = body

    if (!phoneNumber) {
      return NextResponse.json({ error: "phoneNumber es requerido" }, { status: 400 })
    }

    // Obtener configuración
    const { data: config } = await supabaseAdmin
      .from("whatsapp_config")
      .select("phone_number_id, access_token_encrypted, is_configured")
      .eq("organization_id", organizationId!)
      .single()

    if (!config || !config.is_configured) {
      return NextResponse.json({ error: "WhatsApp Business no configurado" }, { status: 400 })
    }

    const accessToken = decrypt(config.access_token_encrypted)

    const result = await sendTextMessage(
      config.phone_number_id,
      accessToken,
      phoneNumber,
      "¡Hola! Este es un mensaje de prueba de STApp. Si recibiste este mensaje, tu configuración de WhatsApp Business está funcionando correctamente. ✅"
    )

    if (result.success) {
      return NextResponse.json({
        success: true,
        messageId: result.messageId,
        message: "Mensaje de prueba enviado exitosamente",
      })
    } else {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      )
    }
  } catch (err) {
    console.error("Error sending test message:", err)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
