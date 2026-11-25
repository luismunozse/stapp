#!/usr/bin/env node
// Consulta el registro central de errores (tabla error_logs). Solo lectura.
//
// Uso:
//   node scripts/errores-recientes.mjs              # resumen de las últimas 24 h
//   node scripts/errores-recientes.mjs 72           # resumen de las últimas 72 h
//   node scripts/errores-recientes.mjs E-4F7K2Q     # detalle del código que pasó el taller
//
// Variables (de .env.production.local, .env.vercel, .env.local o .env):
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

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}
const sb = createClient(url, key)
const arg = process.argv[2]

if (arg && /^E-/i.test(arg)) {
  const { data, error } = await sb
    .from("error_logs")
    .select("*")
    .or(`ref.eq.${arg.toUpperCase()},digest.eq.${arg}`)
    .order("occurred_at", { ascending: false })
    .limit(5)
  if (error) {
    console.error("Error consultando error_logs:", error.message)
    process.exit(1)
  }
  if (!data.length) {
    console.log(`No hay ningún error con el código ${arg}.`)
    process.exit(0)
  }
  for (const e of data) {
    const { count } = await sb
      .from("error_logs")
      .select("id", { count: "exact", head: true })
      .eq("fingerprint", e.fingerprint)
    console.log(`\n=== ${e.ref} · ${e.occurred_at} ===`)
    console.log(`Origen:   ${e.source} ${e.method ?? ""} ${e.route ?? ""}`)
    console.log(`Taller:   ${e.organization_id ?? "-"} (${e.tenant_slug ?? "-"})  Usuario: ${e.user_id ?? "-"}`)
    console.log(`Mensaje:  ${e.message}`)
    console.log(`Veces que pasó este mismo error: ${count ?? "?"}`)
    if (e.context) console.log(`Contexto: ${JSON.stringify(e.context)}`)
    if (e.stack) console.log(`\n${e.stack}`)
  }
  process.exit(0)
}

const horas = Number(arg) || 24
const desde = new Date(Date.now() - horas * 3600000).toISOString()
const { data, error } = await sb
  .from("error_logs")
  .select("ref, occurred_at, source, method, route, message, fingerprint, organization_id")
  .gte("occurred_at", desde)
  .order("occurred_at", { ascending: false })
  .limit(5000)
if (error) {
  console.error("Error consultando error_logs:", error.message)
  process.exit(1)
}

const grupos = new Map()
for (const e of data) {
  const g = grupos.get(e.fingerprint) ?? { veces: 0, talleres: new Set(), ultimo: e }
  g.veces++
  if (e.organization_id) g.talleres.add(e.organization_id)
  grupos.set(e.fingerprint, g)
}

console.log(`\nErrores en las últimas ${horas} h: ${data.length} (${grupos.size} distintos)\n`)
console.table(
  [...grupos.values()]
    .sort((a, b) => b.veces - a.veces)
    .slice(0, 40)
    .map((g) => ({
      veces: g.veces,
      talleres: g.talleres.size,
      origen: `${g.ultimo.source} ${g.ultimo.method ?? ""} ${g.ultimo.route ?? ""}`.trim().slice(0, 50),
      mensaje: g.ultimo.message.slice(0, 80),
      ultimo: g.ultimo.occurred_at.slice(0, 16).replace("T", " "),
      codigo: g.ultimo.ref,
    }))
)
console.log("Detalle de uno: node scripts/errores-recientes.mjs <codigo>\n")
