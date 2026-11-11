// @vitest-environment node
import { describe, it, expect } from "vitest"
import { collapse, readByMarker, readBySuffix, stripComments } from "./helpers/sql-text"

// Migrations are applied by hand and CI has no Postgres: this pins by text what vitest cannot
// execute (verify/394_probes.sql runs both RPCs against the real schema).

const mig = () => readBySuffix("_cobros_replay_antes_de_validar.sql")
const rollback = () => readByMarker("rollback", "Rollback de cobros_replay_antes_de_validar")
const probes = () => readByMarker("verify", "Verificación de cobros_replay_antes_de_validar")

function cuerpo(sql: string, fn: string): string {
  const i = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`)
  expect(i).toBeGreaterThanOrEqual(0)
  const j = sql.indexOf("$function$", sql.indexOf("$function$", i) + 1)
  return sql.slice(i, j)
}

describe("cobros_replay_antes_de_validar (394)", () => {
  it("arranca con lock_timeout y no abre transacción propia", () => {
    expect(collapse(mig()).startsWith("SET LOCAL lock_timeout = '3s';")).toBe(true)
    expect(stripComments(mig())).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im)
  })

  it.each(["registrar_cobros_orden_atomica", "registrar_pago_factura_atomica"])(
    "%s reclama la clave antes de validar el monto",
    (fn) => {
      const c = stripComments(cuerpo(mig(), fn))
      const claim = c.indexOf("INSERT INTO pago_idempotency")
      const valida = c.indexOf("RAISE EXCEPTION 'El monto total")
      expect(claim).toBeGreaterThan(0)
      expect(valida).toBeGreaterThan(0)
      expect(claim).toBeLessThan(valida)
    },
  )

  it("el rollback deja la validación antes de la clave, como estaba", () => {
    for (const fn of ["registrar_cobros_orden_atomica", "registrar_pago_factura_atomica"]) {
      const c = stripComments(cuerpo(rollback(), fn))
      expect(c.indexOf("RAISE EXCEPTION 'El monto total")).toBeLessThan(c.indexOf("INSERT INTO pago_idempotency"))
    }
  })

  it("los probes prueban el reintento y terminan en ROLLBACK", () => {
    const sql = stripComments(probes())
    expect(sql).toContain("probe-394-orden")
    expect(sql).toContain("probe-394-factura")
    expect(sql.trim().endsWith("ROLLBACK;")).toBe(true)
  })
})
