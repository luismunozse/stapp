// @vitest-environment node
import { describe, it, expect } from "vitest"
import { readFileSync, existsSync } from "fs"
import { join } from "path"

// Migrations are applied by hand and CI has no Postgres: this test pins by text what vitest
// cannot execute. M1 of multimoneda-inventario-servicios must stay additive and re-runnable,
// because existing rows (and every reader that sums them) must not change.
const ROOT = process.cwd()
const SQL = readFileSync(join(ROOT, "supabase/migrations/365_multimoneda_foundation.sql"), "utf8")
const ROLLBACK_PATH = join(ROOT, "supabase/migrations/rollback/365_rollback.sql")
const PROBES_PATH = join(ROOT, "supabase/migrations/verify/365_probes.sql")
const VALIDATE_PATH = join(ROOT, "supabase/migrations/365b_multimoneda_validate.sql")
const VALIDATE = existsSync(VALIDATE_PATH) ? readFileSync(VALIDATE_PATH, "utf8") : ""

// Strip SQL line comments so assertions look at statements, not prose.
const CODE = SQL.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n")

describe("migration 365: multimoneda foundation", () => {
  it("is additive: no DROP, DELETE, TRUNCATE or UPDATE statement", () => {
    expect(CODE).not.toMatch(/\bDROP\s+(TABLE|COLUMN|CONSTRAINT)\b/i)
    expect(CODE).not.toMatch(/^\s*DELETE\s+FROM\b/im)
    expect(CODE).not.toMatch(/\bTRUNCATE\b/i)
    expect(CODE).not.toMatch(/^\s*UPDATE\s+\w+/im)
  })

  it("is re-runnable: every ADD COLUMN and CREATE TABLE is guarded", () => {
    const addCols = CODE.match(/ADD COLUMN\b(?! IF NOT EXISTS)/gi) ?? []
    expect(addCols).toEqual([])
    const tables = CODE.match(/CREATE TABLE\b(?! IF NOT EXISTS)/gi) ?? []
    expect(tables).toEqual([])
    expect(CODE).toMatch(/ADD COLUMN IF NOT EXISTS/)
  })

  it("bounds the lock wait", () => {
    expect(CODE).toMatch(/SET LOCAL lock_timeout = '3s';/)
  })

  it("moneda is CHAR(3) NULL (NULL = org local), no DEFAULT, no inline CHECK", () => {
    for (const table of ["inventario", "servicios", "movimientos_caja"]) {
      const re = new RegExp(`ALTER TABLE ${table}\\b[^;]*?ADD COLUMN IF NOT EXISTS moneda CHAR\\(3\\)\\s*;`, "i")
      expect(CODE, table).toMatch(re)
    }
    expect(CODE).not.toMatch(/ADD COLUMN IF NOT EXISTS moneda CHAR\(3\)\s+(NOT NULL|DEFAULT)/i)
    expect(CODE).not.toMatch(/DEFAULT 'ARS'/i)
  })

  it("never puts a CHECK inline on an ADD COLUMN of an existing table (full scan under ACCESS EXCLUSIVE)", () => {
    const stmts = CODE.match(/ALTER TABLE\s+\w+\b[^;]*;/gi) ?? []
    expect(stmts.length).toBeGreaterThan(0)
    for (const st of stmts.filter((x) => /ADD COLUMN/i.test(x))) expect(st).not.toMatch(/\bCHECK\b/i)
  })

  const CHECKS: Array<[string, string]> = [
    ["inventario", "moneda"], ["servicios", "moneda"], ["movimientos_caja", "moneda"],
    ["items_venta", "moneda_origen"], ["servicios_orden", "moneda_origen"],
    ["repuestos_orden", "moneda_origen"], ["items_cotizacion", "moneda_origen"],
    ["items_venta", "tipo_cambio"], ["servicios_orden", "tipo_cambio"],
    ["repuestos_orden", "tipo_cambio"], ["items_cotizacion", "tipo_cambio"],
    ["ventas", "tipo_cambio"], ["ordenes_servicio", "tipo_cambio"],
    ["pagos_venta", "moneda"], ["pagos_venta", "tipo_cambio"], ["pagos_venta", "vuelto_moneda"],
  ]

  it.each(CHECKS)("%s.%s: named CHECK added NOT VALID, validated apart, dropped in rollback", (table, col) => {
    const name = `${table}_${col}_chk`
    const call = new RegExp(`add_check_nv\\('${table}',\\s*'${name}',\\s*'${col}\\b[^;]*?'\\)\\s*;`)
    expect(CODE, name).toMatch(call)
    expect(VALIDATE, name).toMatch(new RegExp(`ALTER TABLE ${table}\\s+VALIDATE CONSTRAINT ${name};`))
    expect(readFileSync(ROLLBACK_PATH, "utf8"), name).toMatch(new RegExp(`DROP CONSTRAINT IF EXISTS ${name}\\b`))
    expect(readFileSync(PROBES_PATH, "utf8"), name).toContain(name)
  })

  it("add_check_nv adds the constraint NOT VALID, guarded by pg_constraint", () => {
    const fn = CODE.match(/FUNCTION pg_temp\.add_check_nv[^]*?\$\$;/i)?.[0] ?? ""
    expect(fn).toMatch(/pg_constraint/)
    expect(fn).toMatch(/NOT VALID/)
  })

  it("365b validates each constraint in a separate optional file, one statement each", () => {
    expect(VALIDATE.match(/^ALTER TABLE \w+ VALIDATE CONSTRAINT/gm)?.length).toBe(CHECKS.length)
    expect(VALIDATE).not.toMatch(/\bSET LOCAL lock_timeout\b[^;]*;[^]*VALIDATE[^]*\bCOMMIT\b/i)
  })

  it("does not claim the ALTERs are catalog-only", () => {
    expect(SQL).not.toMatch(/catalog-only/i)
  })

  it("adds the origin snapshot columns to line tables", () => {
    for (const table of ["items_venta", "servicios_orden", "repuestos_orden", "items_cotizacion"]) {
      const block = CODE.match(new RegExp(`ALTER TABLE ${table}\\b[^;]*;`, "i"))?.[0] ?? ""
      expect(block, table).toMatch(/moneda_origen/)
      expect(block, table).toMatch(/precio_origen NUMERIC\(12,2\)/i)
      expect(block, table).toMatch(/tipo_cambio NUMERIC\(14,6\)/i)
    }
  })

  it("adds the rate snapshot to ventas and ordenes_servicio, and the payment currency columns", () => {
    for (const table of ["ventas", "ordenes_servicio"]) {
      const block = CODE.match(new RegExp(`ALTER TABLE ${table}\\b[^;]*;`, "i"))?.[0] ?? ""
      expect(block, table).toMatch(/tipo_cambio NUMERIC\(14,6\)/i)
      expect(block, table).toMatch(/tipo_cambio_fuente/)
    }
    const pagos = CODE.match(/ALTER TABLE pagos_venta\b[^;]*;/i)?.[0] ?? ""
    for (const col of ["moneda", "monto_moneda", "tipo_cambio", "vuelto_monto", "vuelto_moneda"]) {
      expect(pagos, col).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${col}\\b`))
    }
  })

  it("does not touch the organizations table (the three /api/configuracion cascades stay as they are)", () => {
    expect(CODE).not.toMatch(/ALTER TABLE\s+(public\.)?organizations\b/i)
  })

  it("organizacion_moneda: one row per org, flag off by default, allowed sources", () => {
    expect(CODE).toMatch(/CREATE TABLE IF NOT EXISTS organizacion_moneda/)
    expect(CODE).toMatch(/organization_id\s+TEXT PRIMARY KEY REFERENCES organizations\(id\) ON DELETE CASCADE/)
    expect(CODE).toMatch(/multimoneda_habilitada\s+BOOLEAN NOT NULL DEFAULT false/)
    expect(CODE).toMatch(/tipo_cambio_fuente[^;]*?IN \('MANUAL', 'OFICIAL', 'BLUE', 'MEP'\)/)
    expect(CODE).toMatch(/vuelto_moneda_default[^;]*?IN \('LOCAL', 'USD'\)/)
    expect(CODE).toMatch(/acepta_usd_efectivo\s+BOOLEAN NOT NULL DEFAULT false/)
  })

  it("sesion_caja_saldos: one row per (sesion, moneda)", () => {
    expect(CODE).toMatch(/CREATE TABLE IF NOT EXISTS sesion_caja_saldos/)
    expect(CODE).toMatch(/UNIQUE \(sesion_id, moneda\)/)
    expect(CODE).toMatch(/moneda\s+CHAR\(3\) NOT NULL CHECK \(moneda = 'USD'\)/)
  })

  it.each(["organizacion_moneda", "sesion_caja_saldos"])("%s: RLS on, service_role + own-org SELECT, anon denied", (t) => {
    expect(CODE).toMatch(new RegExp(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`))
    expect(CODE).toMatch(new RegExp(`CREATE POLICY ${t}_all_service ON ${t}\\s+FOR ALL TO service_role`))
    expect(CODE).toMatch(
      new RegExp(`CREATE POLICY ${t}_select ON ${t}\\s+FOR SELECT TO authenticated\\s+USING \\(organization_id = public\\.get_current_organization_id\\(\\)\\)`)
    )
    expect(readFileSync(ROLLBACK_PATH, "utf8")).toMatch(new RegExp(`DROP TABLE IF EXISTS ${t}`))
    expect(CODE).toMatch(new RegExp(`REVOKE ALL ON public\\.${t} FROM PUBLIC, anon, authenticated;`))
  })

  it("ships a rollback and a probes file", () => {
    expect(existsSync(ROLLBACK_PATH)).toBe(true)
    expect(existsSync(PROBES_PATH)).toBe(true)
    const rb = readFileSync(ROLLBACK_PATH, "utf8")
    expect(rb).toMatch(/DROP TABLE IF EXISTS sesion_caja_saldos/)
    expect(rb).toMatch(/DROP TABLE IF EXISTS organizacion_moneda/)
    expect(rb).toMatch(/DROP COLUMN IF EXISTS moneda\b/)
    const pr = readFileSync(PROBES_PATH, "utf8")
    expect(pr).toMatch(/ROLLBACK;\s*$/)
    expect(pr).toMatch(/UNIQUE|23505/)
    expect(pr).toMatch(/'EUR'/)
  })

  it("the rollback rehearsed in the probes is byte-equal (modulo whitespace) to 365_rollback.sql", () => {
    const pr = readFileSync(PROBES_PATH, "utf8")
    const m = pr.match(/-- ROLLBACK:BEGIN\r?\n([^]*?)-- ROLLBACK:END/)
    expect(m).not.toBeNull()
    const strip = (t: string) =>
      t.split(/\r?\n/).filter((l) => !l.trim().startsWith("--")).join(" ").replace(/\s+/g, " ").trim()
    const rb = strip(readFileSync(ROLLBACK_PATH, "utf8"))
    expect(strip(m![1])).toBe(rb)
  })

  it("probes check numeric(14,6) precision and zero-rate rejection", () => {
    const pr = readFileSync(PROBES_PATH, "utf8")
    expect(pr).toMatch(/numeric_precision = 14/)
    expect(pr).toMatch(/numeric_scale = 6/)
    expect(pr).toMatch(/tipo_cambio = 0/)
  })
})
