// @vitest-environment node
import { describe, it, expect } from "vitest"
import { collapse, readByMarker, readBySuffix, stripComments } from "./helpers/sql-text"

// Migrations are applied by hand and CI has no Postgres: this pins by text what vitest cannot
// execute (verify/395_probes.sql covers the runtime against the real schema).

const mig = () => readBySuffix("_politicas_abiertas_a_service_role.sql")
const rollback = () => readByMarker("rollback", "Rollback de politicas_abiertas_a_service_role")
const probes = () => readByMarker("verify", "Verificación de politicas_abiertas_a_service_role")

const POLITICAS: [string, string][] = [
  ["Service role full access to user_notifications", "user_notifications"],
  ["Público puede registrarse en waitlist iOS", "ios_waitlist"],
  ["Público puede suscribirse al newsletter", "newsletter_subscribers"],
]

describe("politicas_abiertas_a_service_role", () => {
  it("arranca con lock_timeout y no abre transacción propia", () => {
    expect(collapse(mig()).startsWith("SET LOCAL lock_timeout = '3s';")).toBe(true)
    expect(stripComments(mig())).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im)
  })

  it("pasa cada política a service_role sin cambiar su condición", () => {
    const sql = collapse(mig())
    for (const [p, t] of POLITICAS) expect(sql).toContain(`ALTER POLICY "${p}" ON ${t} TO service_role;`)
    expect(sql).not.toMatch(/\b(USING|WITH CHECK|DROP POLICY|CREATE POLICY)\b/i)
  })

  it("no toca maintenance_banner", () => {
    expect(collapse(mig())).not.toMatch(/ON maintenance_banner/)
  })

  it("el rollback devuelve cada política a public", () => {
    const sql = collapse(rollback())
    for (const [p, t] of POLITICAS) expect(sql).toContain(`ALTER POLICY "${p}" ON ${t} TO public;`)
  })

  it("las probes prueban como anon y como service_role y terminan en ROLLBACK", () => {
    const sql = collapse(probes())
    expect(sql).toContain("SET LOCAL ROLE anon;")
    expect(sql).toContain("SET LOCAL ROLE service_role;")
    expect(stripComments(probes()).trim()).toMatch(/ROLLBACK;$/)
  })
})
