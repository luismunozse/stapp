import crypto from "crypto"

const ALGORITHM = "aes-256-gcm"
const IV_LENGTH = 16
const TAG_LENGTH = 16

let warnedWeakKey = false

function getEncryptionKey(): Buffer {
  const key = process.env.WHATSAPP_ENCRYPTION_KEY
  if (!key) {
    throw new Error("WHATSAPP_ENCRYPTION_KEY no configurada")
  }
  // Aviso (una vez) si la passphrase es debil: SHA-256 de una clave corta produce
  // 32 bytes pero con baja entropia, recuperable por fuerza bruta si la DB se
  // compromete. No rompemos el deploy (fail-open) para no sacar de servicio a
  // instancias existentes; se recomienda >= 32 caracteres aleatorios.
  if (key.length < 32 && !warnedWeakKey) {
    warnedWeakKey = true
    console.warn(
      `[whatsapp/encryption] WHATSAPP_ENCRYPTION_KEY es debil (${key.length} chars). Usar >= 32 chars aleatorios.`
    )
  }
  // Usar SHA-256 del key para garantizar 32 bytes
  return crypto.createHash("sha256").update(key).digest()
}

export function encrypt(text: string): string {
  const key = getEncryptionKey()
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)

  let encrypted = cipher.update(text, "utf8", "hex")
  encrypted += cipher.final("hex")
  const tag = cipher.getAuthTag()

  // Combinar iv + tag + encrypted
  return iv.toString("hex") + tag.toString("hex") + encrypted
}

export function decrypt(encryptedText: string): string {
  const key = getEncryptionKey()

  const iv = Buffer.from(encryptedText.slice(0, IV_LENGTH * 2), "hex")
  const tag = Buffer.from(encryptedText.slice(IV_LENGTH * 2, IV_LENGTH * 2 + TAG_LENGTH * 2), "hex")
  const encrypted = encryptedText.slice(IV_LENGTH * 2 + TAG_LENGTH * 2)

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)

  let decrypted = decipher.update(encrypted, "hex", "utf8")
  decrypted += decipher.final("utf8")

  return decrypted
}
