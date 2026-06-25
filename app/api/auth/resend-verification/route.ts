import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import crypto from "crypto"
import { sendVerificationEmail } from "@/lib/email"
import { persistentRateLimit } from "@/lib/rate-limit"

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json()

    if (!email) {
      return NextResponse.json(
        { error: "Email requerido" },
        { status: 400 }
      )
    }

    // Rate limit per target email: 3 requests per hour.
    // Keyed by email (not IP) to protect the victim's inbox regardless of
    // the attacker's IP, and to prevent account-existence probing at scale.
    const normalizedEmail = email.toLowerCase().trim()
    const rl = await persistentRateLimit(
      normalizedEmail,
      "auth:resend-verification",
      3,
      3600
    )
    if (!rl.success) {
      return NextResponse.json(
        { error: "Demasiadas solicitudes. Intentá de nuevo más tarde." },
        { status: 429 }
      )
    }

    // Buscar usuario por email con su organización
    const { data: user, error: findError } = await supabaseAdmin
      .from("users")
      .select(`
        id,
        email,
        nombre,
        email_verified,
        organization_id,
        organizations!inner (slug)
      `)
      .eq("email", email)
      .single()

    if (findError || !user) {
      // No revelar si el email existe o no por seguridad
      return NextResponse.json({
        success: true,
        message: "Si el email existe, recibirás un enlace de verificación.",
      })
    }

    // Si ya está verificado, no hacer nada
    if (user.email_verified) {
      return NextResponse.json({
        success: true,
        message: "Si el email existe, recibirás un enlace de verificación.",
      })
    }

    // Generar nuevo token
    const verificationToken = crypto.randomBytes(32).toString("hex")
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 horas

    // Actualizar token en base de datos
    const { error: updateError } = await supabaseAdmin
      .from("users")
      .update({
        email_verification_token: verificationToken,
        email_verification_expires: verificationExpires.toISOString(),
      })
      .eq("id", user.id)

    if (updateError) {
      console.error("Error updating verification token:", updateError)
      return NextResponse.json(
        { error: "Error al generar el enlace de verificación" },
        { status: 500 }
      )
    }

    // Enviar email
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const org = (user as any).organizations as { slug: string }
    try {
      await sendVerificationEmail({
        email: user.email,
        token: verificationToken,
        nombre: user.nombre,
        slug: org.slug,
      })
    } catch (emailError) {
      console.error("Error sending verification email:", emailError)
      return NextResponse.json(
        { error: "Error al enviar el email de verificación" },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: "Se ha enviado un nuevo enlace de verificación a tu email.",
    })
  } catch (error) {
    console.error("Resend verification error:", error)
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    )
  }
}
