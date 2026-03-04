import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto"
import * as OTPAuth from "otpauth"
import bcrypt from "bcryptjs"

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
