import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"

const leer = (p: string) => readFileSync(path.join(process.cwd(), "supabase/migrations", p), "utf8")
const m381 = leer("381_comisiones_reparaciones.sql")
const m422 = leer("422_comision_costo_presupuesto.sql")
const rb422 = leer("rollback/422_rollback.sql")

const vista = (sql: string) =>
  sql.slice(
    sql.indexOf("CREATE OR REPLACE VIEW v_comisiones_filas"),
    sql.indexOf("GRANT SELECT ON public.v_comisiones_devengadas TO service_role;")
  )

describe("migración 422: la comisión descuenta el costo del presupuesto", () => {
  it("la vista es la de la 381 con SOLO las dos lecturas de costo cambiadas", () => {
    const esperada = vista(m381)
      .replace(
        /    CROSS JOIN LATERAL \(\n      SELECT COALESCE\(SUM\(r\.cantidad \* r\.precio_unitario\), 0\) AS costo\n        FROM repuestos_orden r WHERE r\.orden_id = o\.id\n    \) rep/,
        "    -- 422: incluye el costo cargado en el presupuesto (ver costo_repuestos_orden)\n    CROSS JOIN LATERAL (SELECT costo_repuestos_orden(o.id) AS costo) rep"
      )
      .replace(
        /LEFT JOIN LATERAL \(\n  SELECT COALESCE\(SUM\(r\.cantidad \* r\.precio_unitario\), 0\) AS costo\n    FROM repuestos_orden r WHERE r\.orden_id = o\.id\n\) rep ON f\.documento_tipo = 'ORDEN';/,
        "LEFT JOIN LATERAL (SELECT costo_repuestos_orden(o.id) AS costo) rep ON f.documento_tipo = 'ORDEN';"
      )
    expect(esperada).not.toBe(vista(m381))
    expect(vista(m422)).toBe(esperada)
  })

  it("el costo suma los ítems de cotizaciones vigentes y no duplica los repuestos incluidos", () => {
    const fn = m422.slice(m422.indexOf("CREATE OR REPLACE FUNCTION costo_repuestos_orden"), m422.indexOf("COMMENT ON FUNCTION"))
    expect(fn).toMatch(/COALESCE\(i\.costo_unitario, inv\.precio_compra\)/)
    expect(fn).toMatch(/c\.deleted_at IS NULL/)
    expect(fn).toMatch(/c\.reemplazada_por IS NULL/)
    expect(fn).toMatch(/c\.estado::text <> 'RECHAZADA'/)
    expect(fn).toMatch(/NOT \(r\.incluido_en_presupuesto AND t\.trae_costos\)/)
  })

  it("el rollback vuelve a la vista exacta de la 381 y después borra la función", () => {
    expect(vista(rb422)).toBe(vista(m381))
    expect(rb422.indexOf("DROP FUNCTION IF EXISTS costo_repuestos_orden")).toBeGreaterThan(rb422.indexOf("CREATE OR REPLACE VIEW v_comisiones_filas"))
  })
})
