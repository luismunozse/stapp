// @vitest-environment node
import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { join } from "path"

// Las migraciones se aplican a mano y no hay Postgres en CI: este test fija por
// texto lo que vitest no puede ejecutar. La tabla guarda correos de usuarios de
// TODOS los talleres y solo la toca el service role.
const SQL = readFileSync(join(process.cwd(), "supabase/migrations/346_android_beta_testers.sql"), "utf8")

describe("migración 346: android_beta_testers", () => {
  it("RLS activo y sin policies", () => {
    expect(SQL).toMatch(/ALTER TABLE android_beta_testers ENABLE ROW LEVEL SECURITY/)
    expect(SQL).not.toMatch(/CREATE POLICY/i)
  })

  it("revoca todo a PUBLIC, anon y authenticated, con la tabla calificada con public.", () => {
    expect(SQL).toMatch(
      /REVOKE ALL ON public\.android_beta_testers FROM PUBLIC, anon, authenticated;/
    )
  })

  it("un usuario, una fila: user_id UNIQUE; estado acotado por CHECK", () => {
    expect(SQL).toMatch(/user_id\s+TEXT NOT NULL UNIQUE REFERENCES users\(id\) ON DELETE CASCADE/)
    expect(SQL).toMatch(/CHECK \(estado IN \('PENDIENTE', 'AGREGADO', 'DESCARTADO'\)\)/)
  })
})
