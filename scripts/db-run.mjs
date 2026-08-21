#!/usr/bin/env node
// Ejecuta un archivo SQL contra la base de Supabase.
//
// Uso:
//   node scripts/db-run.mjs <archivo.sql>            # DRY-RUN: corre y hace ROLLBACK
//   node scripts/db-run.mjs <archivo.sql> --apply    # COMMIT: cambio real y permanente
//
// Atajos de npm:
//   npm run db:dry  -- supabase/migrations/277_trigger_recalcular_estado_cobro.sql
//   npm run db:apply -- supabase/migrations/277_trigger_recalcular_estado_cobro.sql
//
// POR QUÉ EL DRY-RUN ES EL DEFAULT
// Esta base es producción: la usan varios talleres todos los días. Aplicar una
// migración tiene que ser un acto deliberado, no el resultado de tipear mal una
// ruta. Sin --apply el script envuelve todo en una transacción y la revierte,
// así que ves si el SQL corre sin dejar rastro.
//
// ARCHIVOS QUE YA TRAEN SU PROPIA TRANSACCIÓN
// Los probes de supabase/migrations/verify/ abren su BEGIN y cierran con ROLLBACK.
// Anidar BEGIN en PostgreSQL no crea una subtransacción: el ROLLBACK interno
// revertiría la transacción externa y el resto del archivo correría fuera de
// toda transacción. Por eso, si el archivo arranca con BEGIN, se ejecuta tal cual
// y --apply se rechaza: el archivo ya decide su propio destino.
//
// VARIABLE DE ENTORNO
//   SUPABASE_DB_URL — connection string de Postgres con permisos de DDL.
//   En Supabase: Project Settings → Database → Connection string → URI.
//   Usá la conexión DIRECTA (puerto 5432), no el pooler de transacciones:
//   el pooler no admite algunas sentencias DDL ni mantiene la sesión.
//   Ponela en .env.production.local (que ya está en .gitignore).

import { readFileSync, existsSync } from "node:fs"
import pg from "pg"

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
loadEnv(".env.local")
loadEnv(".env")

const args = process.argv.slice(2)
const apply = args.includes("--apply")
const file = args.find((a) => !a.startsWith("--"))

if (!file) {
  console.error("Falta el archivo SQL.\n  node scripts/db-run.mjs <archivo.sql> [--apply]")
  process.exit(1)
}

if (!existsSync(file)) {
  console.error(`No existe el archivo: ${file}`)
  process.exit(1)
}

const sql = readFileSync(file, "utf8")

// Un archivo que abre su propia transacción decide su propio destino.
const traeTransaccionPropia = /^\s*BEGIN\s*;/im.test(sql.split("\n").slice(0, 40).join("\n"))

// Se valida antes de mirar el entorno: es un error de invocación y no depende
// de tener credenciales configuradas.
if (traeTransaccionPropia && apply) {
  console.error(
    `${file} abre su propia transacción (BEGIN) y la cierra por su cuenta.\n` +
      "--apply no aplica acá: quitá el flag y el archivo hará lo que ya decide (los probes revierten solos)."
  )
  process.exit(1)
}

const connectionString = process.env.SUPABASE_DB_URL
if (!connectionString) {
  console.error(
    "Falta SUPABASE_DB_URL.\n" +
      "  Supabase → Project Settings → Database → Connection string → URI (conexión directa, puerto 5432).\n" +
      "  Guardala en .env.production.local"
  )
  process.exit(1)
}

function imprimirResultado(res, indice) {
  const etiqueta = res.command || "resultado"
  if (res.rows && res.rows.length > 0) {
    console.log(`\n── [${indice}] ${etiqueta} — ${res.rows.length} fila(s)`)
    console.table(res.rows)
  } else if (res.rowCount !== null && res.rowCount !== undefined) {
    console.log(`── [${indice}] ${etiqueta} — ${res.rowCount} fila(s) afectada(s)`)
  } else {
    console.log(`── [${indice}] ${etiqueta}`)
  }
}

const client = new pg.Client({
  connectionString,
  ssl: /sslmode=/i.test(connectionString) ? undefined : { rejectUnauthorized: false },
})

let salida = 0

try {
  await client.connect()

  // El host se imprime para saber contra qué base estás corriendo.
  // Nunca se imprime la connection string: lleva la contraseña.
  console.log(`Base:    ${client.host}/${client.database}`)
  console.log(`Archivo: ${file}`)
  console.log(
    `Modo:    ${
      traeTransaccionPropia
        ? "el archivo maneja su propia transacción"
        : apply
          ? "APPLY (COMMIT — cambio permanente)"
          : "DRY-RUN (ROLLBACK al final)"
    }`
  )

  if (!traeTransaccionPropia) await client.query("BEGIN")

  const res = await client.query(sql)
  const resultados = Array.isArray(res) ? res : [res]
  resultados.forEach(imprimirResultado)

  if (!traeTransaccionPropia) {
    if (apply) {
      await client.query("COMMIT")
      console.log("\nCOMMIT — los cambios quedaron aplicados.")
    } else {
      await client.query("ROLLBACK")
      console.log("\nROLLBACK — nada quedó aplicado. Volvé a correrlo con --apply para aplicarlo de verdad.")
    }
  }
} catch (err) {
  salida = 1
  console.error(`\nError: ${err.message}`)
  if (err.position) console.error(`Posición en el SQL: ${err.position}`)
  if (err.hint) console.error(`Pista: ${err.hint}`)
  try {
    if (!traeTransaccionPropia) await client.query("ROLLBACK")
  } catch {
    // La conexión ya puede estar rota; el error original es el que importa.
  }
} finally {
  await client.end().catch(() => {})
}

process.exit(salida)
