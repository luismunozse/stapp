// @vitest-environment node
import { describe, it, expect } from "vitest"
import { collapse, readByMarker, readBySuffix, stripComments } from "./helpers/sql-text"

// Migrations are applied by hand and CI has no Postgres: this pins by text what vitest cannot
// execute (verify/395_probes.sql covers the runtime against the real schema).

const mig = () => readBySuffix("_superadmin_identidad_y_bloqueo.sql")
const rollback = () => readByMarker("rollback", "Rollback de superadmin_identidad_y_bloqueo")
const probes = () => readByMarker("verify", "Verificación de superadmin_identidad_y_bloqueo")

describe("superadmin_identidad_y_bloqueo (395)", () => {
  it("arranca con lock_timeout y no abre transacción propia", () => {
    expect(collapse(mig()).startsWith("SET LOCAL lock_timeout = '3s';")).toBe(true)
    expect(stripComments(mig())).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im)
  })

  it("agrega las tres columnas; la marca arranca en false para todos", () => {
    const sql = collapse(mig())
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS es_superadmin BOOLEAN NOT NULL DEFAULT false;")
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS acceso_bloqueado_at TIMESTAMPTZ;")
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS acceso_bloqueado_por TEXT;")
  })

  it("no marca a nadie: el UPDATE de la marca queda solo como instrucción comentada", () => {
    expect(stripComments(mig())).not.toMatch(/UPDATE\s+users/i)
  })

  it("el trigger deja cambiar la marca solo a postgres/supabase_admin, en INSERT y UPDATE", () => {
    const sql = collapse(mig())
    expect(sql).toContain("IF current_user IN ('postgres', 'supabase_admin') THEN RETURN NEW;")
    expect(sql).toContain("IF TG_OP = 'INSERT' AND NEW.es_superadmin THEN")
    expect(sql).toContain("NEW.es_superadmin IS DISTINCT FROM OLD.es_superadmin")
    expect(sql).toContain("ERRCODE = 'insufficient_privilege'")
    expect(sql).toContain("BEFORE INSERT OR UPDATE OF es_superadmin ON users FOR EACH ROW")
    // SECURITY DEFINER haría que current_user fuera el dueño de la función y abriría la puerta.
    expect(stripComments(mig())).not.toMatch(/SECURITY DEFINER/i)
  })

  it("el rollback saca trigger, función y columnas", () => {
    const sql = collapse(rollback())
    expect(sql).toContain("DROP TRIGGER IF EXISTS users_es_superadmin_protegido ON users;")
    expect(sql).toContain("DROP FUNCTION IF EXISTS users_es_superadmin_protegido();")
    for (const c of ["es_superadmin", "acceso_bloqueado_at", "acceso_bloqueado_por"]) {
      expect(sql).toMatch(new RegExp(`DROP COLUMN IF EXISTS ${c}\\b`))
    }
  })

  it("las probes terminan en ROLLBACK y prueban el rechazo a service_role", () => {
    const sql = collapse(stripComments(probes()))
    expect(sql.startsWith("BEGIN;")).toBe(true)
    expect(sql.trimEnd().endsWith("ROLLBACK;")).toBe(true)
    expect(sql).toContain("SET LOCAL ROLE service_role")
  })
})
