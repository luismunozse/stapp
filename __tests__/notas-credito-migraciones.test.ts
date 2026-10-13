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
const MIGRACIONES = ["350_notas_credito_bases"]

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

describe("350: contratos que el pre-flight y la app dan por hechos", () => {
  const sql = () => leer("supabase/migrations/350_notas_credito_bases.sql")

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

describe("351: el deposito de los items de NC no bloquea la purga de una organizacion", () => {
  const sql = () => leer("supabase/migrations/351_nc_items_deposito_set_null.sql")
  const rollback = () => leer("supabase/migrations/rollback/351_rollback.sql")

  it("ni la migracion ni el rollback abren su propia transaccion", () => {
    expect(existe("supabase/migrations/351_nc_items_deposito_set_null.sql")).toBe(true)
    expect(existe("supabase/migrations/rollback/351_rollback.sql")).toBe(true)
    expect(abreTransaccion(sql())).toBe(false)
    expect(sql()).not.toMatch(/^\s*COMMIT\s*;/im)
    expect(abreTransaccion(rollback())).toBe(false)
    expect(rollback()).not.toMatch(/^\s*COMMIT\s*;/im)
  })

  it("reemplaza la FK sin IF EXISTS y la recrea con ON DELETE SET NULL", () => {
    expect(sql()).toContain(
      "ALTER TABLE items_nota_credito DROP CONSTRAINT items_nota_credito_deposito_id_fkey;"
    )
    expect(sql()).toMatch(
      /ADD CONSTRAINT items_nota_credito_deposito_id_fkey\s+FOREIGN KEY \(deposito_id\) REFERENCES depositos\(id\) ON DELETE SET NULL;/
    )
  })

  it("el rollback restaura la FK original, sin SET NULL", () => {
    expect(rollback()).toContain("DROP CONSTRAINT items_nota_credito_deposito_id_fkey;")
    expect(rollback()).toMatch(
      /ADD CONSTRAINT items_nota_credito_deposito_id_fkey\s+FOREIGN KEY \(deposito_id\) REFERENCES depositos\(id\);/
    )
    expect(rollback()).not.toMatch(/ON DELETE SET NULL/)
  })
})
