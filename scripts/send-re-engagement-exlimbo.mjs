#!/usr/bin/env node
// One-shot: re-engage orgs que fueron bajadas a Free por el batch
// `batch_cleanup_trial_limbo`. Les avisa que están en Free y que pueden
// volver al Profesional o pedir un trial extendido.
//
// Modo DRY-RUN por defecto. Pasar --execute para enviar emails reales.
//
// Uso:
//   node scripts/send-re-engagement-exlimbo.mjs            # preview
//   node scripts/send-re-engagement-exlimbo.mjs --execute  # enviar
//
// Idempotente: si ya existe lifecycle_emails para esa org con
// email_type='WIN_BACK_EXLIMBO' y status='SENT', se salta.

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

console.log(`\nModo: ${EXECUTE ? "EXECUTE (envía emails)" : "DRY-RUN (solo preview)"}`)
console.log(`ROOT_DOMAIN: ${ROOT_DOMAIN}`)
console.log(`EMAIL_FROM: ${EMAIL_FROM}`)
console.log(`Envialosimple API key: ${apiKey ? "presente" : "FALTA"}\n`)

const ENVIALOSIMPLE_API_URL = "https://backend.envialosimple.email/api/v1/mail/send"
const EMAIL_TYPE = "WIN_BACK_EXLIMBO"

// 0. KILL SWITCH — chequear que el template WIN_BACK_EXLIMBO esté PUBLISHED en DB.
// Si está en DRAFT, abortar antes de hacer cualquier query/envío.
const { data: tplRow, error: tplErr } = await sb
  .from("email_templates")
  .select("status, subject, html_body")
  .eq("type", EMAIL_TYPE)
  .maybeSingle()

if (tplErr) {
  console.error(`Error leyendo email_templates para ${EMAIL_TYPE}:`, tplErr.message)
  process.exit(1)
}

if (!tplRow) {
  console.error(
    `\nPlantilla ${EMAIL_TYPE} no existe en email_templates. ` +
    `Corré la migración 188_email_templates.sql antes de ejecutar este script.\n`
  )
  process.exit(1)
}

if (tplRow.status !== "PUBLISHED") {
  console.error(
    `\nPlantilla ${EMAIL_TYPE} está en estado=${tplRow.status}. ` +
    `Publicala primero desde el panel superadmin (Lifecycle Emails → Editar → Publicar) ` +
    `antes de ejecutar este script. ABORTANDO.\n`
  )
  process.exit(1)
}

// Decidir si usar cuerpo de DB (con interpolación) o fallback hardcoded del script.
const dbBodyAvailable = !!(tplRow.html_body && tplRow.html_body.trim() !== "")
if (dbBodyAvailable) {
  console.log(`Template DB en estado PUBLISHED con cuerpo custom — se usará ese cuerpo.\n`)
} else {
  console.log(`Template DB en PUBLISHED pero sin cuerpo custom — se usará fallback hardcoded del script.\n`)
}

function interpolate(input, data) {
  return String(input).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key) => {
    const parts = key.split(".")
    let cur = data
    for (const p of parts) {
      if (cur && typeof cur === "object" && p in cur) cur = cur[p]
      else return ""
    }
    return cur == null ? "" : String(cur)
  })
}

// 1. Buscar subscription_history con reason='batch_cleanup_trial_limbo'.
// Tomamos las organization_id distintas.
const { data: history, error: histErr } = await sb
  .from("subscription_history")
  .select("organization_id, details")
  .eq("action", "DOWNGRADED")
  .eq("performed_by", "system:batch")

if (histErr) {
  console.error("Error leyendo subscription_history:", histErr)
  process.exit(1)
}

const orgIdsFromHistory = new Set()
for (const h of history || []) {
  if (h?.details?.reason === "batch_cleanup_trial_limbo" && h.organization_id) {
    orgIdsFromHistory.add(h.organization_id)
  }
}

if (orgIdsFromHistory.size === 0) {
  console.log("No hay orgs con downgrade batch_cleanup_trial_limbo. Nada que hacer.")
  process.exit(0)
}

const orgIds = Array.from(orgIdsFromHistory)
console.log(`Orgs detectadas con downgrade ex-limbo: ${orgIds.length}\n`)

// 2. Cargar orgs (excluir superadmin).
const { data: orgs, error: orgErr } = await sb
  .from("organizations")
  .select("id, nombre, slug, email, activo")
  .in("id", orgIds)
  .neq("slug", "superadmin")

if (orgErr) {
  console.error("Error cargando organizations:", orgErr)
  process.exit(1)
}

// 3. Cargar lifecycle_emails ya enviados de este tipo (idempotencia).
const { data: already, error: alreadyErr } = await sb
  .from("lifecycle_emails")
  .select("organization_id")
  .in("organization_id", orgIds)
  .eq("email_type", EMAIL_TYPE)
  .eq("status", "SENT")

if (alreadyErr) {
  console.warn("Warn: no pude leer lifecycle_emails:", alreadyErr.message)
}

const alreadySentSet = new Set((already || []).map((r) => r.organization_id))

// 4. Cargar admins de esas orgs (rol=ADMIN, el más antiguo con email).
const { data: admins, error: admErr } = await sb
  .from("users")
  .select("id, nombre, email, organization_id, created_at")
  .in("organization_id", orgIds)
  .eq("rol", "ADMIN")
  .order("created_at", { ascending: true })

if (admErr) {
  console.error("Error cargando admins:", admErr)
  process.exit(1)
}

const adminByOrg = new Map()
for (const a of admins || []) {
  if (!a.email) continue
  if (!adminByOrg.has(a.organization_id)) {
    adminByOrg.set(a.organization_id, a)
  }
}

// 5. Armar lista de envío.
const toSend = []
const skipped = []

for (const org of orgs || []) {
  if (alreadySentSet.has(org.id)) {
    skipped.push({ org, reason: "ya enviado" })
    continue
  }
  const admin = adminByOrg.get(org.id)
  const email = admin?.email || org.email
  if (!email) {
    skipped.push({ org, reason: "sin email" })
    continue
  }
  toSend.push({
    org,
    email,
    nombre: admin?.nombre || org.nombre || "amigo",
    userId: admin?.id || null,
  })
}

console.log("=== Vista previa ===\n")
console.log("  org-slug".padEnd(34) + " activa".padEnd(8) + " email")
console.log("  " + "-".repeat(74))
for (const item of toSend) {
  const activa = item.org.activo ? "act" : "INA"
  console.log(`  ${(item.org.slug ?? "-").padEnd(32)} ${activa.padEnd(7)} ${item.email}`)
}

if (skipped.length > 0) {
  console.log("\n=== Saltados ===")
  for (const s of skipped) {
    console.log(`  ${(s.org.slug ?? "-").padEnd(32)} ${s.reason}`)
  }
}

console.log(`\nResumen: ${toSend.length} a enviar, ${skipped.length} saltados.`)

if (!EXECUTE) {
  console.log("\nDRY-RUN. Para enviar, ejecutar:")
  console.log("  node scripts/send-re-engagement-exlimbo.mjs --execute\n")
  process.exit(0)
}

if (toSend.length === 0) {
  console.log("\nNada que enviar.")
  process.exit(0)
}

if (!apiKey) {
  console.error("\nFalta ENVIALOSIMPLE_API_KEY para enviar emails.")
  process.exit(1)
}

console.log("\n=== Enviando ===\n")

let ok = 0
let fails = 0

for (const item of toSend) {
  const appUrl = item.org.slug
    ? `https://${item.org.slug}.${ROOT_DOMAIN}`
    : `https://${ROOT_DOMAIN}`
  const reactivarUrl = `https://${ROOT_DOMAIN}/reactivar`

  let subject
  let html
  if (dbBodyAvailable) {
    const data = {
      nombre: item.nombre,
      organizacion: item.org.nombre || "",
      slug: item.org.slug || "",
      appUrl,
      reactivarUrl,
    }
    subject = interpolate(tplRow.subject || "", data)
    html = interpolate(tplRow.html_body, data)
  } else {
    const built = buildExlimboEmail({
      nombre: item.nombre,
      slug: item.org.slug,
      rootDomain: ROOT_DOMAIN,
    })
    subject = built.subject
    html = built.html
  }

  let sent = false
  try {
    const res = await fetch(ENVIALOSIMPLE_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: EMAIL_FROM, to: item.email, subject, html }),
    })
    sent = res.ok
    if (!res.ok) {
      const errBody = await res.text().catch(() => "")
      console.error(`  FAIL ${item.org.slug} (${res.status}): ${errBody.slice(0, 200)}`)
    }
  } catch (err) {
    console.error(`  ERROR ${item.org.slug}:`, err?.message || err)
    sent = false
  }

  const { error: logErr } = await sb.from("lifecycle_emails").insert({
    organization_id: item.org.id,
    user_id: item.userId,
    email_type: EMAIL_TYPE,
    status: sent ? "SENT" : "FAILED",
  })
  if (logErr) {
    console.error(`  log warn ${item.org.slug}:`, logErr.message)
  }

  if (sent) {
    ok++
    console.log(`  OK ${item.org.slug} → ${item.email}`)
  } else {
    fails++
  }
}

console.log()
console.log(`Hecho: ${ok} enviados, ${fails} fallos.`)

// ============================================
// Email template: WIN_BACK_EXLIMBO
// Gradient calmo azul/indigo. Tono amable, no desesperado.
// ============================================
function buildExlimboEmail({ nombre, slug, rootDomain }) {
  const appUrl = slug
    ? `https://${slug}.${rootDomain}`
    : `https://${rootDomain}`
  const reactivarUrl = `https://${rootDomain}/reactivar`

  const subject = "Tu prueba terminó — bajamos tu cuenta a Free (tus datos siguen ahí)"
  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f3f4f6;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;"><tr><td align="center" style="padding:40px 20px;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">
<tr><td style="background:linear-gradient(135deg,#4f46e5,#3b82f6);padding:32px 40px;text-align:center;border-radius:16px 16px 0 0;">
<table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>
<td style="vertical-align:middle;padding-right:10px;"><img src="https://${rootDomain}/icon-192.png" style="height:36px;width:36px;border-radius:8px;" alt="" /></td>
<td style="vertical-align:middle;"><span style="color:#fff;font-size:24px;font-weight:700;">STApp</span></td>
</tr></table></td></tr>
<tr><td style="background:#fff;padding:40px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 16px 16px;">
<h1 style="color:#1f2937;font-size:24px;font-weight:700;text-align:center;margin:0 0 16px;">Tu prueba terminó, pero tu cuenta sigue activa</h1>
<p style="color:#4b5563;font-size:16px;text-align:center;margin:0 0 20px;">Hola <strong>${escapeHtml(nombre)}</strong>, tu prueba de 30 días en STApp ya venció. Para que no pierdas el acceso, te dejamos en el <strong>plan Free</strong> (gratis, sin tarjeta).</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;"><tr>
<td style="background:#eef2ff;padding:20px;border-radius:12px;border:1px solid #c7d2fe;">
<p style="color:#3730a3;font-size:15px;margin:0 0 8px;font-weight:600;">Tus clientes, órdenes, inventario y configuraciones siguen exactamente como los dejaste.</p>
<p style="color:#4338ca;font-size:14px;margin:0;">No tenés que migrar nada. Entrás y todo está ahí.</p>
</td></tr></table>
<p style="color:#4b5563;font-size:15px;margin:0 0 8px;font-weight:600;">El plan Free incluye:</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
<tr><td style="color:#4b5563;font-size:15px;padding:4px 0;">• 30 órdenes por mes</td></tr>
<tr><td style="color:#4b5563;font-size:15px;padding:4px 0;">• 200 clientes</td></tr>
<tr><td style="color:#4b5563;font-size:15px;padding:4px 0;">• Punto de Venta (POS)</td></tr>
<tr><td style="color:#4b5563;font-size:15px;padding:4px 0;">• Cotizaciones</td></tr>
<tr><td style="color:#4b5563;font-size:15px;padding:4px 0;">• Portal de seguimiento para tus clientes</td></tr>
</table>
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:8px 0 16px;">
<a href="${appUrl}" style="background:#4f46e5;color:#fff;padding:16px 32px;text-decoration:none;border-radius:10px;font-weight:600;font-size:16px;display:inline-block;">Volver a STApp</a>
</td></tr></table>
<p style="color:#4b5563;font-size:14px;text-align:center;margin:16px 0 8px;">¿Querés WhatsApp, reportes avanzados, múltiples usuarios y más?</p>
<p style="color:#6b7280;font-size:14px;text-align:center;margin:0 0 16px;"><a href="${reactivarUrl}" style="color:#4f46e5;text-decoration:underline;font-weight:600;">Reactivar Profesional 7 días gratis</a></p>
<p style="color:#9ca3af;font-size:13px;text-align:center;margin:24px 0 0;">Sin tarjeta. Sin permanencia. Si no activás, seguís en Free.</p>
</td></tr>
<tr><td style="padding:24px 40px;text-align:center;"><p style="color:#9ca3af;font-size:13px;margin:0;">Este correo fue enviado automáticamente por STApp.</p></td></tr>
</table></td></tr></table></body></html>`
  return { subject, html }
}

function escapeHtml(s) {
  if (s == null) return ""
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}
