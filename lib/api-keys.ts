import { randomBytes, createHash } from "crypto"

export function hashApiKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex")
}

export function generateApiKey(): { raw: string; hash: string; prefix: string } {
  const raw = "stapp_live_" + randomBytes(16).toString("hex")
  return { raw, hash: hashApiKey(raw), prefix: raw.slice(0, 18) }
}
