import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { generateTOTPSecret, encryptSecret, generateBackupCodes, hashBackupCodes } from "@/lib/totp"
import QRCode from "qrcode"

// POST /api/auth/2fa/setup - Genera secreto TOTP y QR code
export async function POST() {
  const { error, userId } = await requireAuth()
  if (error) return error

  // Obtener email del usuario
  const { data: user, error: userError } = await supabaseAdmin
    .from("users")
    .select("email, totp_enabled")
    .eq("id", userId)
    .single()

  if (userError || !user) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 })
  }

  if (user.totp_enabled) {
    return NextResponse.json(
      { error: "2FA ya esta activado. Desactivalo primero para reconfigurarlo." },
      { status: 400 }
    )
  }

  // Generar secreto TOTP
  const { secret, uri } = generateTOTPSecret(user.email)

  // Generar QR code como data URL
  const qrCodeDataUrl = await QRCode.toDataURL(uri)

  // Generar backup codes
  const backupCodes = generateBackupCodes()
  const hashedBackupCodes = await hashBackupCodes(backupCodes)

  // Guardar secreto encriptado y backup codes (sin activar todavia)
  const encryptedSecret = encryptSecret(secret)

  await supabaseAdmin
    .from("users")
    .update({
      totp_secret: encryptedSecret,
      totp_backup_codes: hashedBackupCodes,
      totp_enabled: false,
    })
    .eq("id", userId)

  return NextResponse.json({
    qrCode: qrCodeDataUrl,
    secret: secret, // Para entrada manual
    backupCodes: backupCodes, // Mostrar una sola vez
  })
}
