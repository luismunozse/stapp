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

const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString()
console.log(`Buscando actividad desde ${cutoff}\n`)

const { data: recentPays } = await sb
  .from("subscription_payments")
  .select("*, subscriptions(organization_id, organizations(nombre))")
  .gte("created_at", cutoff)
  .order("created_at", { ascending: false })

console.log("PAGOS ultimos 30min:")
if (!recentPays?.length) console.log("  (ninguno)")
else for (const p of recentPays) {
  console.log(`  ${p.created_at} ${p.payment_provider} ${p.status} $${p.amount} ${p.currency} prov_id=${p.provider_payment_id} org=${p.organization_id}`)
}

const { data: recentSubs } = await sb
  .from("subscriptions")
  .select("*, plans(slug), organizations(nombre)")
  .gte("updated_at", cutoff)
  .order("updated_at", { ascending: false })

console.log("\nSUSCRIPCIONES actualizadas ultimos 30min:")
if (!recentSubs?.length) console.log("  (ninguna)")
else for (const s of recentSubs) {
  console.log(`  ${s.updated_at} ${s.organizations?.nombre} plan=${s.plans?.slug} status=${s.status} provider=${s.payment_provider} period_end=${s.current_period_end}`)
}

const { data: recentEvents } = await sb
  .from("webhook_events")
  .select("provider, event_type, status, signature_valid, error_message, received_at, provider_event_id")
  .gte("received_at", cutoff)
  .order("received_at", { ascending: false })

console.log("\nWEBHOOK_EVENTS ultimos 30min:")
if (!recentEvents?.length) console.log("  (ninguno)")
else for (const e of recentEvents) {
  console.log(`  ${e.received_at} ${e.provider}/${e.event_type} ${e.status} sig=${e.signature_valid} evt=${e.provider_event_id} err=${e.error_message ?? "-"}`)
}
