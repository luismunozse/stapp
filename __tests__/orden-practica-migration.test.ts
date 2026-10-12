// @vitest-environment node
import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { join } from "path"

// Migrations are applied by hand and there is no Postgres in CI: this test pins
// by text what vitest cannot execute.
const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/348_orden_practica_onboarding.sql"),
  "utf8"
)
const ROLLBACK = readFileSync(
  join(process.cwd(), "supabase/migrations/rollback/348_rollback.sql"),
  "utf8"
)

const FILES: Array<[string, string]> = [
  ["migration", MIGRATION],
  ["rollback", ROLLBACK],
]

describe("migration 348: practice order (es_practica)", () => {
  it.each(FILES)("%s recreates v_clientes_resumen with security_invoker", (_name, sql) => {
    expect(sql).toMatch(/CREATE VIEW v_clientes_resumen WITH \(security_invoker = true\)/)
  })

  it.each(FILES)("%s does not own its transaction", (_name, sql) => {
    expect(sql).not.toMatch(/^\s*BEGIN\s*;/m)
  })

  it.each(FILES)("%s uses the 348 temp table names, no stale 346", (_name, sql) => {
    expect(sql).not.toMatch(/_346/)
  })

  it("snapshots and restores the view ACL", () => {
    expect(MIGRATION).toMatch(
      /CREATE TEMP TABLE _acl_v_clientes_resumen_348 ON COMMIT DROP AS\s+SELECT relacl FROM pg_class/
    )
    expect(MIGRATION).toMatch(/aclexplode\(t\.relacl\)/)
    expect(MIGRATION).toMatch(/GRANT %s ON public\.v_clientes_resumen TO/)
  })

  it("rollback snapshots and restores the view ACL", () => {
    expect(ROLLBACK).toMatch(/CREATE TEMP TABLE _acl_v_clientes_resumen_348r ON COMMIT DROP AS/)
    expect(ROLLBACK).toMatch(/GRANT %s ON public\.v_clientes_resumen TO/)
  })

  it("autocheck asserts the view keeps security_invoker", () => {
    expect(MIGRATION).toMatch(/reloptions @> ARRAY\['security_invoker=true'\]/)
    expect(MIGRATION).toMatch(/reloptions::text/)
    expect(ROLLBACK).toMatch(/reloptions::text/)
  })

  it.each(["borrar_datos_practica(TEXT)", "registrar_camino_onboarding(TEXT, TEXT)"])(
    "revokes EXECUTE on %s from anon and authenticated",
    (sig) => {
      const esc = sig.replace(/[()]/g, "\\$&")
      expect(MIGRATION).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION ${esc} FROM anon;`))
      expect(MIGRATION).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION ${esc} FROM authenticated;`))
      expect(MIGRATION).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION ${esc} TO service_role;`))
    }
  )

  it("the clientes count trigger fires on es_practica updates", () => {
    expect(MIGRATION).toMatch(/AFTER INSERT OR DELETE OR UPDATE OF es_practica ON clientes/)
    expect(ROLLBACK).toMatch(/AFTER INSERT OR DELETE ON clientes/)
  })

  it("autocheck seeds clientes_count before the cleanup and covers 'real' over 'omitido'", () => {
    expect(MIGRATION).toMatch(/UPDATE organization_usage SET clientes_count = 5 WHERE organization_id = v_org;/)
    expect(MIGRATION).toMatch(/registrar_camino_onboarding\(v_org, 'real'\)/)
  })
})
