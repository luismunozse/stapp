#!/usr/bin/env node
// Backfill: copia email del admin (rol=ADMIN, el más antiguo por created_at)
// a organizations.email cuando organizations.email IS NULL.
//
// Modo DRY-RUN por defecto. Pasar --execute para aplicar.
//
// Uso:
//   node scripts/backfill-org-emails.mjs            # preview
//   node scripts/backfill-org-emails.mjs --execute  # aplicar

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

console.log(`\nModo: ${EXECUTE ? "EXECUTE (aplica cambios)" : "DRY-RUN (solo preview)"}\n`)

// 1. Orgs con email NULL (excluyendo superadmin)
const { data: orgs, error: orgErr } = await sb
  .from("organizations")
  .select("id, nombre, slug, email, activo, created_at")
  .is("email", null)
  .neq("slug", "superadmin")
  .order("created_at", { ascending: true })

if (orgErr) {
  console.error("Error consultando organizations:", orgErr)
  process.exit(1)
}

if (!orgs || orgs.length === 0) {
  console.log("No hay orgs con email NULL. Nada que backfillear.")
  process.exit(0)
}

console.log(`Orgs con email NULL: ${orgs.length}\n`)

const orgIds = orgs.map((o) => o.id)

// 2. Todos los admins de esas orgs
const { data: admins, error: admErr } = await sb
  .from("users")
  .select("id, nombre, email, organization_id, created_at")
  .in("organization_id", orgIds)
  .eq("rol", "ADMIN")
  .order("created_at", { ascending: true })

if (admErr) {
  console.error("Error consultando users:", admErr)
  process.exit(1)
}

// Mapa: orgId -> admin más antiguo con email no vacío
const adminByOrg = new Map()
for (const a of admins || []) {
  if (!a.email) continue
  if (!adminByOrg.has(a.organization_id)) {
    adminByOrg.set(a.organization_id, a)
  }
}

console.log("=== Vista previa ===\n")
console.log(
  "  org-slug".padEnd(34) +
    " activa".padEnd(8) +
    " admin email"
)
console.log("  " + "-".repeat(70))

const toUpdate = []
const noAdmin = []

for (const org of orgs) {
  const admin = adminByOrg.get(org.id)
  const activa = org.activo ? "act" : "INA"
  if (admin && admin.email) {
    toUpdate.push({ org, admin })
    console.log(`  ${(org.slug ?? "-").padEnd(32)} ${activa.padEnd(7)} ${admin.email}`)
  } else {
    noAdmin.push(org)
    console.log(`  ${(org.slug ?? "-").padEnd(32)} ${activa.padEnd(7)} [NO ADMIN FOUND]`)
  }
}

console.log()
console.log(`Resumen: ${toUpdate.length} actualizables, ${noAdmin.length} sin admin.`)

if (!EXECUTE) {
  console.log("\nDRY-RUN. Para aplicar, ejecutar:")
  console.log("  node scripts/backfill-org-emails.mjs --execute\n")
  process.exit(0)
}

if (toUpdate.length === 0) {
  console.log("\nNada que aplicar.")
  process.exit(0)
}

console.log("\n=== Aplicando ===\n")

let ok = 0
let fails = 0

for (const { org, admin } of toUpdate) {
  // Re-check idempotencia: leer el email actual (otro proceso podría haberlo cambiado)
  const { data: current } = await sb
    .from("organizations")
    .select("email")
    .eq("id", org.id)
    .maybeSingle()

  if (current?.email) {
    console.log(`  SKIP ${org.slug} (ya tiene email=${current.email})`)
    continue
  }

  const { error: upErr } = await sb
    .from("organizations")
    .update({ email: admin.email })
    .eq("id", org.id)
    .is("email", null)

  if (upErr) {
    console.error(`  FAIL ${org.slug}:`, upErr.message)
    fails++
    continue
  }
  console.log(`  OK ${org.slug} → ${admin.email}`)
  ok++
}

console.log()
console.log(`Hecho: ${ok} aplicados, ${fails} fallos, ${noAdmin.length} sin admin (manual review).`)
