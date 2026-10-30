// @vitest-environment node
import { describe, it, expect } from "vitest"
import { readBySuffix, readByMarker, collapse, stripComments } from "./helpers/sql-text"

const mig = () => readBySuffix("_comisiones_recepcion.sql")
const rb = () => readByMarker("rollback", "Rollback of comisiones_recepcion")
const probes = () => readByMarker("verify", "Verification of comisiones_recepcion")
const fn = () => { const s = collapse(mig()); return s.slice(s.indexOf("CREATE OR REPLACE FUNCTION set_porcentaje_comision_recepcion()")) }

describe("380: hygiene", () => {
  it("starts with SET LOCAL lock_timeout, opens no transaction, writes no rows", () => {
    expect(collapse(mig()).startsWith("SET LOCAL lock_timeout = '3s';")).toBe(true)
    expect(stripComments(mig())).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im)
    expect(stripComments(mig())).not.toMatch(/\b(INSERT INTO|DELETE FROM)\b|\bUPDATE\s+\w+\s+SET\b/)
  })
})
describe("380: comisiones_config", () => {
  it("one row per org with the spec's options and defaults", () => {
    const s = collapse(mig())
    for (const frag of [
      "organization_id TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE",
      "orden_devengo TEXT NOT NULL DEFAULT 'ENTREGA_Y_COBRO' CHECK (orden_devengo IN ('ENTREGA_Y_COBRO', 'ENTREGA', 'COBRO'))",
      "tecnico_base TEXT NOT NULL DEFAULT 'MANO_DE_OBRA' CHECK (tecnico_base IN ('MANO_DE_OBRA', 'MONTO_ORDEN'))",
      "recepcion_base TEXT NOT NULL DEFAULT 'MONTO_ORDEN' CHECK (recepcion_base IN ('MONTO_ORDEN', 'MANO_DE_OBRA'))",
      "recepcion_porcentaje_default NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (recepcion_porcentaje_default BETWEEN 0 AND 100)",
      "reingreso_comisiona BOOLEAN NOT NULL DEFAULT false",
    ]) expect(s).toContain(frag)
  })
  it("RLS on, service_role only", () => {
    const s = collapse(mig())
    expect(s).toContain("ALTER TABLE comisiones_config ENABLE ROW LEVEL SECURITY")
    expect(s).toContain("REVOKE ALL ON public.comisiones_config FROM PUBLIC, anon, authenticated")
    expect(s).not.toMatch(/GRANT [A-Z, ]+ ON public\.comisiones_config TO authenticated/)
  })
})
describe("380: rates", () => {
  it("a nullable reception rate per person and a snapshot per order, both 0..100", () => {
    const s = collapse(mig())
    expect(s).toContain("ALTER TABLE users ADD COLUMN IF NOT EXISTS porcentaje_comision_recepcion NUMERIC(5,2)")
    expect(s).toContain("ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS porcentaje_comision_recepcion NUMERIC(5,2)")
    expect(s).toContain("CHECK (porcentaje_comision_recepcion BETWEEN 0 AND 100) NOT VALID")
    expect(s).toContain("VALIDATE CONSTRAINT ordenes_servicio_porcentaje_recepcion_check")
  })
})
describe("380: snapshot trigger", () => {
  it("fires BEFORE INSERT only: recibido_por is never edited", () => {
    expect(collapse(mig())).toContain("CREATE TRIGGER trigger_ordenes_porcentaje_recepcion BEFORE INSERT ON ordenes_servicio FOR EACH ROW EXECUTE FUNCTION set_porcentaje_comision_recepcion()")
  })
  it("explicit value kept; no receiver or receiver outside the org = 0; own rate, else org default, else 0", () => {
    const s = fn()
    expect(s).toContain("IF NEW.porcentaje_comision_recepcion IS NOT NULL THEN RETURN NEW;")
    expect(s).toMatch(/IF NEW\.recibido_por IS NULL THEN NEW\.porcentaje_comision_recepcion := 0;/)
    expect(s).toContain("u.id = NEW.recibido_por AND u.organization_id = NEW.organization_id")
    expect(s).toMatch(/COALESCE\(v_propio, \(SELECT c\.recepcion_porcentaje_default FROM comisiones_config c WHERE c\.organization_id = NEW\.organization_id\), 0\)/)
  })
  it("definer with pinned search_path, not callable directly", () => {
    expect(fn()).toMatch(/SECURITY DEFINER SET search_path = public, pg_temp/)
    expect(collapse(mig())).toContain("REVOKE EXECUTE ON FUNCTION set_porcentaje_comision_recepcion() FROM PUBLIC, anon, authenticated")
  })
})
describe("380: rollback and probes", () => {
  it("rollback warns, runs after 381's, and drops trigger before columns and table", () => {
    const head = rb().slice(0, rb().indexOf("DROP"))
    expect(head).toMatch(/pierde|loses/i); expect(head).toMatch(/381_rollback/)
    const s = collapse(rb())
    expect(s.indexOf("DROP TRIGGER IF EXISTS trigger_ordenes_porcentaje_recepcion")).toBeLessThan(s.indexOf("DROP COLUMN IF EXISTS porcentaje_comision_recepcion"))
    expect(s).toContain("DROP TABLE IF EXISTS comisiones_config")
  })
  it("probes roll back, use their own result table, and cover each branch", () => {
    const s = stripComments(probes())
    expect(s).toMatch(/^\s*BEGIN\s*;/m); expect(s.trimEnd().endsWith("ROLLBACK;")).toBe(true)
    expect(s).toContain("CREATE TEMP TABLE _r380")
    for (const k of ["propio", "por defecto", "sin config", "sin receptor", "otra org", "explicito", "has_table_privilege", "prosecdef"]) expect(probes()).toContain(k)
  })
})
