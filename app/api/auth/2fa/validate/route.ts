import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { decryptSecret, verifyTOTP, verifyBackupCode } from "@/lib/totp"
import { z } from "zod"

const validateSchema = z.object({
  userId: z.string().min(1),
  code: z.string().min(6, "Codigo requerido"),
})

// POST /api/auth/2fa/validate - Valida codigo TOTP durante el login
// Esta ruta es publica (se llama antes de completar la sesion)
export async function POST(request: NextRequest) {
  const body = await request.json()
  const parsed = validateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0].message },
      { status: 400 }
    )
  }

  const { userId, code } = parsed.data

  // Obtener datos de 2FA del usuario
  const { data: user, error: userError } = await supabaseAdmin
    .from("users")
    .select("totp_secret, totp_enabled, totp_backup_codes")
    .eq("id", userId)
    .single()

  if (userError || !user) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 })
  }

  if (!user.totp_enabled || !user.totp_secret) {
    return NextResponse.json({ error: "2FA no esta activado" }, { status: 400 })
  }

  const secret = decryptSecret(user.totp_secret)

  // Intentar verificar como codigo TOTP (6 digitos)
  if (code.length === 6 && /^\d{6}$/.test(code)) {
    const isValid = verifyTOTP(secret, code)
    if (isValid) {
      return NextResponse.json({ valid: true })
    }
  }

  // Intentar verificar como backup code (8 caracteres hex)
  if (user.totp_backup_codes && user.totp_backup_codes.length > 0) {
    const { valid, index } = await verifyBackupCode(code, user.totp_backup_codes)
    if (valid) {
      // Eliminar el backup code usado
      const updatedCodes = [...user.totp_backup_codes]
      updatedCodes.splice(index, 1)

      await supabaseAdmin
        .from("users")
        .update({ totp_backup_codes: updatedCodes })
        .eq("id", userId)

      return NextResponse.json({
        valid: true,
        backupCodeUsed: true,
        remainingBackupCodes: updatedCodes.length,
      })
    }
  }

  return NextResponse.json(
    { error: "Codigo invalido" },
    { status: 400 }
  )
}
