// Test genérico de firma MP contra un evento real.
// Uso:
//   node scripts/mp-sig-test.mjs "<x-signature>" "<x-request-id>" "<data-id>"
// Ejemplo:
//   node scripts/mp-sig-test.mjs "ts=1781496970,v1=ea0f..." "4e131c21-..." "161737106929"
import crypto from "node:crypto"
import fs from "node:fs"

const [xSignature, xRequestId, dataId] = process.argv.slice(2)
if (!xSignature || !xRequestId || !dataId) {
  console.error('Uso: node scripts/mp-sig-test.mjs "<x-signature>" "<x-request-id>" "<data-id>"')
  process.exit(1)
}

const ENV_FILE = ".env.vercel"
if (!fs.existsSync(ENV_FILE)) {
  console.error(`No existe ${ENV_FILE}. Pegá ahí MERCADOPAGO_WEBHOOK_SECRET=<valor de Vercel>`)
  process.exit(1)
}
const line = fs.readFileSync(ENV_FILE, "utf8")
  .split(/\r?\n/).find((l) => l.startsWith("MERCADOPAGO_WEBHOOK_SECRET="))
if (!line) { console.error("MERCADOPAGO_WEBHOOK_SECRET no está en .env.vercel"); process.exit(1) }
const secret = line.slice("MERCADOPAGO_WEBHOOK_SECRET=".length)
  .trim().replace(/^['"]|['"]$/g, "").trim()

const parts = xSignature.split(",")
const ts = parts.find((p) => p.trim().startsWith("ts="))?.split("=")[1]?.trim()
const v1 = parts.find((p) => p.trim().startsWith("v1="))?.split("=")[1]?.trim()
if (!ts || !v1) { console.error("x-signature mal formado (esperado 'ts=...,v1=...')"); process.exit(1) }

const idLower = String(dataId).toLowerCase()
const manifests = {
  "id+request-id":        `id:${idLower};request-id:${xRequestId};ts:${ts};`,
  "id RAW (sin lower)":   `id:${dataId};request-id:${xRequestId};ts:${ts};`,
  "SIN id":               `request-id:${xRequestId};ts:${ts};`,
  "id sin request-id":    `id:${idLower};ts:${ts};`,
  "solo ts":              `ts:${ts};`,
}

console.log("v1 esperado:", v1, "\n")
let hit = false
for (const [label, m] of Object.entries(manifests)) {
  const ok = crypto.createHmac("sha256", secret).update(m).digest("hex") === v1
  if (ok) hit = true
  console.log(`${ok ? "✅ MATCH" : "  ----"}  ${label}`)
}
console.log("")
console.log(hit
  ? "➡️ MATCH: el secret SÍ firma este payment. El merchant_order fallaba por su id particular."
  : "❌ El secret NO firma ni un payment limpio => secret equivocado (otra app MP / regenerado).")
