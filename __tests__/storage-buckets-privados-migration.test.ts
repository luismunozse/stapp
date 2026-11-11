// @vitest-environment node
import { describe, it, expect } from "vitest"
import { collapse, readByMarker, readBySuffix, stripComments } from "./helpers/sql-text"

// Migrations are applied by hand and CI has no Postgres: this pins by text what vitest cannot
// execute (verify/390_probes.sql covers the runtime against the real Storage schema).

const mig = () => readBySuffix("_storage_buckets_privados.sql")
const rollback = () => readByMarker("rollback", "Rollback de storage_buckets_privados")
const probes = () => readByMarker("verify", "Verificación de storage_buckets_privados")

const BUCKETS = ["firmas", "fotos-ordenes", "comprobantes-gastos", "soporte-attachments"]
const POLITICAS = [
  "Public read for order photos",
  "Public read for signatures",
  "Public read for comprobantes-gastos",
  "soporte_attachments_read",
  "soporte_attachments_insert",
  "soporte_attachments_delete",
]

describe("storage_buckets_privados: migración", () => {
  it("arranca con lock_timeout y no abre transacción propia", () => {
    expect(collapse(mig()).startsWith("SET LOCAL lock_timeout = '3s';")).toBe(true)
    expect(stripComments(mig())).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im)
  })

  it("marca los cuatro buckets como privados y no toca otros", () => {
    const sql = collapse(mig())
    const m = /UPDATE storage\.buckets SET public = false WHERE id IN \(([^)]*)\);/.exec(sql)
    expect(m).not.toBeNull()
    const ids = m![1].split(",").map((s) => s.trim().replace(/'/g, ""))
    expect(ids.sort()).toEqual([...BUCKETS].sort())
    expect(sql).not.toMatch(/'(logos|avatars|fotos-inventario|catalogo)'/)
  })

  it("borra las políticas públicas y las abiertas de soporte", () => {
    const sql = collapse(mig())
    for (const p of POLITICAS) {
      expect(sql).toContain(`DROP POLICY IF EXISTS "${p}" ON storage.objects;`)
    }
    expect(sql).not.toMatch(/CREATE POLICY/i)
  })
})

describe("storage_buckets_privados: rollback y probes", () => {
  it("el rollback vuelve a hacer públicos los buckets y recrea cada política", () => {
    const sql = collapse(rollback())
    expect(sql).toMatch(/UPDATE storage\.buckets SET public = true WHERE id IN/)
    for (const p of POLITICAS) {
      expect(sql).toContain(`CREATE POLICY "${p}"`)
    }
  })

  it("los probes abren y cierran su transacción y terminan en un solo SELECT", () => {
    const sql = stripComments(probes())
    expect(sql).toMatch(/^\s*BEGIN\s*;/m)
    expect(sql.trim().endsWith("ROLLBACK;")).toBe(true)
    expect(sql).toMatch(/SELECT orden, probe, esperado, obtenido FROM _r ORDER BY orden, probe;\s*ROLLBACK;\s*$/)
  })
})
