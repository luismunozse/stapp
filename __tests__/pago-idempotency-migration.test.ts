// @vitest-environment node
import { describe, it, expect } from "vitest"
import { collapse, readByMarker, readBySuffix, stripComments } from "./helpers/sql-text"

// Migrations are applied by hand and CI has no Postgres: this pins by text what vitest cannot
// execute (verify/393_probes.sql runs the three payment RPCs against the real schema).

const mig = () => readBySuffix("_pago_idempotency_crear.sql")
const rollback = () => readByMarker("rollback", "Rollback de pago_idempotency_crear")
const probes = () => readByMarker("verify", "Verificación de pago_idempotency_crear")

describe("pago_idempotency_crear (393)", () => {
  it("arranca con lock_timeout y no abre transacción propia", () => {
    expect(collapse(mig()).startsWith("SET LOCAL lock_timeout = '3s';")).toBe(true)
    expect(stripComments(mig())).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im)
  })

  it("crea la tabla con las columnas que usan las tres funciones y la clave compuesta", () => {
    const sql = collapse(mig())
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS pago_idempotency (")
    for (const col of ["organization_id TEXT NOT NULL", "idempotency_key TEXT NOT NULL", "venta_id TEXT,", "orden_id TEXT,", "factura_id TEXT,", "response JSONB"]) {
      expect(sql).toContain(col)
    }
    expect(sql).toContain("PRIMARY KEY (organization_id, idempotency_key)")
  })

  it("solo service_role: RLS activo, sin políticas y sin privilegios de cliente", () => {
    const sql = collapse(mig())
    expect(sql).toContain("ALTER TABLE pago_idempotency ENABLE ROW LEVEL SECURITY;")
    expect(sql).toContain("REVOKE ALL ON pago_idempotency FROM anon, authenticated;")
    expect(sql).not.toMatch(/CREATE POLICY/i)
  })

  it("el rollback borra la tabla", () => {
    expect(collapse(rollback())).toContain("DROP TABLE IF EXISTS pago_idempotency;")
  })

  it("los probes ejecutan las tres funciones y terminan en ROLLBACK", () => {
    const sql = stripComments(probes())
    for (const fn of ["registrar_pagos_venta_atomica", "registrar_cobros_orden_atomica", "registrar_pago_factura_atomica"]) {
      expect(sql).toContain(fn)
    }
    expect(sql).toMatch(/^\s*BEGIN\s*;/m)
    expect(sql.trim().endsWith("ROLLBACK;")).toBe(true)
  })
})
