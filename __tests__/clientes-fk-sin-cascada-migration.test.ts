// @vitest-environment node
import { describe, it, expect } from "vitest"
import { collapse, readByMarker, readBySuffix, stripComments } from "./helpers/sql-text"

// Migrations are applied by hand and CI has no Postgres: this pins by text what vitest cannot
// execute (verify/396_probes.sql covers the runtime against the real schema).

const mig = () => readBySuffix("_clientes_fk_sin_cascada.sql")
const rollback = () => readByMarker("rollback", "Rollback de clientes_fk_sin_cascada")
const probes = () => readByMarker("verify", "Verificación de clientes_fk_sin_cascada")

const TABLAS = ["ordenes_servicio", "cuenta_corriente", "recepciones"]

describe("clientes_fk_sin_cascada", () => {
  it("arranca con lock_timeout y no abre transacción propia", () => {
    expect(collapse(mig()).startsWith("SET LOCAL lock_timeout = '3s';")).toBe(true)
    expect(stripComments(mig())).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im)
  })

  it("recrea cada FK con NO ACTION (no RESTRICT ni CASCADE), NOT VALID y la valida", () => {
    const sql = collapse(stripComments(mig()))
    for (const t of TABLAS) {
      const fk = `${t}_cliente_id_fkey`
      expect(sql).toContain(`ALTER TABLE ${t} DROP CONSTRAINT ${fk};`)
      expect(sql).toContain(
        `ALTER TABLE ${t} ADD CONSTRAINT ${fk} FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE NO ACTION NOT VALID;`
      )
      expect(sql).toContain(`ALTER TABLE ${t} VALIDATE CONSTRAINT ${fk};`)
    }
    expect(sql).not.toMatch(/ON DELETE (CASCADE|RESTRICT)/)
  })

  it("no toca las FKs de configuración y logs", () => {
    const sql = collapse(stripComments(mig()))
    expect(sql).not.toMatch(/sectores_cliente|notification_logs/)
  })

  it("el rollback vuelve a CASCADE", () => {
    const sql = collapse(rollback())
    for (const t of TABLAS) {
      expect(sql).toContain(
        `ALTER TABLE ${t} ADD CONSTRAINT ${t}_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE;`
      )
    }
  })

  it("las probes intentan borrar un cliente con órdenes y terminan en ROLLBACK", () => {
    expect(collapse(probes())).toContain("WHEN foreign_key_violation")
    expect(stripComments(probes()).trim()).toMatch(/ROLLBACK;$/)
  })
})
