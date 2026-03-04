import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { decryptSecret, verifyTOTP } from "@/lib/totp"
import { z } from "zod"

const verifySchema = z.object({
  code: z.string().length(6, "El codigo debe tener 6 digitos"),
})

// POST /api/auth/2fa/verify - Verifica codigo TOTP y activa 2FA
export async function POST(request: NextRequest) {
  const { error, userId } = await requireAuth()
  if (error) return error

  const body = await request.json()
  const parsed = verifySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0].message },
      { status: 400 }
    )
  }

  // Obtener secreto del usuario
  const { data: user, error: userError } = await supabaseAdmin
    .from("users")
    .select("totp_secret, totp_enabled")
    .eq("id", userId)
    .single()

  if (userError || !user) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 })
  }

  if (user.totp_enabled) {
    return NextResponse.json({ error: "2FA ya esta activado" }, { status: 400 })
  }

  if (!user.totp_secret) {
    return NextResponse.json(
      { error: "Primero debes configurar 2FA con /api/auth/2fa/setup" },
      { status: 400 }
    )
  }

  // Desencriptar y verificar
  const secret = decryptSecret(user.totp_secret)
  const isValid = verifyTOTP(secret, parsed.data.code)

  if (!isValid) {
    return NextResponse.json(
      { error: "Codigo incorrecto. Intenta de nuevo." },
      { status: 400 }
    )
  }

  // Activar 2FA
  await supabaseAdmin
    .from("users")
    .update({
      totp_enabled: true,
      totp_verified_at: new Date().toISOString(),
    })
    .eq("id", userId)

  return NextResponse.json({ success: true, message: "2FA activado correctamente" })
}
