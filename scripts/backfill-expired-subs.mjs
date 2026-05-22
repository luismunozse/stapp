#!/usr/bin/env node
// Backfill: limpia subs ACTIVE con current_period_end vencido.
//   - MANUAL  → downgrade plan a Free
//   - MERCADOPAGO/REBILL → status PAST_DUE
// Registra en subscription_history para trazabilidad.

import { createClient } from "@supabase/supabase-js"
import { readFileSync, existsSync } from "node:fs"

function loadEnv(path) {
  if (!existsSync(path)) return
  const raw = readFileSync(path, "utf8")
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
    if (!m) continue
    let val = m[2]
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = val
  }
}

loadEnv(".env.production.local")
loadEnv(".env")

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

const supabase = createClient(url, key)
const now = new Date().toISOString()

const { data: freePlan, error: planErr } = await supabase
  .from("plans")
  .select("id, nombre")
  .eq("slug", "free")
  .eq("activo", true)
  .maybeSingle()

if (planErr || !freePlan) {
  console.error("No se encontró plan Free activo:", planErr)
  process.exit(1)
}

const { data: expired, error: selErr } = await supabase
  .from("subscriptions")
  .select(`
    id, organization_id, status, payment_provider, plan_id, current_period_end,
    organizations!inner ( nombre, slug ),
    plans!inner ( nombre, tipo )
  `)
  .eq("status", "ACTIVE")
  .not("current_period_end", "is", null)
  .lte("current_period_end", now)

if (selErr) {
  console.error("Error select:", selErr)
  process.exit(1)
}

const manual = expired.filter((s) => s.payment_provider === "MANUAL")
const external = expired.filter((s) =>
  ["MERCADOPAGO", "REBILL"].includes(s.payment_provider)
)

console.log(`Procesando ${manual.length} MANUAL + ${external.length} externos...`)

let okManual = 0, okExt = 0, fails = 0

for (const sub of manual) {
  const org = Array.isArray(sub.organizations) ? sub.organizations[0] : sub.organizations
  const { error: upErr } = await supabase
    .from("subscriptions")
    .update({ plan_id: freePlan.id, updated_at: now })
    .eq("id", sub.id)
  if (upErr) {
    console.error(`  FAIL ${org?.slug}:`, upErr.message)
    fails++
    continue
  }
  await supabase.from("subscription_history").insert({
    subscription_id: sub.id,
    organization_id: sub.organization_id,
    action: "DOWNGRADED",
    previous_status: "ACTIVE",
    new_status: "ACTIVE",
    details: {
      reason: "backfill_expired_manual",
      previous_plan_id: sub.plan_id,
      new_plan_id: freePlan.id,
      expired_at: sub.current_period_end,
    },
    performed_by: "system:backfill",
  })
  console.log(`  OK ${org?.slug} → Free`)
  okManual++
}

for (const sub of external) {
  const org = Array.isArray(sub.organizations) ? sub.organizations[0] : sub.organizations
  const { error: upErr } = await supabase
    .from("subscriptions")
    .update({ status: "PAST_DUE", updated_at: now })
    .eq("id", sub.id)
  if (upErr) {
    console.error(`  FAIL ${org?.slug}:`, upErr.message)
    fails++
    continue
  }
  await supabase.from("subscription_history").insert({
    subscription_id: sub.id,
    organization_id: sub.organization_id,
    action: "MARKED_PAST_DUE",
    previous_status: "ACTIVE",
    new_status: "PAST_DUE",
    details: {
      reason: "backfill_expired_external",
      payment_provider: sub.payment_provider,
      expired_at: sub.current_period_end,
    },
    performed_by: "system:backfill",
  })
  console.log(`  OK ${org?.slug} → PAST_DUE`)
  okExt++
}

console.log()
console.log(`Resumen: ${okManual} downgrades, ${okExt} past_due, ${fails} fallos.`)
