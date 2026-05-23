#!/usr/bin/env node
// One-shot: GHOST email — orgs con cuenta >30 días sin ningún registro
// (sin ordenes, sin clientes, sin ventas). Les ofrecemos ayuda para empezar.
//
// Requiere que la plantilla GHOST exista en email_templates con status='PUBLISHED'
// y html_body no vacío. Si está en DRAFT, aborta con mensaje claro para que
// el user la edite + publique desde superadmin antes de ejecutar.
//
// Modo DRY-RUN por defecto. --execute para enviar.

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
const apiKey = process.env.ENVIALOSIMPLE_API_KEY
const EMAIL_FROM = process.env.EMAIL_FROM || "noreply@stapp.com.ar"
const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "stapp.com.ar"

if (!url || !key) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

const EXECUTE = process.argv.includes("--execute")
const sb = createClient(url, key)
const now = Date.now()
const DAY = 86400000

console.log(`\nModo: ${EXECUTE ? "EXECUTE (envía emails)" : "DRY-RUN (solo preview)"}`)

// 1. Verificar plantilla GHOST PUBLISHED + body no vacío
const { data: tpl, error: tplErr } = await sb
  .from("email_templates")
  .select("type, subject, html_body, status")
  .eq("type", "GHOST")
  .maybeSingle()

if (tplErr || !tpl) {
  console.error("ERROR: no existe la fila email_templates type='GHOST'. Aplicá la migration 188_email_templates.sql.")
  process.exit(1)
}

if (tpl.status !== "PUBLISHED") {
  console.error(`ABORT: plantilla GHOST en status='${tpl.status}'.`)
  console.error("Entrá a Superadmin → Lifecycle Emails → GHOST → editá subject + cuerpo → Publicar.")
  process.exit(1)
}

if (!tpl.html_body || tpl.html_body.trim() === "") {
  console.error("ABORT: plantilla GHOST está PUBLISHED pero html_body vacío.")
  console.error("Entrá a Superadmin → Lifecycle Emails → GHOST → editá cuerpo → Guardar → Publicar.")
  process.exit(1)
}

console.log(`Plantilla GHOST OK (PUBLISHED, ${tpl.html_body.length} chars)`)

// 2. Detectar GHOST orgs: cuenta >30 días, 0 ordenes + 0 clientes + 0 ventas
const { data: orgs } = await sb
  .from("organizations")
  .select("id, slug, nombre, email, activo, created_at")
  .eq("activo", true)
  .neq("slug", "superadmin")

if (!orgs || orgs.length === 0) {
  console.log("No hay orgs.")
  process.exit(0)
}

const orgIds = orgs.map((o) => o.id)

async function hasAnyIn(table) {
  const map = new Set()
  const { data } = await sb.from(table).select("organization_id").in("organization_id", orgIds)
  for (const r of data || []) map.add(r.organization_id)
  return map
}

const [orgsWithOrders, orgsWithClients, orgsWithSales] = await Promise.all([
  hasAnyIn("ordenes_servicio"),
  hasAnyIn("clientes"),
  hasAnyIn("ventas"),
])

const ghosts = orgs.filter((o) => {
  const age = (now - new Date(o.created_at).getTime()) / DAY
  if (age < 30) return false
  return (
    !orgsWithOrders.has(o.id) &&
    !orgsWithClients.has(o.id) &&
    !orgsWithSales.has(o.id)
  )
})

console.log(`\nGHOST detectados: ${ghosts.length}`)

// 3. Filter: ya enviado?
const { data: prevSends } = await sb
  .from("lifecycle_emails")
  .select("organization_id")
  .eq("email_type", "GHOST")
  .eq("status", "SENT")
  .in("organization_id", ghosts.map((g) => g.id))

const alreadySent = new Set((prevSends || []).map((r) => r.organization_id))

const toSend = ghosts.filter((g) => !alreadySent.has(g.id))
console.log(`Ya enviados: ${alreadySent.size}. Pendientes: ${toSend.length}`)

// 4. Resolver email destinatario: admin user > org.email
const { data: admins } = await sb
  .from("users")
  .select("id, email, nombre, organization_id, created_at")
  .in("organization_id", toSend.map((o) => o.id))
  .eq("rol", "ADMIN")
  .order("created_at", { ascending: true })

const adminByOrg = new Map()
for (const a of admins || []) {
  if (!adminByOrg.has(a.organization_id)) adminByOrg.set(a.organization_id, a)
}

// 5. Preview
console.log("\n=== Preview ===")
for (const o of toSend) {
  const admin = adminByOrg.get(o.id)
  const email = admin?.email || o.email
  const age = Math.floor((now - new Date(o.created_at).getTime()) / DAY)
  console.log(`  [${EXECUTE ? "SEND" : "TODO"}] ${(o.slug || "?").padEnd(28)} age:${age}d  ${email || "(sin email)"}`)
}

if (!EXECUTE) {
  console.log(`\nDRY-RUN. Para enviar: node scripts/send-ghost-email.mjs --execute`)
  process.exit(0)
}

if (!apiKey) {
  console.error("Falta ENVIALOSIMPLE_API_KEY. No puedo enviar.")
  process.exit(1)
}

// 6. Interpolación + envío
function interpolate(str, vars) {
  return str.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const parts = key.split(".")
    let v = vars
    for (const p of parts) v = v?.[p]
    return v === undefined || v === null ? "" : String(v)
  })
}

let sent = 0
let failed = 0
let skipped = 0

console.log("\n=== Enviando ===")
for (const o of toSend) {
  const admin = adminByOrg.get(o.id)
  const email = admin?.email || o.email
  if (!email) {
    console.log(`  SKIP ${o.slug} - sin email`)
    skipped++
    continue
  }

  const accountAgeDays = Math.floor((now - new Date(o.created_at).getTime()) / DAY)
  const appUrl = `https://${o.slug}.${ROOT_DOMAIN}`
  const vars = {
    nombre: admin?.nombre || o.nombre || "",
    organizacion: o.nombre || "",
    slug: o.slug || "",
    accountAgeDays,
    appUrl,
  }

  const subject = interpolate(tpl.subject, vars)
  const html = interpolate(tpl.html_body, vars)

  try {
    const res = await fetch("https://backend.envialosimple.email/api/v1/mail/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: EMAIL_FROM, to: email, subject, html }),
    })

    const ok = res.ok
    await sb.from("lifecycle_emails").insert({
      organization_id: o.id,
      user_id: admin?.id || null,
      email_type: "GHOST",
      status: ok ? "SENT" : "FAILED",
    })

    if (ok) {
      console.log(`  OK ${o.slug} → ${email}`)
      sent++
    } else {
      const txt = await res.text()
      console.log(`  FAIL ${o.slug} → ${email}: ${txt.slice(0, 100)}`)
      failed++
    }
  } catch (e) {
    console.log(`  ERR ${o.slug}: ${e.message}`)
    failed++
  }
}

console.log(`\nHecho: ${sent} enviados, ${failed} fallos, ${skipped} sin email.`)
