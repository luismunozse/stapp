import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { hasPlanFeature } from "@/lib/subscriptions"
import { sendWhatsAppText } from "@/lib/whatsapp/providers"
import { z } from "zod"

const sendSchema = z.object({
  phoneNumber: z.string().min(1, "phoneNumber es requerido"),
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
