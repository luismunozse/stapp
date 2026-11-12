// @vitest-environment node
import { describe, it, expect } from "vitest"
import { readFileSync, existsSync } from "fs"
import { join } from "path"

// Migration 406 (multimoneda S3): quotes get the rate source/time, and recotizaciones records
// every "Cambiar cotizacion". Pinned by text: CI has no Postgres.
const ROOT = process.cwd()
const SQL_PATH = join(ROOT, "supabase/migrations/406_multimoneda_cotizaciones.sql")
const ROLLBACK_PATH = join(ROOT, "supabase/migrations/rollback/406_rollback.sql")
const PROBES_PATH = join(ROOT, "supabase/migrations/verify/406_probes.sql")
const SQL = existsSync(SQL_PATH) ? readFileSync(SQL_PATH, "utf8") : ""
const CODE = SQL.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n")

describe("migration 406: multimoneda cotizaciones y recotizaciones", () => {
  it("exists with rollback and probes", () => {
    expect(existsSync(SQL_PATH)).toBe(true)
    expect(existsSync(ROLLBACK_PATH)).toBe(true)
    expect(existsSync(PROBES_PATH)).toBe(true)
  })

  it("is additive: no DROP, DELETE, TRUNCATE or UPDATE", () => {
    expect(CODE.length).toBeGreaterThan(0)
    expect(CODE).not.toMatch(/\bDROP\s+(TABLE|COLUMN|CONSTRAINT)\b/i)
    expect(CODE).not.toMatch(/^\s*DELETE\s+FROM\b/im)
    expect(CODE).not.toMatch(/\bTRUNCATE\b/i)
    expect(CODE).not.toMatch(/^\s*UPDATE\s+\w+/im)
  })

  it("does not convert cotizaciones.tipo_cambio (ALTER TYPE rewrites the table)", () => {
    expect(CODE).not.toMatch(/ALTER COLUMN\s+tipo_cambio\s+(SET DATA )?TYPE/i)
  })

  it("bounds the lock wait", () => {
    expect(CODE).toMatch(/SET LOCAL lock_timeout = '3s';/)
  })

  it("adds the rate source and time to cotizaciones, guarded and without inline CHECK", () => {
    expect(CODE).toMatch(/ADD COLUMN IF NOT EXISTS tipo_cambio_fuente TEXT/)
    expect(CODE).toMatch(/ADD COLUMN IF NOT EXISTS tipo_cambio_en TIMESTAMPTZ/)
    const stmts = CODE.match(/ALTER TABLE\s+\w+\b[^;]*;/gi) ?? []
    for (const st of stmts.filter((x) => /ADD COLUMN/i.test(x))) expect(st).not.toMatch(/\bCHECK\b/i)
    expect(CODE.match(/ADD COLUMN\b(?! IF NOT EXISTS)/gi) ?? []).toEqual([])
  })

  it("creates recotizaciones with the spec columns", () => {
    expect(CODE).toMatch(/CREATE TABLE IF NOT EXISTS recotizaciones/)
    expect(CODE).toMatch(/id\s+TEXT PRIMARY KEY DEFAULT generate_cuid\(\)/)
    expect(CODE).toMatch(/organization_id\s+TEXT NOT NULL REFERENCES organizations\(id\) ON DELETE CASCADE/)
    expect(CODE).toMatch(/documento_tipo\s+TEXT NOT NULL CHECK \(documento_tipo IN \('ORDEN', 'COTIZACION'\)\)/)
    expect(CODE).toMatch(/modo\s+TEXT NOT NULL CHECK \(modo IN \('HOY', 'MANUAL'\)\)/)
    for (const col of ["documento_id", "tipo_cambio_anterior", "tipo_cambio_nuevo", "motivo", "total_anterior", "total_nuevo", "lineas_afectadas", "usuario_id", "created_at"]) {
      expect(CODE, col).toMatch(new RegExp(`\\b${col}\\s+(TEXT|NUMERIC|INT|TIMESTAMPTZ)`))
    }
  })

  it("requires a reason for MANUAL mode and indexes by document", () => {
    expect(CODE).toMatch(/CHECK \(modo <> 'MANUAL' OR length\(trim\(motivo\)\) > 0\)/)
    expect(CODE).toMatch(/CREATE INDEX IF NOT EXISTS \w+\s+ON recotizaciones\s*\(organization_id, documento_tipo, documento_id\)/)
  })

  it("RLS: own-org SELECT for authenticated, ALL for service_role, anon denied", () => {
    expect(CODE).toMatch(/ALTER TABLE recotizaciones ENABLE ROW LEVEL SECURITY/)
    expect(CODE).toMatch(/CREATE POLICY recotizaciones_all_service ON recotizaciones\s+FOR ALL TO service_role/)
    expect(CODE).toMatch(
      /CREATE POLICY recotizaciones_select ON recotizaciones\s+FOR SELECT TO authenticated\s+USING \(organization_id = public\.get_current_organization_id\(\)\)/
    )
    expect(CODE).toMatch(/REVOKE ALL ON public\.recotizaciones FROM PUBLIC, anon, authenticated;/)
    expect(CODE).toMatch(/GRANT SELECT ON public\.recotizaciones TO authenticated;/)
  })

  it("rollback drops the table and the columns; probes end in ROLLBACK and test the reason CHECK", () => {
    const rb = readFileSync(ROLLBACK_PATH, "utf8")
    expect(rb).toMatch(/DROP TABLE IF EXISTS recotizaciones/)
    expect(rb).toMatch(/DROP COLUMN IF EXISTS tipo_cambio_en/)
    expect(rb).toMatch(/DROP COLUMN IF EXISTS tipo_cambio_fuente/)
    const pr = readFileSync(PROBES_PATH, "utf8")
    expect(pr).toMatch(/ROLLBACK;\s*$/)
    expect(pr).toMatch(/23514/)
    expect(pr).toMatch(/motivo/)
  })
})
