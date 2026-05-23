// Crea preferencia MP test y muestra notification_url
// para confirmar que apunta a www despues del redeploy.

import { readFileSync, existsSync } from "node:fs"

for (const p of [".env.production.local", ".env"]) {
  if (!existsSync(p)) continue
  for (const l of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
    if (!m) continue
    let v = m[2]
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (process.env[m[1]] === undefined) process.env[m[1]] = v
  }
}

const token = process.env.MERCADOPAGO_ACCESS_TOKEN
if (!token) {
  console.error("Falta MERCADOPAGO_ACCESS_TOKEN en .env")
  process.exit(1)
}

const res = await fetch("https://api.mercadopago.com/checkout/preferences", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    items: [{ id: "test", title: "Test diag", quantity: 1, unit_price: 1, currency_id: "ARS" }],
    notification_url: "https://www.stapp.com.ar/api/mercadopago/webhook",
    external_reference: JSON.stringify({ test: true }),
  }),
})

if (!res.ok) {
  console.error("MP error:", res.status, await res.text())
  process.exit(1)
}
const data = await res.json()
console.log("Preference id:", data.id)
console.log("notification_url:", data.notification_url)
console.log("init_point:", data.init_point)
console.log("\nAhora pega ese init_point en un browser y pagá $1 con tarjeta test MP.")
console.log("Despues corre: node scripts/webhook-events-summary.mjs")
