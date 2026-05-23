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

const { data } = await sb
  .from("webhook_events")
  .select("provider, event_type, status, signature_valid, error_message, received_at")
  .order("received_at", { ascending: false })

if (!data) { console.log("Empty"); process.exit(0) }
console.log(`TOTAL: ${data.length}\n`)
const grp = {}
for (const e of data) {
  const k = `${e.provider}/${e.event_type ?? "null"}/${e.status}/sig=${e.signature_valid}`
  grp[k] = (grp[k] || 0) + 1
}
console.log("BUCKETS:")
for (const [k, v] of Object.entries(grp)) console.log(`  ${v}x  ${k}`)

console.log("\nULTIMOS 5 NO-manual_reconciliation:")
const real = data.filter(e => e.event_type !== "manual_reconciliation").slice(0, 10)
for (const e of real) {
  console.log(`  ${e.received_at} ${e.provider} ${e.event_type} ${e.status} sig=${e.signature_valid} err=${e.error_message ?? "-"}`)
}
console.log("\nTotal real (no manual):", real.length, "de", data.length)
