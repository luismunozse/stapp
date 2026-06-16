// Uso: node scripts/debug-mp-signature.mjs
// Pegá los valores de UN evento fallado de webhook_events + el secret.
// Recalcula el HMAC para las variantes del manifest y dice cuál matchea v1.
import crypto from "node:crypto"

// ---- COMPLETAR con datos reales del evento fallado ----
const SECRET = process.env.MERCADOPAGO_WEBHOOK_SECRET || "PEGAR_SECRET_ACA"
const X_SIGNATURE = "ts=XXXX,v1=YYYY"        // header x-signature completo
const X_REQUEST_ID = "PEGAR_X_REQUEST_ID"     // header x-request-id
const DATA_ID = "161737106929"                // provider_event_id / resource
// --------------------------------------------------------

const parts = X_SIGNATURE.split(",")
const ts = parts.find((p) => p.trim().startsWith("ts="))?.split("=")[1]?.trim()
const v1 = parts.find((p) => p.trim().startsWith("v1="))?.split("=")[1]?.trim()

if (!ts || !v1) {
  console.error("x-signature mal formado. Esperado 'ts=...,v1=...'")
  process.exit(1)
}

const idLower = String(DATA_ID).toLowerCase()

const variants = {
  "con id (lowercase) + request-id":   `id:${idLower};request-id:${X_REQUEST_ID};ts:${ts};`,
  "con id (raw) + request-id":         `id:${DATA_ID};request-id:${X_REQUEST_ID};ts:${ts};`,
  "SIN id, con request-id":            `request-id:${X_REQUEST_ID};ts:${ts};`,
  "con id (lowercase), SIN request-id":`id:${idLower};ts:${ts};`,
  "solo ts":                           `ts:${ts};`,
}

console.log(`v1 esperado: ${v1}\n`)
let hit = false
for (const [name, manifest] of Object.entries(variants)) {
  const hmac = crypto.createHmac("sha256", SECRET).update(manifest).digest("hex")
  const ok = hmac === v1
  if (ok) hit = true
  console.log(`${ok ? "✅ MATCH" : "  ----"}  ${name}`)
  console.log(`          manifest: ${manifest}`)
  console.log(`          hmac:     ${hmac}\n`)
}

if (!hit) {
  console.log("❌ Ninguna variante matchea => el SECRET está mal (otra app, regenerado, o con espacio/newline al copiar).")
} else {
  console.log("➡️ La variante que matcheó indica cómo arreglar verifyWebhookSignature.")
}
