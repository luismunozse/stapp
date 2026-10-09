// @vitest-environment node
import { describe, it, expect } from "vitest"
import { existsSync, readFileSync } from "fs"
import { join } from "path"

// Las migraciones se aplican a mano con scripts/db-run.mjs y no hay Postgres en
// CI: las reglas viven en los probes (supabase/migrations/verify). Este test fija
// lo que vitest sí puede ver: que cada migración del grupo trae probes y
// rollback, y que ninguna abre su propia transacción. Lo último importa:
// db-run.mjs ejecuta TAL CUAL un archivo con BEGIN en sus primeras 40 líneas,
// así que `npm run db:dry` sobre una migración con BEGIN/COMMIT la aplicaría.
const MIGRACIONES = ["342_notas_credito_bases"]

const leer = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8")
const existe = (rel: string) => existsSync(join(process.cwd(), rel))
const abreTransaccion = (sql: string) =>
  /^\s*BEGIN\s*;/im.test(sql.split("\n").slice(0, 40).join("\n"))

describe.each(MIGRACIONES)("migración %s", (nombre) => {
  const numero = nombre.slice(0, 3)
  const migracion = `supabase/migrations/${nombre}.sql`
  const probes = `supabase/migrations/verify/${numero}_probes.sql`
  const rollback = `supabase/migrations/rollback/${numero}_rollback.sql`

  it("trae probes y rollback", () => {
    expect(existe(migracion)).toBe(true)
    expect(existe(probes)).toBe(true)
    expect(existe(rollback)).toBe(true)
  })

  it("ni la migración ni el rollback abren su propia transacción", () => {
    expect(abreTransaccion(leer(migracion))).toBe(false)
    expect(leer(migracion)).not.toMatch(/^\s*COMMIT\s*;/im)
    expect(abreTransaccion(leer(rollback))).toBe(false)
    expect(leer(rollback)).not.toMatch(/^\s*COMMIT\s*;/im)
  })

  it("los probes abren su transacción en las primeras 40 líneas y la revierten", () => {
    const sql = leer(probes)
    expect(abreTransaccion(sql)).toBe(true)
    expect(sql.trimEnd()).toMatch(/ROLLBACK;$/)
  })
})

describe("342: contratos que el pre-flight y la app dan por hechos", () => {
  const sql = () => leer("supabase/migrations/342_notas_credito_bases.sql")

  it("aborta si queda alguna NC de venta", () => {
    expect(sql()).toMatch(/FROM notas_credito WHERE venta_id IS NOT NULL/)
    expect(sql()).toMatch(/RAISE EXCEPTION 'Abort:/)
  })

  it("reemplaza las constraints de la 186 sin IF EXISTS (falla fuerte si el nombre cambió)", () => {
    for (const nombre of ["notas_credito_motivo_check", "notas_credito_check", "notas_credito_orden_id_fkey"]) {
      expect(sql()).toContain(`DROP CONSTRAINT ${nombre};`)
    }
  })
})
