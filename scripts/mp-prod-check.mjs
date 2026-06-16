// Verifica si el secret de Vercel firma el evento real fallado.
// Uso: 1) vercel env pull .env.vercel --environment=production
//      2) node scripts/mp-prod-check.mjs
import crypto from "node:crypto"
import fs from "node:fs"

// --- evento real fallado (merchant_order 41553362368) ---
const TARGET_V1 = "ea0fe38c2dd05ae063b43819381a3cdaee5df64daa4f6d8b13bcbb0f9f3218d"
const REQUEST_ID = "4e131c21-b927-4065-b3cb-8716f02d597b"
const TS = "1781496970"
const DATA_ID = "41553362368"
// ---------------------------------------------------------

const ENV_FILE = ".env.vercel"
if (!fs.existsSync(ENV_FILE)) {
  console.error(`No existe ${ENV_FILE}. Corré primero: vercel env pull ${ENV_FILE} --environment=production`)
  process.exit(1)
}

const txt = fs.readFileSync(ENV_FILE, "utf8")
const line = txt.split(/\r?\n/).find((l) => l.startsWith("MERCADOPAGO_WEBHOOK_SECRET="))
if (!line) {
  console.error("MERCADOPAGO_WEBHOOK_SECRET no encontrado en .env.vercel (revisá el typo: MERCADOPAGO con O)")
  process.exit(1)
}

const raw = line.slice("MERCADOPAGO_WEBHOOK_SECRET=".length)
const norm = raw.trim().replace(/^['"]|['"]$/g, "").trim()

const hmac = (secret, manifest) =>
  crypto.createHmac("sha256", secret).update(manifest).digest("hex")

const manifests = {
  "id+request-id": `id:${DATA_ID};request-id:${REQUEST_ID};ts:${TS};`,
  "SIN id":        `request-id:${REQUEST_ID};ts:${TS};`,
  "id sin reqid":  `id:${DATA_ID};ts:${TS};`,
}

console.log("target v1:", TARGET_V1)
console.log("len_raw:", raw.length, "| len_norm:", norm.length, "| tiene_comillas/espacios:", raw !== norm)
console.log("sha_prefix_norm:", crypto.createHash("sha256").update(norm).digest("hex").slice(0, 8))
console.log("")

let hit = false
for (const [label, m] of Object.entries(manifests)) {
  for (const [skind, secret] of [["raw", raw], ["norm", norm]]) {
    const ok = hmac(secret, m) === TARGET_V1
    if (ok) hit = true
    console.log(`${ok ? "✅ MATCH" : "  ----"}  manifest=${label}  secret=${skind}`)
  }
}

console.log("")
console.log(hit
  ? "➡️ MATCH: el secret de Vercel SÍ firma. El bug es manifest/id — pasamos a logging."
  : "❌ NINGUNA: el secret de Vercel NO firma este evento. Es el secret equivocado (otra app / valor viejo) o el id real difiere.")
