// @vitest-environment node
import { describe, it, expect } from "vitest"
import { collapse, readByMarker, readBySuffix, stripComments } from "./helpers/sql-text"

// Migrations are applied by hand and CI has no Postgres: this pins by text what vitest cannot
// execute (verify/391_probes.sql covers the runtime against the real schema).

const mig = () => readBySuffix("_refresh_tokens_por_sesion.sql")
const rollback = () => readByMarker("rollback", "Rollback de refresh_tokens_por_sesion")
const probes = () => readByMarker("verify", "Verificación de refresh_tokens_por_sesion")

describe("refresh_tokens_por_sesion", () => {
  it("arranca con lock_timeout y no abre transacción propia", () => {
    expect(collapse(mig()).startsWith("SET LOCAL lock_timeout = '3s';")).toBe(true)
    expect(stripComments(mig())).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im)
  })

  it("guarda solo hashes SHA-256 únicos, ligados al usuario", () => {
    const sql = collapse(mig())
    expect(sql).toContain("user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE")
    expect(sql).toContain("CHECK (token_hash ~ '^[0-9a-f]{64}$')")
    expect(sql).toContain("UNIQUE (token_hash)")
  })

  it("queda fuera del alcance de anon y authenticated", () => {
    const sql = collapse(mig())
    expect(sql).toContain("ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;")
    expect(sql).toContain("REVOKE ALL ON refresh_tokens FROM anon, authenticated;")
    expect(sql).not.toMatch(/CREATE POLICY|GRANT /i)
  })

  it("no toca las columnas de users (el código las lee durante la transición)", () => {
    expect(collapse(mig())).not.toMatch(/ALTER TABLE users|UPDATE users/i)
  })

  it("rollback y probes", () => {
    expect(collapse(rollback())).toContain("DROP TABLE IF EXISTS refresh_tokens;")
    const p = stripComments(probes())
    expect(p).toMatch(/^\s*BEGIN\s*;/m)
    expect(p).toMatch(/SELECT orden, probe, esperado, obtenido FROM _r ORDER BY orden, probe;\s*ROLLBACK;\s*$/)
  })
})
