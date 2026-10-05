#!/usr/bin/env node
// Distribución de medios de pago de las suscripciones cobradas por MercadoPago.
//
// SOLO LECTURA. No escribe en la base ni en MercadoPago.
//
// POR QUÉ EXISTE
//
// `subscription_payments` guarda el monto y el id del pago, pero no el medio.
// El webhook de MercadoPago tampoco lo trae: su body es `{type, data:{id}}` y
// los detalles hay que ir a buscarlos a la API. Sin este dato no se puede
// decidir si PreApproval (débito automático, exige tarjeta) puede reemplazar al
// checkout actual o tiene que convivir con él: quien paga en efectivo por
// Rapipago no puede tener débito automático.
//
// Uso:
//   node scripts/mp-medios-de-pago.mjs [meses]     # default: 6

import { readFileSync, existsSync } from "node:fs"

function loadEnv(path) {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
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
loadEnv(".env.local")
loadEnv(".env")

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const MP_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}
if (!MP_TOKEN) {
  console.error("Falta MERCADOPAGO_ACCESS_TOKEN")
  process.exit(1)
}

const meses = Number(process.argv[2]) || 6
const desde = new Date()
desde.setMonth(desde.getMonth() - meses)

// --- 1. Los pagos cobrados, desde Supabase por REST (no hace falta conexión directa) ---
const url =
  `${SUPABASE_URL}/rest/v1/subscription_payments` +
  `?select=provider_payment_id,amount,paid_at` +
  `&payment_provider=eq.MERCADOPAGO&status=eq.SUCCEEDED` +
  `&paid_at=gte.${desde.toISOString()}` +
  `&provider_payment_id=not.is.null&order=paid_at.desc`

const res = await fetch(url, {
  headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
})

if (!res.ok) {
  console.error("Error consultando Supabase:", res.status, await res.text())
  process.exit(1)
}

const pagos = await res.json()
console.log(`${pagos.length} pagos cobrados en los últimos ${meses} meses\n`)

// --- 2. El medio de pago de cada uno, desde MercadoPago ---
const porTipo = new Map()
const porMetodo = new Map()
const fallidos = []

for (const p of pagos) {
  const r = await fetch(`https://api.mercadopago.com/v1/payments/${p.provider_payment_id}`, {
    headers: { Authorization: `Bearer ${MP_TOKEN}` },
  })

  if (!r.ok) {
    fallidos.push({ id: p.provider_payment_id, status: r.status })
    continue
  }

  const pago = await r.json()
  const tipo = pago.payment_type_id || "desconocido"
  const metodo = pago.payment_method_id || "desconocido"

  const t = porTipo.get(tipo) || { pagos: 0, monto: 0 }
  t.pagos += 1
  t.monto += Number(p.amount) || 0
  porTipo.set(tipo, t)

  porMetodo.set(metodo, (porMetodo.get(metodo) || 0) + 1)
}

// --- 3. El resultado ---
const total = [...porTipo.values()].reduce((s, v) => s + v.pagos, 0)

console.log("Por tipo de medio:")
for (const [tipo, v] of [...porTipo.entries()].sort((a, b) => b[1].pagos - a[1].pagos)) {
  const pct = total ? Math.round((v.pagos / total) * 100) : 0
  // `ticket` es efectivo (Rapipago, Pago Fácil): NO admite débito automático.
  const nota = tipo === "ticket" ? "  <-- efectivo: no puede tener debito automatico" : ""
  console.log(`  ${tipo.padEnd(16)} ${String(v.pagos).padStart(3)} pagos  ${pct}%  $${v.monto.toLocaleString("es-AR")}${nota}`)
}

console.log("\nPor método:")
for (const [metodo, n] of [...porMetodo.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${metodo.padEnd(16)} ${n}`)
}

if (fallidos.length) {
  console.log(`\n${fallidos.length} pagos no se pudieron consultar en MercadoPago:`)
  for (const f of fallidos) console.log(`  ${f.id} (HTTP ${f.status})`)
}
