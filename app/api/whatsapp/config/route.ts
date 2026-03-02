import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { isPremium } from "@/lib/subscriptions"
import { encrypt, decrypt } from "@/lib/whatsapp/encryption"
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
        isConfigured: false,
        isVerified: false,
        phoneNumberId: null,
        businessAccountId: null,
        webhookVerifyToken: null,
      })
    }

    return NextResponse.json({
      isConfigured: data.is_configured,
      isVerified: data.is_verified,
      phoneNumberId: data.phone_number_id,
      businessAccountId: data.business_account_id,
      webhookVerifyToken: data.webhook_verify_token,
      // Nunca enviar access_token al frontend
      hasAccessToken: !!data.access_token_encrypted,
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

    const premium = await isPremium(organizationId!)
    if (!premium) {
      return NextResponse.json({ error: "Requiere plan Premium", code: "PREMIUM_REQUIRED" }, { status: 403 })
    }

    const body = await request.json()
    const { phoneNumberId, businessAccountId, accessToken } = body

    if (!phoneNumberId || !accessToken) {
      return NextResponse.json(
        { error: "phoneNumberId y accessToken son requeridos" },
        { status: 400 }
      )
    }

    // Verificar credenciales con Meta
    const verification = await verifyCredentials(phoneNumberId, accessToken)

    // Encriptar access token
    const encryptedToken = encrypt(accessToken)

    const configData = {
      organization_id: organizationId!,
      phone_number_id: phoneNumberId,
      business_account_id: businessAccountId || null,
      access_token_encrypted: encryptedToken,
      is_configured: true,
      is_verified: verification.valid,
    }

    const { data, error: dbError } = await supabaseAdmin
      .from("whatsapp_config")
      .upsert(configData, { onConflict: "organization_id" })
      .select()
      .single()

    if (dbError) throw dbError

    return NextResponse.json({
      isConfigured: true,
      isVerified: verification.valid,
      phoneName: verification.phoneName,
      error: verification.valid ? null : verification.error,
    })
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
