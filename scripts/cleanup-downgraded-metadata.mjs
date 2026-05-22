#!/usr/bin/env node
// Limpia metadata Premium residual en subs ya downgradeadas a Free.
// (payment_provider, current_period_end, billing_period → null)

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

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const { data: target } = await supabase
  .from("subscriptions")
  .select(`
    id, organization_id, payment_provider, current_period_end,
    organizations!inner ( slug ),
    plans!inner ( tipo, slug )
  `)
  .eq("status", "ACTIVE")
  .eq("plans.tipo", "FREE")
  .not("current_period_end", "is", null)

if (!target || target.length === 0) {
  console.log("Sin metadata residual que limpiar.")
  process.exit(0)
}

console.log(`Limpiando ${target.length} subs Free con metadata Premium residual...`)
for (const sub of target) {
  const org = Array.isArray(sub.organizations) ? sub.organizations[0] : sub.organizations
  const { error } = await supabase
    .from("subscriptions")
    .update({
      payment_provider: null,
      current_period_end: null,
      billing_period: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sub.id)
  if (error) {
    console.error(`  FAIL ${org?.slug}:`, error.message)
  } else {
    console.log(`  OK ${org?.slug}`)
  }
}
