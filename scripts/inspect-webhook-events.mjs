import { createClient } from "@supabase/supabase-js"
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

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const { data, error } = await sb.from("webhook_events").select("*").limit(5)
if (error) {
  console.log("Error:", error)
} else if (!data || data.length === 0) {
  console.log("[!] Tabla vacia. CERO webhooks recibidos.")
} else {
  console.log("COLS:", Object.keys(data[0]))
  console.log(`COUNT (sample): ${data.length}`)
  console.log("Sample:")
  for (const r of data) console.log("  ", r)
}

const { count } = await sb.from("webhook_events").select("*", { count: "exact", head: true })
console.log("TOTAL webhook_events:", count)

const { data: mpEvents } = await sb
  .from("webhook_events")
  .select("*")
  .eq("provider", "MERCADOPAGO")
  .limit(5)
console.log("MP events sample:", mpEvents?.length || 0)
if (mpEvents?.length) console.log(mpEvents)
