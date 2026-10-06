// @vitest-environment node
import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { join } from "path"

// Las migraciones se aplican a mano y no hay Postgres en CI: este test fija
// por texto las reglas de la guarda del último ADMIN, que es la única parte
// del diseño que vitest no puede ejecutar.
const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8")
const SQL = read("supabase/migrations/338_eliminacion_de_cuenta.sql")

describe("migración 338: eliminación de cuenta", () => {
  it("agrega las dos columnas y sus índices parciales", () => {
    expect(SQL).toMatch(/ALTER TABLE organizations\s+ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ/)
    expect(SQL).toMatch(/ALTER TABLE users\s+ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ/)
    expect(SQL).toMatch(/organizations_deletion_requested_at_idx[\s\S]*WHERE deletion_requested_at IS NOT NULL/)
    expect(SQL).toMatch(/users_deleted_at_idx[\s\S]*WHERE deleted_at IS NOT NULL/)
  })

  it("bloquea las filas ADMIN activas en orden estable (sin deadlock entre dos bajas)", () => {
    expect(SQL).toMatch(/rol::text = 'ADMIN'\s+AND deleted_at IS NULL\s+ORDER BY id\s+FOR UPDATE/)
  })

  it("devuelve los cuatro estados y marca al usuario en la misma transacción", () => {
    for (const estado of ["'OK'", "'LAST_ADMIN'", "'ALREADY_DELETED'", "'NOT_FOUND'"]) {
      expect(SQL).toContain(`RETURN ${estado}`)
    }
    expect(SQL).toMatch(/UPDATE users\s+SET deleted_at = now\(\),\s*activo = false,\s*refresh_token = NULL,\s*refresh_token_expires = NULL/)
  })

  it("es SECURITY DEFINER con search_path fijo y solo service_role puede ejecutarla", () => {
    expect(SQL).toMatch(/SECURITY DEFINER SET search_path = public, pg_temp/)
    expect(SQL).toMatch(/REVOKE EXECUTE ON FUNCTION solicitar_baja_usuario\(TEXT\) FROM PUBLIC/)
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION solicitar_baja_usuario\(TEXT\) TO service_role/)
  })

  it("no abre su propia transacción (db-run.mjs la maneja)", () => {
    expect(SQL).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im)
  })

  it("el rollback deshace todo en orden inverso", () => {
    const rb = read("supabase/migrations/rollback/338_rollback.sql")
    expect(rb).toMatch(/DROP FUNCTION IF EXISTS solicitar_baja_usuario\(TEXT\)/)
    expect(rb).toMatch(/DROP COLUMN IF EXISTS deleted_at/)
    expect(rb).toMatch(/DROP COLUMN IF EXISTS deletion_requested_at/)
  })
})
