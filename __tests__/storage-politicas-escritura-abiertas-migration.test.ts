// @vitest-environment node
import { describe, it, expect } from "vitest"
import { collapse, readByMarker, readBySuffix, stripComments } from "./helpers/sql-text"

// Migrations are applied by hand and CI has no Postgres: this pins by text what vitest cannot
// execute (verify/392_probes.sql covers the runtime against the real Storage schema).

const mig = () => readBySuffix("_storage_politicas_escritura_abiertas.sql")
const rollback = () => readByMarker("rollback", "Rollback de storage_politicas_escritura_abiertas")
const probes = () => readByMarker("verify", "Verificación de storage_politicas_escritura_abiertas")

const POLITICAS = [
  "Public read firmas",
  "Public read fotos",
  "Service upload firmas",
  "Service upload fotos",
  "Service upload logos",
  "Service delete firmas",
  "Service delete fotos",
  "Service delete logos",
  "Authenticated can upload signatures",
  "Authenticated can upload order photos",
  "Authenticated can upload logos",
  "Authenticated can update logos",
  "Authenticated can delete signatures",
  "Authenticated can delete order photos",
  "Authenticated can delete logos",
]

describe("storage_politicas_escritura_abiertas", () => {
  it("arranca con lock_timeout y no abre transacción propia", () => {
    expect(collapse(mig()).startsWith("SET LOCAL lock_timeout = '3s';")).toBe(true)
    expect(stripComments(mig())).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im)
  })

  it("borra cada política y no crea ninguna", () => {
    const sql = collapse(mig())
    for (const p of POLITICAS) expect(sql).toContain(`DROP POLICY IF EXISTS "${p}" ON storage.objects;`)
    expect(sql).not.toMatch(/CREATE POLICY/i)
  })

  it("no toca la lectura de los buckets públicos", () => {
    const sql = collapse(mig())
    for (const p of ["Public read for avatars", "Public read for fotos-inventario", "Public read for logos", "Public read logos"]) {
      expect(sql).not.toContain(`"${p}"`)
    }
  })

  it("el rollback recrea cada política", () => {
    const sql = collapse(rollback())
    for (const p of POLITICAS) expect(sql).toContain(`CREATE POLICY "${p}"`)
  })

  it("los probes abren y cierran su transacción y terminan en un solo SELECT", () => {
    const sql = stripComments(probes())
    expect(sql).toMatch(/^\s*BEGIN\s*;/m)
    expect(sql.trim().endsWith("ROLLBACK;")).toBe(true)
  })
})
