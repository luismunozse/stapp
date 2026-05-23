// Engagement audit: por cada organizacion, ultima actividad y estado sugerido.
// Solo SELECT, sin escribir nada.

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

const now = Date.now()
const DAY = 86400000

// Pull orgs (skip superadmin)
const { data: orgs } = await sb
  .from("organizations")
  .select("id, slug, nombre, email, activo, created_at")
  .neq("slug", "superadmin")
  .order("created_at", { ascending: true })

if (!orgs) {
  console.error("No pude leer organizations")
  process.exit(1)
}

const orgIds = orgs.map(o => o.id)

// Bulk: ultima actividad por tabla
async function lastByOrg(table) {
  const { data } = await sb
    .from(table)
    .select("organization_id, created_at")
    .in("organization_id", orgIds)
    .order("created_at", { ascending: false })
  const map = new Map()
  for (const r of data || []) if (!map.has(r.organization_id)) map.set(r.organization_id, r.created_at)
  return map
}

const [ordenes, ventas, clientes] = await Promise.all([
  lastByOrg("ordenes_servicio"),
  lastByOrg("ventas"),
  lastByOrg("clientes"),
])

// Counts por org
async function countByOrg(table) {
  const map = new Map()
  for (const id of orgIds) map.set(id, 0)
  const { data } = await sb.from(table).select("organization_id").in("organization_id", orgIds)
  for (const r of data || []) map.set(r.organization_id, (map.get(r.organization_id) || 0) + 1)
  return map
}

const [cntOrdenes, cntClientes, cntVentas] = await Promise.all([
  countByOrg("ordenes_servicio"),
  countByOrg("clientes"),
  countByOrg("ventas"),
])

const buckets = { ACTIVE: 0, IDLE: 0, DORMANT: 0, ARCHIVABLE: 0, GHOST: 0 }
const rows = []

for (const o of orgs) {
  const orgId = o.id
  const lastDates = [ordenes.get(orgId), ventas.get(orgId), clientes.get(orgId), o.created_at].filter(Boolean)
  const lastActivity = lastDates.length ? Math.max(...lastDates.map(d => new Date(d).getTime())) : new Date(o.created_at).getTime()
  const daysIdle = Math.floor((now - lastActivity) / DAY)
  const accountAgeDays = Math.floor((now - new Date(o.created_at).getTime()) / DAY)
  const totalOrdenes = cntOrdenes.get(orgId) || 0
  const totalClientes = cntClientes.get(orgId) || 0
  const totalVentas = cntVentas.get(orgId) || 0
  const totalRecords = totalOrdenes + totalClientes + totalVentas

  let status
  if (totalRecords === 0 && accountAgeDays >= 30) {
    status = "GHOST" // nunca creo nada y cuenta vieja
  } else if (daysIdle <= 30) {
    status = "ACTIVE"
  } else if (daysIdle <= 60) {
    status = "IDLE"
  } else if (daysIdle <= 180) {
    status = "DORMANT"
  } else {
    status = "ARCHIVABLE"
  }
  buckets[status]++

  rows.push({ slug: o.slug, nombre: o.nombre, email: o.email, daysIdle, accountAgeDays, totalOrdenes, totalClientes, totalVentas, status, activo: o.activo })
}

console.log("\n=== ENGAGEMENT AUDIT ===\n")
console.log(`Total orgs (sin superadmin): ${orgs.length}\n`)

console.log("DISTRIBUCION:")
for (const [k, v] of Object.entries(buckets)) {
  const pct = ((v / orgs.length) * 100).toFixed(0)
  console.log(`  ${k.padEnd(12)} ${v.toString().padStart(3)} (${pct}%)`)
}

console.log("\nLEYENDA:")
console.log("  ACTIVE     <= 30 dias sin actividad")
console.log("  IDLE       31-60 dias")
console.log("  DORMANT    61-180 dias")
console.log("  ARCHIVABLE >180 dias")
console.log("  GHOST      cuenta >30d sin NINGUN registro (orden/cliente/venta)")

console.log("\n=== GHOST (nunca usaron) ===\n")
const ghosts = rows.filter(r => r.status === "GHOST").sort((a, b) => b.accountAgeDays - a.accountAgeDays)
for (const r of ghosts) {
  console.log(`  ${r.accountAgeDays.toString().padStart(4)}d  ${(r.slug || "?").padEnd(30)} ${(r.nombre || "").padEnd(35)} ${r.email || "(sin email)"}`)
}

console.log("\n=== ARCHIVABLE (>180d sin actividad pero crearon algo) ===\n")
const archivables = rows.filter(r => r.status === "ARCHIVABLE").sort((a, b) => b.daysIdle - a.daysIdle)
for (const r of archivables) {
  console.log(`  ${r.daysIdle.toString().padStart(4)}d  ${(r.slug || "?").padEnd(30)} O:${r.totalOrdenes} C:${r.totalClientes} V:${r.totalVentas}  ${r.email || "(sin email)"}`)
}

console.log("\n=== DORMANT (61-180d) ===\n")
const dormants = rows.filter(r => r.status === "DORMANT").sort((a, b) => b.daysIdle - a.daysIdle)
for (const r of dormants) {
  console.log(`  ${r.daysIdle.toString().padStart(4)}d  ${(r.slug || "?").padEnd(30)} O:${r.totalOrdenes} C:${r.totalClientes} V:${r.totalVentas}  ${r.email || "(sin email)"}`)
}

console.log("\n=== RECOMENDACION ===\n")
console.log(`GHOST (${ghosts.length}): considera enviar email "tu cuenta sigue vacia, te ayudamos a empezar?". NO borrar — quizas se olvidaron.`)
console.log(`DORMANT (${dormants.length}): email re-engagement (ya tenes el cron /api/cron/re-engagement). Bajarles activo=false despues de 90d sin click.`)
console.log(`ARCHIVABLE (${archivables.length}): activo=false + email "te archivamos, click para revivir". Mantener data 12 meses, despues hard delete con aviso.`)
