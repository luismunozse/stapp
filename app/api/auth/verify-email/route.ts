import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { sendAccountActivatedEmail } from "@/lib/email"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const token = searchParams.get("token")

    if (!token) {
      return NextResponse.json(
        { error: "Token de verificación requerido" },
        { status: 400 }
      )
    }

    // Buscar usuario con este token (traemos nombre + slug para el mail de
    // confirmación de cuenta activa).
    const { data: user, error: findError } = await supabaseAdmin
      .from("users")
      .select(`
        id,
        email,
        nombre,
        email_verification_expires,
        email_verified,
        organizations!inner (slug)
      `)
      .eq("email_verification_token", token)
      .single()

    if (findError || !user) {
      return NextResponse.json(
        { error: "Token inválido o expirado" },
        { status: 400 }
      )
    }

    // Verificar si ya está verificado
    if (user.email_verified) {
      return NextResponse.json({
        success: true,
        message: "El email ya fue verificado anteriormente",
        alreadyVerified: true,
      })
    }

    // Verificar si el token expiró
    if (user.email_verification_expires) {
      const expiresAt = new Date(user.email_verification_expires)
      if (expiresAt < new Date()) {
        return NextResponse.json(
          { error: "El enlace de verificación ha expirado. Solicita uno nuevo." },
          { status: 400 }
        )
      }
    }

    // Marcar email como verificado
    const { error: updateError } = await supabaseAdmin
      .from("users")
      .update({
        email_verified: true,
        email_verification_token: null,
        email_verification_expires: null,
      })
      .eq("id", user.id)

    if (updateError) {
      console.error("Error updating user verification:", updateError)
      return NextResponse.json(
        { error: "Error al verificar el email" },
        { status: 500 }
      )
    }

    // Enviar mail de confirmación de cuenta activa con el enlace de ingreso.
    // Si falla, no bloqueamos la verificación (que ya quedó persistida).
    try {
      const org = (user as unknown as { organizations: { slug: string } }).organizations
      await sendAccountActivatedEmail({
        email: user.email,
        nombre: user.nombre,
        slug: org.slug,
      })
    } catch (emailError) {
      console.error("Error sending account activated email:", emailError)
    }

    return NextResponse.json({
      success: true,
      message: "Email verificado correctamente",
    })
  } catch (error) {
    console.error("Verify email error:", error)
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    )
  }
}
