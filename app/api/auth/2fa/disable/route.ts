import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { decryptSecret, verifyTOTP } from "@/lib/totp"
import { z } from "zod"

const disableSchema = z.object({
  code: z.string().min(6, "Codigo requerido"),
})

// POST /api/auth/2fa/disable - Desactiva 2FA (requiere codigo TOTP)
export async function POST(request: NextRequest) {
  const { error, userId } = await requireAuth()
  if (error) return error

  const body = await request.json()
  const parsed = disableSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0].message },
      { status: 400 }
    )
  }

  // Obtener datos de 2FA del usuario
  const { data: user, error: userError } = await supabaseAdmin
    .from("users")
    .select("totp_secret, totp_enabled")
    .eq("id", userId)
    .single()

  if (userError || !user) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 })
  }

  if (!user.totp_enabled || !user.totp_secret) {
    return NextResponse.json({ error: "2FA no esta activado" }, { status: 400 })
  }

  // Verificar codigo TOTP
  const secret = decryptSecret(user.totp_secret)
  const isValid = verifyTOTP(secret, parsed.data.code)

  if (!isValid) {
    return NextResponse.json(
      { error: "Codigo incorrecto" },
      { status: 400 }
    )
  }

  // Desactivar 2FA y limpiar datos
  await supabaseAdmin
    .from("users")
    .update({
      totp_secret: null,
      totp_enabled: false,
      totp_backup_codes: null,
      totp_verified_at: null,
    })
    .eq("id", userId)

  return NextResponse.json({ success: true, message: "2FA desactivado" })
}
