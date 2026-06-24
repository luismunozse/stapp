import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { hasPlanFeature } from "@/lib/subscriptions"
import { sendWhatsAppText } from "@/lib/whatsapp/providers"
import { persistentRateLimit } from "@/lib/rate-limit"

// E.164-ish: optional leading +, 8–15 digits, spaces/dashes stripped before validation
const PHONE_REGEX = /^\+?\d{8,15}$/

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

    const rl = await persistentRateLimit(organizationId!, "whatsapp:test", 20, 3600)
    if (!rl.success) {
      return NextResponse.json(
        { error: "Límite de mensajes de prueba alcanzado. Máximo 20 por hora por organización.", code: "RATE_LIMITED" },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil((rl.reset - Date.now()) / 1000)) },
        }
      )
    }

    const body = await request.json()
    const { phoneNumber } = body

    if (!phoneNumber) {
      return NextResponse.json({ error: "phoneNumber es requerido" }, { status: 400 })
    }

    const normalizedPhone = String(phoneNumber).replace(/[\s\-]/g, "")
    if (!PHONE_REGEX.test(normalizedPhone)) {
      return NextResponse.json(
        { error: "phoneNumber debe tener formato E.164 (8–15 dígitos, + opcional)" },
        { status: 400 }
      )
    }

    const result = await sendWhatsAppText(
      organizationId!,
      normalizedPhone,
      "¡Hola! Este es un mensaje de prueba de STApp. Si recibiste este mensaje, tu configuración de WhatsApp está funcionando correctamente. ✅"
    )

    if (result.success) {
      return NextResponse.json({
        success: true,
        messageId: result.messageId,
        provider: result.provider,
        message: "Mensaje de prueba enviado exitosamente",
      })
    } else {
      return NextResponse.json(
        { success: false, error: result.error, provider: result.provider },
        { status: 400 }
      )
    }
  } catch (err) {
    console.error("Error sending test message:", err)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
