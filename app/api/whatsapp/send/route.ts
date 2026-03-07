import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { isPremium } from "@/lib/subscriptions"
import { decrypt } from "@/lib/whatsapp/encryption"
import { sendTextMessage } from "@/lib/whatsapp/client"
import { z } from "zod"

const sendSchema = z.object({
  phoneNumber: z.string().min(1, "phoneNumber es requerido"),
  message: z.string().min(1, "message es requerido").max(4096, "Mensaje demasiado largo"),
})

export async function POST(request: Request) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const premium = await isPremium(organizationId!)
    if (!premium) {
      return NextResponse.json({ error: "Requiere plan Premium", code: "PREMIUM_REQUIRED" }, { status: 403 })
    }

    const body = await request.json()
    const data = sendSchema.parse(body)

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
      data.phoneNumber,
      data.message
    )

    if (result.success) {
      return NextResponse.json({
        success: true,
        messageId: result.messageId,
      })
    } else {
      return NextResponse.json(
        { success: false, error: result.error },
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
