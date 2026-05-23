#!/usr/bin/env node
// Audita webhooks MP recibidos + pagos registrados.
// Solo SELECT.

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
  console.error("Falta env vars Supabase")
  process.exit(1)
}

const sb = createClient(url, key)

console.log("\n=== WEBHOOK EVENTS (ultimos 30 dias) ===\n")

const cutoff = new Date(Date.now() - 30 * 86400000).toISOString()

const { data: events, error: e1 } = await sb
  .from("webhook_events")
  .select("provider, status, event_type, error_message, created_at, signature_valid")
  .gte("created_at", cutoff)
  .order("created_at", { ascending: false })

if (e1) {
  console.error("Error consultando webhook_events:", e1)
  console.log("(Tal vez tabla no existe o RLS bloquea)")
} else {
  if (!events || events.length === 0) {
    console.log("[!] CERO webhooks recibidos en 30 dias.")
    console.log("    MP nunca llamo al endpoint. Causas posibles:")
    console.log("    1. Notification URL no configurada en MP dashboard")
    console.log("    2. NEXTAUTH_URL en Vercel apunta a localhost o URL inválida")
    console.log("    3. Nadie inicio checkout real")
  } else {
    const byProvider = {}
    const byStatus = {}
    const errors = []
    for (const ev of events) {
      byProvider[ev.provider] = (byProvider[ev.provider] || 0) + 1
      byStatus[ev.status] = (byStatus[ev.status] || 0) + 1
      if (ev.status === "ERROR" || ev.status === "INVALID_SIGNATURE") {
        errors.push(ev)
      }
    }
    console.log("Por provider:", byProvider)
    console.log("Por status:", byStatus)
    console.log(`Total: ${events.length}`)
    if (errors.length) {
      console.log("\n[!] Errores recientes:")
      for (const e of errors.slice(0, 10)) {
        console.log(`  ${e.created_at} ${e.provider} ${e.status} ${e.event_type ?? ""} ${e.error_message ?? ""}`)
      }
    }
  }
}

console.log("\n=== SUBSCRIPTION_PAYMENTS (ultimos 30 dias) ===\n")

const { data: pays, error: e2 } = await sb
  .from("subscription_payments")
  .select("payment_provider, status, amount, currency, paid_at")
  .gte("paid_at", cutoff)
  .order("paid_at", { ascending: false })

if (e2) {
  console.error("Error consultando subscription_payments:", e2)
} else {
  if (!pays || pays.length === 0) {
    console.log("[!] CERO pagos registrados en 30 dias.")
  } else {
    console.log(`Total: ${pays.length}`)
    const byProv = {}
    for (const p of pays) {
      const key = `${p.payment_provider}/${p.status}`
      byProv[key] = (byProv[key] || 0) + 1
    }
    console.log("Por provider/status:", byProv)
    console.log("\nUltimos 5:")
    for (const p of pays.slice(0, 5)) {
      console.log(`  ${p.paid_at} ${p.payment_provider} ${p.status} ${p.amount} ${p.currency}`)
    }
  }
}

console.log("\n=== TRIAL ENDING SOON ===\n")

const in7days = new Date(Date.now() + 7 * 86400000).toISOString()
const now = new Date().toISOString()

const { data: trials } = await sb
  .from("subscriptions")
  .select("organization_id, trial_end, organizations(nombre, email)")
  .eq("status", "TRIALING")
  .gte("trial_end", now)
  .lte("trial_end", in7days)
  .order("trial_end", { ascending: true })

if (!trials || trials.length === 0) {
  console.log("Ninguno por vencer en 7 dias")
} else {
  console.log(`${trials.length} trials vencen en proximos 7 dias:`)
  for (const t of trials) {
    const days = Math.ceil((new Date(t.trial_end) - new Date()) / 86400000)
    console.log(`  ${days}d  ${t.organizations?.nombre ?? "?"} (${t.organizations?.email ?? "sin email"})`)
  }
}
