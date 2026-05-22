#!/usr/bin/env node
// Lista suscripciones ACTIVE con current_period_end ya vencido.
// Solo SELECT — no modifica nada.
//
// Uso: node scripts/preview-expired-subs.mjs

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

const { data, error } = await supabase
  .from("subscriptions")
  .select(`
    id,
    organization_id,
    status,
    payment_provider,
    current_period_end,
    trial_end,
    organizations!inner ( nombre, slug, activo ),
    plans!inner ( nombre, tipo, slug )
  `)
  .eq("status", "ACTIVE")
  .not("current_period_end", "is", null)
  .lte("current_period_end", now)

if (error) {
  console.error("Error:", error)
  process.exit(1)
}

if (!data || data.length === 0) {
  console.log("Sin subs vencidas. Nada que limpiar.")
  process.exit(0)
}

const manual = data.filter((s) => s.payment_provider === "MANUAL")
const external = data.filter((s) =>
  ["MERCADOPAGO", "REBILL"].includes(s.payment_provider)
)
const other = data.filter(
  (s) =>
    s.payment_provider !== "MANUAL" &&
    !["MERCADOPAGO", "REBILL"].includes(s.payment_provider)
)

console.log(`Total subs ACTIVE vencidas: ${data.length}`)
console.log(`  MANUAL  (→ downgrade Free):  ${manual.length}`)
console.log(`  EXTERNO (→ marcar PAST_DUE): ${external.length}`)
if (other.length > 0) {
  console.log(`  OTROS/null (revisar manual): ${other.length}`)
}
console.log()

const fmt = (row) => {
  const org = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations
  const plan = Array.isArray(row.plans) ? row.plans[0] : row.plans
  const ven = row.current_period_end?.split("T")[0] ?? "-"
  const activa = org?.activo ? "act" : "INA"
  return `  [${activa}] ${org?.slug?.padEnd(28) ?? "-".padEnd(28)} ${plan?.nombre?.padEnd(14) ?? "-".padEnd(14)} venció ${ven}`
}

if (manual.length > 0) {
  console.log("=== MANUAL (downgrade a Free) ===")
  manual.forEach((r) => console.log(fmt(r)))
  console.log()
}
if (external.length > 0) {
  console.log("=== EXTERNO (marcar PAST_DUE) ===")
  external.forEach((r) => console.log(fmt(r)))
  console.log()
}
if (other.length > 0) {
  console.log("=== OTROS (revisar a mano) ===")
  other.forEach((r) =>
    console.log(`  provider=${r.payment_provider ?? "null"} ${fmt(r)}`)
  )
}
