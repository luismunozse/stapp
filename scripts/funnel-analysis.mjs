#!/usr/bin/env node
// Análisis funnel Free → Profesional.
// Solo SELECT — no modifica nada.
//
// Uso: node scripts/funnel-analysis.mjs

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
  console.error("Falta NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

const sb = createClient(url, key)

console.log("\n=== FUNNEL ANALYSIS ===\n")

// 1. Estado de suscripciones
const { data: subs, error: e1 } = await sb
  .from("subscriptions")
  .select("status, payment_provider, trial_end, current_period_end, plan_id, plans(slug, nombre)")

if (e1) {
  console.error("Error subs:", e1)
  process.exit(1)
}

const now = new Date()
const buckets = {
  trial_activo: 0,
  trial_expirado: 0,
  free_active: 0,
  pro_pagando: 0,
  pro_manual: 0,
  canceled: 0,
  past_due: 0,
  total: subs.length,
}

for (const s of subs) {
  const slug = s.plans?.slug
  const trialEnd = s.trial_end ? new Date(s.trial_end) : null

  if (s.status === "TRIALING") {
    if (trialEnd && trialEnd > now) buckets.trial_activo++
    else buckets.trial_expirado++
  } else if (s.status === "CANCELED") buckets.canceled++
  else if (s.status === "PAST_DUE") buckets.past_due++
  else if (s.status === "ACTIVE") {
    if (slug === "free") buckets.free_active++
    else if (slug === "profesional") {
      if (s.payment_provider === "MANUAL") buckets.pro_manual++
      else if (s.payment_provider) buckets.pro_pagando++
      else buckets.pro_manual++
    }
  }
}

console.log("DISTRIBUCION SUBS:")
console.log(`  Total orgs:              ${buckets.total}`)
console.log(`  Trial activo:            ${buckets.trial_activo}`)
console.log(`  Trial expirado (limbo):  ${buckets.trial_expirado}`)
console.log(`  Free active:             ${buckets.free_active}`)
console.log(`  Pro pagando (MP/Rebill): ${buckets.pro_pagando}`)
console.log(`  Pro manual/sin provider: ${buckets.pro_manual}`)
console.log(`  Canceled:                ${buckets.canceled}`)
console.log(`  Past due:                ${buckets.past_due}`)

const convRate =
  buckets.total > 0
    ? ((buckets.pro_pagando / buckets.total) * 100).toFixed(1)
    : "0"
console.log(`\nCONVERSION GLOBAL: ${convRate}% (pro_pagando / total)`)

// 2. Engagement Free
console.log("\n=== ENGAGEMENT FREE ===\n")

const { data: usage, error: e2 } = await sb
  .from("organization_usage")
  .select(
    "organization_id, ordenes_mes_actual, ordenes_count, clientes_count, tecnicos_count, storage_used_mb"
  )

if (e2) {
  console.error("Error usage:", e2)
  process.exit(1)
}

const freeOrgIds = new Set(
  subs.filter((s) => s.plans?.slug === "free" && s.status === "ACTIVE").map(
    (s) => s.plan_id && s.status === "ACTIVE" ? null : null
  )
)
// rebuild correctly
const freeOrgs = subs
  .filter((s) => s.plans?.slug === "free" && s.status === "ACTIVE")
  .map((s) => s)

// need organization_id - re-query
const { data: subs2 } = await sb
  .from("subscriptions")
  .select("organization_id, status, plans(slug)")

const freeIds = new Set(
  (subs2 || [])
    .filter((s) => s.plans?.slug === "free" && s.status === "ACTIVE")
    .map((s) => s.organization_id)
)

const freeUsage = (usage || []).filter((u) => freeIds.has(u.organization_id))

const eng = {
  total: freeUsage.length,
  cero_ordenes_mes: 0,
  uso_1_5: 0,
  uso_6_10: 0,
  uso_11_14: 0,
  bloq_ordenes: 0,
  bloq_clientes: 0,
  cerca_clientes: 0,
  cero_clientes: 0,
}

let sumOrdenesMes = 0
let sumClientes = 0

for (const u of freeUsage) {
  const o = u.ordenes_mes_actual || 0
  const c = u.clientes_count || 0
  sumOrdenesMes += o
  sumClientes += c
  if (o === 0) eng.cero_ordenes_mes++
  else if (o <= 5) eng.uso_1_5++
  else if (o <= 10) eng.uso_6_10++
  else if (o <= 14) eng.uso_11_14++
  if (o >= 15) eng.bloq_ordenes++
  if (c === 0) eng.cero_clientes++
  if (c >= 25 && c < 30) eng.cerca_clientes++
  if (c >= 30) eng.bloq_clientes++
}

const promO = eng.total ? (sumOrdenesMes / eng.total).toFixed(1) : "0"
const promC = eng.total ? (sumClientes / eng.total).toFixed(1) : "0"

console.log(`Total Free active:           ${eng.total}`)
console.log(
  `  Sin ordenes este mes:      ${eng.cero_ordenes_mes} (${pct(eng.cero_ordenes_mes, eng.total)}%)`
)
console.log(`  1-5 ordenes:               ${eng.uso_1_5}`)
console.log(`  6-10 ordenes:              ${eng.uso_6_10}`)
console.log(`  11-14 ordenes:             ${eng.uso_11_14}`)
console.log(
  `  BLOQUEADOS ordenes(>=15):  ${eng.bloq_ordenes} (${pct(eng.bloq_ordenes, eng.total)}%)`
)
console.log(`  Promedio ordenes/mes:      ${promO}`)
console.log("")
console.log(
  `  Sin clientes cargados:     ${eng.cero_clientes} (${pct(eng.cero_clientes, eng.total)}%)`
)
console.log(`  Cerca limite (25-29):      ${eng.cerca_clientes}`)
console.log(
  `  BLOQUEADOS clientes(>=30): ${eng.bloq_clientes} (${pct(eng.bloq_clientes, eng.total)}%)`
)
console.log(`  Promedio clientes:         ${promC}`)

// 3. Trials
console.log("\n=== TRIALS ===\n")
const trials = subs.filter((s) => s.status === "TRIALING")
console.log(`Trials totales: ${trials.length}`)

let activos = 0
let expirados = 0
let porVencer7 = 0
for (const t of trials) {
  const end = t.trial_end ? new Date(t.trial_end) : null
  if (!end) continue
  const diffDays = (end - now) / 86400000
  if (diffDays < 0) expirados++
  else {
    activos++
    if (diffDays <= 7) porVencer7++
  }
}
console.log(`  Activos:                ${activos}`)
console.log(`  Por vencer en 7 dias:   ${porVencer7}`)
console.log(`  Expirados sin downgrade: ${expirados}`)

// 4. Diagnostico
console.log("\n=== DIAGNOSTICO ===\n")

if (buckets.total < 20) {
  console.log("[!] TOP FUNNEL: <20 orgs totales. Problema marketing > problema plan.")
  console.log("    Foco: traer trafico (ads, SEO, contenido, referidos).")
}

if (eng.cero_ordenes_mes / Math.max(eng.total, 1) > 0.5) {
  console.log("[!] ONBOARDING ROTO: >50% Free no carga ordenes.")
  console.log("    Foco: wizard primera orden, demo data, video tutorial.")
}

if (eng.bloq_ordenes / Math.max(eng.total, 1) > 0.3 && buckets.pro_pagando === 0) {
  console.log("[!] PARED SIN CONVERSION: muchos bloqueados, nadie paga.")
  console.log("    Foco: modal upgrade contextual + CTA fuerte.")
}

if (porVencer7 > 0) {
  console.log(`[!] ${porVencer7} trials vencen en 7 dias. Mandar email urgencia.`)
}

if (buckets.canceled > buckets.pro_pagando) {
  console.log("[!] CHURN > VENTAS. Problema retencion, no adquisicion.")
}

function pct(a, b) {
  if (!b) return "0"
  return ((a / b) * 100).toFixed(0)
}
