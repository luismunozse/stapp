import crypto from "crypto"

const ALGORITHM = "aes-256-gcm"

let warnedWeakKey = false

function getKey(): Buffer {
  const raw = process.env.FACTURACION_ENCRYPTION_KEY
  if (!raw) {
    throw new Error("FACTURACION_ENCRYPTION_KEY no configurada")
  }
  // Aviso (una vez) si la passphrase es debil: SHA-256 de una clave corta produce
  // 32 bytes pero con baja entropia, recuperable por fuerza bruta si la DB se
  // compromete. No rompemos el deploy (fail-open) para no sacar de servicio a
  // instancias existentes; se recomienda >= 32 caracteres aleatorios.
  if (raw.length < 32 && !warnedWeakKey) {
    warnedWeakKey = true
    console.warn(
      `[facturacion/crypto] FACTURACION_ENCRYPTION_KEY es debil (${raw.length} chars). Usar >= 32 chars aleatorios.`
    )
  }
  return crypto.createHash("sha256").update(raw).digest()
}

export function encryptSecret(text: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv)
  const enc = Buffer.concat([cipher.update(text, "utf8"), cipher.final()])
  return `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${enc.toString("hex")}`
}

export function decryptSecret(payload: string): string {
  const [ivHex, tagHex, dataHex] = payload.split(":")
  if (!ivHex || !tagHex || !dataHex || payload.split(":").length !== 3) {
    throw new Error("payload cifrado inválido")
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivHex, "hex"))
  decipher.setAuthTag(Buffer.from(tagHex, "hex"))
  return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString("utf8")
}
