import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { hasPlanFeature } from "@/lib/subscriptions"
import { sendWhatsAppText } from "@/lib/whatsapp/providers"
import { persistentRateLimit } from "@/lib/rate-limit"
import { z } from "zod"

// E.164-ish: optional leading +, 8–15 digits, spaces/dashes stripped before validation
const PHONE_REGEX = /^\+?\d{8,15}$/

const sendSchema = z.object({
  phoneNumber: z
    .string()
    .min(1, "phoneNumber es requerido")
    .transform((v) => v.replace(/[\s\-]/g, ""))
    .refine((v) => PHONE_REGEX.test(v), "phoneNumber debe tener formato E.164 (8–15 dígitos, + opcional)"),
  message: z.string().min(1, "message es requerido").max(4096, "Mensaje demasiado largo"),
})

export async function POST(request: Request) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const hasFeature = await hasPlanFeature(organizationId!, "whatsapp_notifications")
    if (!hasFeature) {
      return NextResponse.json(
        { error: "Las notificaciones por WhatsApp requieren el plan Profesional", code: "FEATURE_REQUIRED", feature: "whatsapp_notifications" },
        { status: 403 }
      )
    }

    const rl = await persistentRateLimit(organizationId!, "whatsapp:send", 100, 3600)
    if (!rl.success) {
      return NextResponse.json(
        { error: "Límite de envíos alcanzado. Máximo 100 mensajes por hora por organización.", code: "RATE_LIMITED" },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil((rl.reset - Date.now()) / 1000)) },
        }
      )
    }

    const body = await request.json()
    const data = sendSchema.parse(body)

    const result = await sendWhatsAppText(organizationId!, data.phoneNumber, data.message)

    if (result.success) {
      return NextResponse.json({
        success: true,
        messageId: result.messageId,
        provider: result.provider,
      })
    } else {
      return NextResponse.json(
        { success: false, error: result.error, provider: result.provider },
        { status: 400 }
      )
    }
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error sending WhatsApp message:", err)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
