// Toggle precio Profesional: 1 ARS para test, 19999 ARS prod
// Uso: node scripts/toggle-profesional-price.mjs test  -> baja a $1
//      node scripts/toggle-profesional-price.mjs prod  -> restaura $19999

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

const mode = process.argv[2]
if (!["test", "prod"].includes(mode)) {
  console.error("Uso: node scripts/toggle-profesional-price.mjs test|prod")
  process.exit(1)
}

const PRICES = {
  test: { precio_mensual: 1, precio_anual: 1 },
  prod: { precio_mensual: 19999, precio_anual: 149999 },
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const { data: before } = await sb
  .from("plans")
  .select("slug, precio_mensual, precio_anual")
  .eq("slug", "profesional")
  .single()
console.log("ANTES:", before)

const { error } = await sb
  .from("plans")
  .update(PRICES[mode])
  .eq("slug", "profesional")

if (error) {
  console.error("Error:", error)
  process.exit(1)
}

const { data: after } = await sb
  .from("plans")
  .select("slug, precio_mensual, precio_anual")
  .eq("slug", "profesional")
  .single()
console.log("DESPUES:", after)
console.log(`\nModo ${mode} aplicado. Recordá restaurar a 'prod' despues del test.`)
