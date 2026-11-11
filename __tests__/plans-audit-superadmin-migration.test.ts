// @vitest-environment node
import { describe, it, expect } from "vitest"
import { collapse, readByMarker, readBySuffix, stripComments } from "./helpers/sql-text"
import { HEADER_AUTOR_PLANES } from "@/lib/superadmin-audit"

// Migrations are applied by hand and CI has no Postgres: this pins by text what vitest cannot
// execute (verify/403_probes.sql covers the runtime against the real schema).

const mig = () => readBySuffix("_plans_audit_superadmin.sql")
const rollback = () => readByMarker("rollback", "Rollback de plans_audit_superadmin")
const probes = () => readByMarker("verify", "Verificación de plans_audit_superadmin")

describe("plans_audit_superadmin (403)", () => {
  it("arranca con lock_timeout y no abre transacción propia", () => {
    expect(collapse(mig()).startsWith("SET LOCAL lock_timeout = '3s';")).toBe(true)
    expect(stripComments(mig())).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im)
  })

  it("lee el mismo header que mandan las rutas, y solo si escribe service_role", () => {
    const sql = collapse(mig())
    expect(HEADER_AUTOR_PLANES).toBe("x-stapp-superadmin")
    expect(sql).toContain(`IF v_autor IS NULL AND current_user = 'service_role' THEN`)
    expect(sql).toContain(`::json ->> '${HEADER_AUTOR_PLANES}'`)
  })

  it("app.superadmin_email sigue teniendo prioridad y el resto cae en sql:<usuario> o system", () => {
    const sql = collapse(mig())
    expect(sql.indexOf("current_setting('app.superadmin_email', TRUE)")).toBeLessThan(sql.indexOf("request.headers"))
    expect(sql).toContain("WHEN current_user IN ('postgres', 'supabase_admin') THEN 'sql:' || session_user")
    expect(sql).toContain("ELSE 'system'")
  })

  it("no es SECURITY DEFINER: current_user tiene que ser quien escribe", () => {
    expect(stripComments(mig())).not.toMatch(/SECURITY DEFINER/i)
  })

  it("mantiene las acciones CREATE/UPDATE/DISABLE/ENABLE de la 025", () => {
    const sql = collapse(mig())
    for (const accion of ["'CREATE'", "'UPDATE'", "'DISABLE'", "'ENABLE'"]) expect(sql).toContain(accion)
  })

  it("el rollback vuelve a la función de la 025", () => {
    const sql = collapse(rollback())
    expect(sql).toContain("COALESCE(current_setting('app.superadmin_email', TRUE), 'system')")
    expect(sql).not.toContain("request.headers")
  })

  it("los probes cubren header, sin header, postgres y prioridad, y terminan en ROLLBACK", () => {
    const sql = probes()
    expect(sql).toMatch(/^BEGIN;/m)
    expect(sql.trimEnd().endsWith("ROLLBACK;")).toBe(true)
    for (const n of [1, 2, 3, 4, 5]) expect(sql).toMatch(new RegExp(`SELECT ${n}, '`))
  })
})
