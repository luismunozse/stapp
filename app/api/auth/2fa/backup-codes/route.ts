import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { decryptSecret, verifyTOTP, generateBackupCodes, hashBackupCodes } from "@/lib/totp"
import { z } from "zod"

const regenerateSchema = z.object({
  code: z.string().length(6, "El codigo debe tener 6 digitos"),
})

// POST /api/auth/2fa/backup-codes - Regenera backup codes (requiere TOTP)
export async function POST(request: NextRequest) {
  const { error, userId } = await requireAuth()
  if (error) return error

  const body = await request.json()
  const parsed = regenerateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0].message },
      { status: 400 }
    )
  }

  // Obtener datos del usuario
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

  // Verificar codigo TOTP actual
  const secret = decryptSecret(user.totp_secret)
  const isValid = verifyTOTP(secret, parsed.data.code)

  if (!isValid) {
    return NextResponse.json(
      { error: "Codigo incorrecto" },
      { status: 400 }
    )
  }

  // Generar nuevos backup codes
  const newBackupCodes = generateBackupCodes()
  const hashedCodes = await hashBackupCodes(newBackupCodes)

  await supabaseAdmin
    .from("users")
    .update({ totp_backup_codes: hashedCodes })
    .eq("id", userId)

  return NextResponse.json({
    backupCodes: newBackupCodes,
    message: "Nuevos backup codes generados. Los anteriores ya no funcionan.",
  })
}
