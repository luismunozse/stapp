// @vitest-environment node
import { describe, it, expect } from "vitest"
import { collapse, readByMarker, readBySuffix, stripComments } from "./helpers/sql-text"

// Migrations are applied by hand and CI has no Postgres: this pins by text what vitest cannot
// execute (verify/399_probes.sql covers the runtime against the real schema).

const mig = () => readBySuffix("_garantias_desde_entrega.sql")
const rollback = () => readByMarker("rollback", "Rollback de garantias_desde_entrega")
const probes = () => readByMarker("verify", "Verificación de garantias_desde_entrega")

/** Body of one CREATE FUNCTION, collapsed. */
function funcion(sql: string, nombre: string): string {
  const c = collapse(sql)
  const start = c.indexOf(`CREATE OR REPLACE FUNCTION ${nombre}()`)
  expect(start).toBeGreaterThanOrEqual(0)
  return c.slice(start, c.indexOf("$$ LANGUAGE", c.indexOf("AS $$", start) + 5))
}

describe("garantias_desde_entrega", () => {
  it("arranca con lock_timeout y no abre transacción propia", () => {
    expect(collapse(mig()).startsWith("SET LOCAL lock_timeout = '3s';")).toBe(true)
    expect(stripComments(mig())).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im)
  })

  it("agrega las condiciones del presupuesto a la orden, con checks NOT VALID", () => {
    const sql = collapse(mig())
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS garantia_presupuesto_dias INTEGER")
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS garantia_presupuesto_alcance TEXT")
    expect(sql).toContain("CHECK (garantia_presupuesto_dias >= 0) NOT VALID")
    expect(sql).toContain("CHECK (garantia_presupuesto_alcance IN ('REPUESTO', 'MANO_OBRA', 'AMBOS', 'NINGUNA')) NOT VALID")
  })

  it("al entregar escribe el vencimiento con UPDATE (trigger AFTER) y toma el máximo con la garantía", () => {
    const f = funcion(mig(), "registrar_cambio_estado_tiempo")
    expect(f).not.toContain("NEW.public_token_expires_at :=")
    expect(f).toContain("UPDATE ordenes_servicio SET public_token_expires_at = GREATEST( NOW() + INTERVAL '30 days',")
    expect(f).toContain("SELECT MAX(g.fecha_vencimiento) + INTERVAL '1 day' FROM garantias g WHERE g.orden_id = NEW.id")
    // Conserva lo que hacía la 142.
    expect(f).toContain("INSERT INTO orden_tiempos_estado")
    expect(f).toContain("NEW.estado IN ('ENTREGADO', 'ENTREGADO_SIN_REPARACION', 'ENTREGADO_SIN_COBRO')")
    expect(collapse(mig())).toContain(
      "CREATE TRIGGER trg_orden_cambio_estado_tiempo AFTER UPDATE OF estado ON ordenes_servicio"
    )
  })

  it("una garantía nueva o extendida solo estira el token, nunca lo acorta ni lo pone a uno sin vencimiento", () => {
    const f = funcion(mig(), "extender_token_publico_por_garantia")
    expect(f).toContain("public_token_expires_at IS NOT NULL")
    expect(f).toContain("public_token_expires_at < NEW.fecha_vencimiento + INTERVAL '1 day'")
    expect(collapse(mig())).toContain(
      "CREATE TRIGGER trg_garantia_extiende_token_publico AFTER INSERT OR UPDATE OF fecha_vencimiento ON garantias"
    )
  })

  it("el backfill solo estira tokens con vencimiento", () => {
    const sql = collapse(mig())
    const backfill = sql.slice(sql.lastIndexOf("UPDATE ordenes_servicio o"))
    expect(backfill).toContain("o.public_token_expires_at IS NOT NULL")
    expect(backfill).toContain("o.public_token_expires_at < g.fin")
  })

  it("el rollback quita trigger, función y columnas", () => {
    const sql = collapse(rollback())
    expect(sql).toContain("DROP TRIGGER IF EXISTS trg_garantia_extiende_token_publico ON garantias;")
    expect(sql).toContain("DROP FUNCTION IF EXISTS extender_token_publico_por_garantia();")
    expect(sql).toContain("DROP COLUMN IF EXISTS garantia_presupuesto_dias")
    expect(sql).toContain("DROP COLUMN IF EXISTS garantia_presupuesto_alcance")
  })

  it("las probes entregan una orden, le crean garantía y terminan en ROLLBACK", () => {
    const sql = collapse(probes())
    expect(sql).toContain("UPDATE ordenes_servicio SET estado = 'ENTREGADO'")
    expect(sql).toContain("INSERT INTO garantias")
    expect(stripComments(probes()).trim()).toMatch(/ROLLBACK;$/)
  })
})
