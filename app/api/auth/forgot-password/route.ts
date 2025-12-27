import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { sendPasswordResetEmail } from "@/lib/email"
import { randomBytes } from "crypto"
import { z } from "zod"

const forgotPasswordSchema = z.object({
  email: z.string().email("Email inválido"),
})

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { email } = forgotPasswordSchema.parse(body)

    // Buscar usuario
    const { data: user } = await supabaseAdmin
      .from("users")
      .select("id, email, nombre")
      .eq("email", email)
      .single()

    // Siempre responder con éxito para no revelar si el email existe
    if (!user) {
      return NextResponse.json({
        message: "Si el email existe, recibirás un correo con instrucciones",
      })
    }

    // Generar token único
    const resetToken = randomBytes(32).toString("hex")
    const resetTokenExpiry = new Date(Date.now() + 3600000) // 1 hora

    // Guardar token en BD
    await supabaseAdmin
      .from("users")
      .update({
        reset_token: resetToken,
        reset_token_expiry: resetTokenExpiry.toISOString(),
      })
      .eq("id", user.id)

    // Enviar email
    await sendPasswordResetEmail({
      email: user.email,
      token: resetToken,
      nombre: user.nombre,
    })

    return NextResponse.json({
      message: "Si el email existe, recibirás un correo con instrucciones",
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }

    console.error("Error in forgot-password:", error)
    return NextResponse.json(
      { error: "Error al procesar la solicitud" },
      { status: 500 }
    )
  }
}
