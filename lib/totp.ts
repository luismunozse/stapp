import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto"
import * as OTPAuth from "otpauth"
import bcrypt from "bcryptjs"
import { supabaseAdmin } from "@/lib/supabase"

const ALGORITHM = "aes-256-gcm"
const ISSUER = "STApp"

// Derivar clave de encriptacion del NEXTAUTH_SECRET
function getEncryptionKey(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error("NEXTAUTH_SECRET no configurado")
  return createHash("sha256").update(secret).digest()
}

// Encriptar el secreto TOTP antes de guardarlo en la BD
export function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey()
  const iv = randomBytes(16)
  const cipher = createCipheriv(ALGORITHM, key, iv)

  let encrypted = cipher.update(plaintext, "utf8", "hex")
  encrypted += cipher.final("hex")
  const authTag = cipher.getAuthTag().toString("hex")

  // Formato: iv:authTag:encrypted
  return `${iv.toString("hex")}:${authTag}:${encrypted}`
}

// Desencriptar el secreto TOTP
export function decryptSecret(ciphertext: string): string {
  const key = getEncryptionKey()
  const [ivHex, authTagHex, encrypted] = ciphertext.split(":")

  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"))
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"))

  let decrypted = decipher.update(encrypted, "hex", "utf8")
  decrypted += decipher.final("utf8")
  return decrypted
}

// Generar un nuevo secreto TOTP
export function generateTOTPSecret(email: string): {
  secret: string
  uri: string
} {
  const totp = new OTPAuth.TOTP({
    issuer: ISSUER,
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
  })

  return {
    secret: totp.secret.base32,
    uri: totp.toString(),
  }
}

// Verificar un codigo TOTP
export function verifyTOTP(secret: string, token: string): boolean {
  const totp = new OTPAuth.TOTP({
    issuer: ISSUER,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  })

  // Ventana de 1 paso: acepta el codigo actual, anterior y siguiente (+-30s)
  const delta = totp.validate({ token, window: 1 })
  return delta !== null
}

// Generar backup codes (10 codigos de 8 caracteres)
export function generateBackupCodes(): string[] {
  const codes: string[] = []
  for (let i = 0; i < 10; i++) {
    const code = randomBytes(4).toString("hex").toUpperCase()
    codes.push(code)
  }
  return codes
}

// Hashear backup codes para almacenamiento seguro
export async function hashBackupCodes(codes: string[]): Promise<string[]> {
  const hashed = await Promise.all(
    codes.map((code) => bcrypt.hash(code, 10))
  )
  return hashed
}

// Verificar un backup code contra los hashes almacenados
export async function verifyBackupCode(
  code: string,
  hashedCodes: string[]
): Promise<{ valid: boolean; index: number }> {
  for (let i = 0; i < hashedCodes.length; i++) {
    const match = await bcrypt.compare(code.toUpperCase(), hashedCodes[i])
    if (match) {
      return { valid: true, index: i }
    }
  }
  return { valid: false, index: -1 }
}

/**
 * Verifica un código 2FA (TOTP o backup) para un usuario, server-side.
 *
 * Importante: esta función es la ÚNICA fuente de verdad para validación de 2FA
 * durante el login. Antes existía un endpoint público `/api/auth/2fa/validate`
 * que respondía al cliente "valid: true" y luego el cliente reenviaba el login
 * con `skip2FA=true` — el servidor no tenía pruebas de que el código se hubiera
 * verificado, lo que permitía bypasear 2FA conociendo email+password. Ahora la
 * verificación corre dentro de `authorize()` de NextAuth, sin trust en el cliente.
 *
 * Si el código matchea como backup code, lo CONSUME (lo elimina de la lista
 * en BD) para que no pueda reusarse.
 *
 * Devuelve `valid: false` si:
 *  - el usuario no existe
 *  - no tiene 2FA activado
 *  - el código no matchea ni TOTP ni ningún backup code
 */
export async function verifyUserTotpCode(
  userId: string,
  code: string
): Promise<{ valid: boolean; backupCodeUsed?: boolean; remainingBackupCodes?: number }> {
  const { data: user, error } = await supabaseAdmin
    .from("users")
    .select("totp_secret, totp_enabled, totp_backup_codes")
    .eq("id", userId)
    .single()

  if (error || !user || !user.totp_enabled || !user.totp_secret) {
    return { valid: false }
  }

  const trimmed = code.trim()
  if (!trimmed) return { valid: false }

  const secret = decryptSecret(user.totp_secret)

  // 1) Intentar TOTP (6 dígitos)
  if (/^\d{6}$/.test(trimmed)) {
    if (verifyTOTP(secret, trimmed)) {
      return { valid: true }
    }
  }

  // 2) Intentar backup code (consumir si matchea)
  if (user.totp_backup_codes && user.totp_backup_codes.length > 0) {
    const { valid, index } = await verifyBackupCode(trimmed, user.totp_backup_codes)
    if (valid) {
      const updatedCodes = [...user.totp_backup_codes]
      updatedCodes.splice(index, 1)
      await supabaseAdmin
        .from("users")
        .update({ totp_backup_codes: updatedCodes })
        .eq("id", userId)
      return {
        valid: true,
        backupCodeUsed: true,
        remainingBackupCodes: updatedCodes.length,
      }
    }
  }

  return { valid: false }
}
