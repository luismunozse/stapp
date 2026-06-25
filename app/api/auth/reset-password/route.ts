import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import bcrypt from "bcryptjs"
import { z } from "zod"

const resetPasswordSchema = z.object({
  token: z.string().min(1, "Token requerido"),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
})

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { token, password } = resetPasswordSchema.parse(body)

    // Buscar usuario con token válido y no expirado
    const { data: user } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("reset_token", token)
      .gt("reset_token_expiry", new Date().toISOString())
      .single()

    if (!user) {
      return NextResponse.json(
        { error: "El enlace es inválido o ha expirado" },
        { status: 400 }
      )
    }

    // Hashear nueva contraseña
    const hashedPassword = await bcrypt.hash(password, 10)

    // Actualizar contraseña y limpiar token.
    // refresh_token: null invalida cualquier sesión PWA activa del atacante.
    await supabaseAdmin
      .from("users")
      .update({
        password: hashedPassword,
        reset_token: null,
        reset_token_expiry: null,
        // Limpiar lockout: si el usuario quedó bloqueado por intentos fallidos,
        // resetear la clave debe desbloquear la cuenta. Sin esto, el usuario
        // resetea el password pero sigue sin poder entrar (ACCOUNT_LOCKED).
        failed_login_attempts: 0,
        locked_until: null,
        last_failed_login: null,
        // Revoke the PWA refresh token so existing attacker sessions are
        // immediately invalidated. The column is read by lib/auth.ts ~L137-192.
        refresh_token: null,
      })
      .eq("id", user.id)

    return NextResponse.json({
      message: "Contraseña actualizada correctamente",
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }

    console.error("Error in reset-password:", error)
    return NextResponse.json(
      { error: "Error al restablecer la contraseña" },
      { status: 500 }
    )
  }
}
