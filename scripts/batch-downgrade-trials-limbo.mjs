#!/usr/bin/env node
// Batch one-shot: limpia subs TRIALING con trial_end vencido (limbo).
//
// Diferencia con el cron subscription-sweep:
//   - El cron solo procesa trials con > 7 días vencidos (grace window).
//   - Este script procesa TODOS los trials vencidos (regardless of grace days)
//     para limpiar la deuda histórica.
//
// Modo DRY-RUN por defecto. Para aplicar cambios pasar --execute.
//
// Uso:
//   node scripts/batch-downgrade-trials-limbo.mjs            # preview
//   node scripts/batch-downgrade-trials-limbo.mjs --execute  # aplicar
//
// Idempotente: si ya hay un subscription_history con
// reason='batch_cleanup_trial_limbo' para la sub, no se duplica.

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

const EXECUTE = process.argv.includes("--execute")
const sb = createClient(url, key)
const now = new Date()
const nowIso = now.toISOString()

console.log(`\nModo: ${EXECUTE ? "EXECUTE (aplica cambios)" : "DRY-RUN (solo preview)"}`)
console.log(`Now: ${nowIso}\n`)

// 1. Plan Free
const { data: freePlan, error: planErr } = await sb
  .from("plans")
  .select("id, nombre")
  .eq("slug", "free")
  .eq("activo", true)
  .maybeSingle()

if (planErr || !freePlan) {
  console.error("No se encontró plan Free activo:", planErr)
  process.exit(1)
}

console.log(`Plan Free destino: ${freePlan.nombre} (${freePlan.id})\n`)

// 2. Trials vencidos en limbo (status TRIALING + trial_end < now), excluyendo superadmin
const { data: limbo, error: selErr } = await sb
  .from("subscriptions")
  .select(`
    id, organization_id, plan_id, trial_end, payment_provider, current_period_end,
    organizations!inner ( nombre, slug, activo ),
    plans!inner ( nombre, slug, tipo )
  `)
  .eq("status", "TRIALING")
  .not("trial_end", "is", null)
  .lt("trial_end", nowIso)
  .neq("organizations.slug", "superadmin")

if (selErr) {
  console.error("Error select:", selErr)
  process.exit(1)
}

if (!limbo || limbo.length === 0) {
  console.log("Sin trials en limbo. Nada que limpiar.")
  process.exit(0)
}

console.log(`Trials en limbo detectados: ${limbo.length}\n`)

// Cargar histories existentes con reason='batch_cleanup_trial_limbo' para idempotencia
const subIds = limbo.map((s) => s.id)
const { data: existingHistory, error: histErr } = await sb
  .from("subscription_history")
  .select("subscription_id, details")
  .in("subscription_id", subIds)
  .eq("action", "DOWNGRADED")

if (histErr) {
  console.error("Warn: no pude leer subscription_history:", histErr.message)
}

const alreadyDone = new Set()
for (const h of existingHistory || []) {
  if (h.details && h.details.reason === "batch_cleanup_trial_limbo") {
    alreadyDone.add(h.subscription_id)
  }
}

console.log("=== Vista previa ===\n")
console.log(
  "  st  org-slug".padEnd(40) +
    " plan".padEnd(14) +
    " trial_end".padEnd(14) +
    " días venc."
)
console.log("  " + "-".repeat(74))

let pending = 0
let alreadyCount = 0

for (const sub of limbo) {
  const org = Array.isArray(sub.organizations) ? sub.organizations[0] : sub.organizations
  const plan = Array.isArray(sub.plans) ? sub.plans[0] : sub.plans
  const trialEndDate = sub.trial_end ? new Date(sub.trial_end) : null
  const daysExpired = trialEndDate
    ? Math.floor((now.getTime() - trialEndDate.getTime()) / 86400000)
    : null
  const ven = sub.trial_end?.split("T")[0] ?? "-"
  const activa = org?.activo ? "act" : "INA"
  const flag = alreadyDone.has(sub.id) ? "[SKIP]" : "[TODO]"
  if (alreadyDone.has(sub.id)) alreadyCount++
  else pending++

  console.log(
    `  ${flag} [${activa}] ${(org?.slug ?? "-").padEnd(28)} ${(plan?.nombre ?? "-").padEnd(13)} ${ven.padEnd(13)} ${daysExpired ?? "-"}d`
  )
}

console.log()
console.log(`Resumen: ${pending} pendientes, ${alreadyCount} ya hechos previamente.`)

if (!EXECUTE) {
  console.log("\nDRY-RUN. Para aplicar, ejecutar:")
  console.log("  node scripts/batch-downgrade-trials-limbo.mjs --execute\n")
  process.exit(0)
}

if (pending === 0) {
  console.log("\nNada nuevo que aplicar.")
  process.exit(0)
}

console.log("\n=== Ejecutando downgrades ===\n")

let ok = 0
let fails = 0

for (const sub of limbo) {
  if (alreadyDone.has(sub.id)) continue

  const org = Array.isArray(sub.organizations) ? sub.organizations[0] : sub.organizations

  const { error: upErr } = await sb
    .from("subscriptions")
    .update({
      plan_id: freePlan.id,
      status: "ACTIVE",
      trial_end: null,
      payment_provider: null,
      current_period_end: null,
      billing_period: null,
      updated_at: nowIso,
    })
    .eq("id", sub.id)

  if (upErr) {
    console.error(`  FAIL ${org?.slug}:`, upErr.message)
    fails++
    continue
  }

  await sb.from("subscription_history").insert({
    subscription_id: sub.id,
    organization_id: sub.organization_id,
    action: "DOWNGRADED",
    previous_status: "TRIALING",
    new_status: "ACTIVE",
    details: {
      reason: "batch_cleanup_trial_limbo",
      previous_plan_id: sub.plan_id,
      new_plan_id: freePlan.id,
      trial_end: sub.trial_end,
    },
    performed_by: "system:batch",
  })

  console.log(`  OK ${org?.slug} → Free`)
  ok++
}

console.log()
console.log(`Hecho: ${ok} downgrades aplicados, ${fails} fallos.`)
