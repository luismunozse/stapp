#!/usr/bin/env node
// Cruza los pagos APROBADOS de MercadoPago con subscription_payments y lista
// los que nunca impactaron en la plataforma (el aviso no llegó al webhook).
//
// Solo lectura: no toca MercadoPago ni la base.
//
// Uso:
//   node scripts/mp-pagos-sin-registrar.mjs            # últimos 90 días
//   node scripts/mp-pagos-sin-registrar.mjs 180        # últimos 180 días
//
// Variables (de .env.production.local, .env.vercel, .env.local o .env):
//   MERCADOPAGO_ACCESS_TOKEN (el de producción, APP_USR-...)
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "@supabase/supabase-js"
import { readFileSync, existsSync } from "node:fs"

function loadEnv(path) {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
    if (!m) continue
    const val = m[2].trim().replace(/^['"]|['"]$/g, "").trim()
    if (process.env[m[1]] === undefined) process.env[m[1]] = val
  }
}
for (const f of [".env.production.local", ".env.vercel", ".env.local", ".env"]) loadEnv(f)

const token = process.env.MERCADOPAGO_ACCESS_TOKEN
const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!token || !sbUrl || !sbKey) {
  console.error("Faltan MERCADOPAGO_ACCESS_TOKEN, NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}
if (token.startsWith("TEST-")) {
  console.error("MERCADOPAGO_ACCESS_TOKEN es de prueba (TEST-...). Usá el de producción (APP_USR-...).")
  process.exit(1)
}

const dias = Number(process.argv[2]) || 90
const sb = createClient(sbUrl, sbKey)
const mp = (path) =>
  fetch(`https://api.mercadopago.com${path}`, { headers: { Authorization: `Bearer ${token}` } })

// ── 1. Pagos aprobados en MP ───────────────────────────────────────────────
const pagos = []
for (let offset = 0; ; offset += 100) {
  const qs = new URLSearchParams({
    status: "approved",
    range: "date_created",
    begin_date: `NOW-${dias}DAYS`,
    end_date: "NOW",
    sort: "date_created",
    criteria: "desc",
    limit: "100",
    offset: String(offset),
  })
  const res = await mp(`/v1/payments/search?${qs}`)
  if (!res.ok) {
    console.error(`Error buscando pagos en MP (${res.status}): ${(await res.text()).slice(0, 300)}`)
    process.exit(1)
  }
  const { results = [], paging = {} } = await res.json()
  pagos.push(...results)
  if (results.length < 100 || pagos.length >= (paging.total ?? 0)) break
}

// ── 2. Taller de cada pago (external_reference, o la adhesión si es recurrente)
const preapprovalCache = new Map()
async function refDePago(p) {
  try {
    const ref = JSON.parse(p.external_reference || "{}")
    if (ref.organization_id) return ref
  } catch {}
  const preId =
    p.metadata?.preapproval_id ||
    p.point_of_interaction?.transaction_data?.subscription_id ||
    p.subscription_id
  if (!preId) return {}
  if (!preapprovalCache.has(preId)) {
    const res = await mp(`/preapproval/${preId}`)
    let ref = {}
    if (res.ok) {
      try {
        ref = JSON.parse((await res.json()).external_reference || "{}")
      } catch {}
    }
    preapprovalCache.set(preId, ref)
  }
  return preapprovalCache.get(preId)
}

// ── 3. Cuáles ya están registrados ───────────────────────────────────────────
const ids = pagos.map((p) => String(p.id))
const registrados = new Set()
for (let i = 0; i < ids.length; i += 200) {
  const { data, error } = await sb
    .from("subscription_payments")
    .select("provider_payment_id")
    .eq("payment_provider", "MERCADOPAGO")
    .in("provider_payment_id", ids.slice(i, i + 200))
  if (error) {
    console.error("Error consultando subscription_payments:", error.message)
    process.exit(1)
  }
  for (const r of data) registrados.add(String(r.provider_payment_id))
}

const faltantes = []
const sinTaller = []
for (const p of pagos) {
  if (registrados.has(String(p.id))) continue
  const ref = await refDePago(p)
  const fila = {
    payment_id: String(p.id),
    fecha: (p.date_approved || p.date_created || "").slice(0, 10),
    monto: p.transaction_amount,
    tipo: p.point_of_interaction?.type || p.operation_type,
    org_id: ref.organization_id || null,
    plan: ref.plan_slug || null,
    periodo: ref.billing_period || null,
  }
  ;(fila.org_id ? faltantes : sinTaller).push(fila)
}

// ── 4. Nombre del taller y renovaciones manuales cerca de la fecha del pago ─
const orgIds = [...new Set(faltantes.map((f) => f.org_id))]
const nombres = new Map()
const manuales = new Map()
if (orgIds.length) {
  const { data: orgs } = await sb.from("organizations").select("id, nombre, slug").in("id", orgIds)
  for (const o of orgs ?? []) nombres.set(o.id, `${o.nombre} (${o.slug})`)
  const { data: man } = await sb
    .from("subscription_payments")
    .select("organization_id, paid_at")
    .in("organization_id", orgIds)
    .neq("payment_provider", "MERCADOPAGO")
  for (const m of man ?? []) {
    if (!manuales.has(m.organization_id)) manuales.set(m.organization_id, [])
    manuales.get(m.organization_id).push(new Date(m.paid_at))
  }
}
const SIETE_DIAS = 7 * 86400000
for (const f of faltantes) {
  f.taller = nombres.get(f.org_id) || f.org_id
  const t = new Date(f.fecha).getTime()
  f.renovacion_manual_cerca = (manuales.get(f.org_id) || []).some((d) => Math.abs(d - t) <= SIETE_DIAS)
    ? "SÍ"
    : "no"
}

// ── 5. Reporte ─────────────────────────────────────────────────────────────
console.log(`\nPagos aprobados en MP (últimos ${dias} días): ${pagos.length}`)
console.log(`Registrados en la plataforma:                 ${registrados.size}`)
console.log(`Sin registrar, con taller identificado:       ${faltantes.length}`)
console.log(`Sin registrar, sin taller (otros cobros):     ${sinTaller.length}\n`)

if (faltantes.length) {
  console.log("=== Pagos de talleres que NO impactaron ===")
  console.table(
    faltantes.map(({ payment_id, fecha, monto, taller, plan, periodo, renovacion_manual_cerca }) => ({
      payment_id,
      fecha,
      monto,
      taller,
      plan,
      periodo,
      renovacion_manual_cerca,
    }))
  )
  console.log(
    "renovacion_manual_cerca = SÍ: ya lo renovaste a mano dentro de ±7 días. Reconciliarlo\n" +
      "en SuperAdmin → Pagos EXTIENDE otro período encima: revisalo antes.\n" +
      "renovacion_manual_cerca = no: candidato a reconciliar con su Payment ID.\n"
  )
}

if (sinTaller.length) {
  console.log("=== Pagos sin taller identificable (probablemente no son de suscripciones) ===")
  console.table(sinTaller.map(({ payment_id, fecha, monto, tipo }) => ({ payment_id, fecha, monto, tipo })))
}
