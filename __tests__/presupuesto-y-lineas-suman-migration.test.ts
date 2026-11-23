import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"

const leer = (p: string) => readFileSync(path.join(process.cwd(), "supabase/migrations", p), "utf8")
const sql = leer("421_presupuesto_y_lineas_suman.sql")
const rollback = leer("rollback/421_rollback.sql")

describe("migración 421: presupuesto + líneas suman sin duplicar", () => {
  it("agrega la marca a servicios y repuestos, con default FALSE (suma al cobro)", () => {
    for (const tabla of ["servicios_orden", "repuestos_orden"]) {
      expect(sql).toMatch(
        new RegExp(`ALTER TABLE ${tabla}\\s+ADD COLUMN IF NOT EXISTS incluido_en_presupuesto BOOLEAN NOT NULL DEFAULT FALSE`)
      )
    }
  })

  it("las líneas existentes de órdenes con cotización quedan incluidas ANTES de redefinir el trigger (no mueve montos)", () => {
    const backfill = sql.indexOf("UPDATE repuestos_orden SET incluido_en_presupuesto = TRUE")
    const trigger = sql.indexOf("CREATE TRIGGER repuestos_orden_sincroniza_monto")
    expect(backfill).toBeGreaterThan(-1)
    expect(backfill).toBeLessThan(trigger)
  })

  it("cotización vigente = misma definición que cotizacionesVigentesDeOrden", () => {
    const fn = sql.slice(sql.indexOf("FUNCTION orden_tiene_cotizacion_vigente"))
    expect(fn).toMatch(/deleted_at IS NULL/)
    expect(fn).toMatch(/reemplazada_por IS NULL/)
    expect(fn).toMatch(/estado::text <> 'RECHAZADA'/)
  })

  it("suma_lineas_orden suma las cotizaciones vigentes y excluye lo incluido solo si hay cotización", () => {
    const fn = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION suma_lineas_orden"), sql.indexOf("COMMENT ON FUNCTION suma_lineas_orden"))
    expect(fn).toMatch(/SUM\(total\) FROM cotizaciones/)
    expect((fn.match(/NOT \(incluido_en_presupuesto AND \(SELECT hay FROM cot\)\)/g) || []).length).toBe(2)
  })

  it("agregar_servicio_orden reemplaza la firma vieja en vez de crear una sobrecarga", () => {
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS agregar_servicio_orden\(TEXT, TEXT, TEXT, TEXT, INTEGER, NUMERIC\);/)
    expect(sql).toMatch(/p_incluido_en_presupuesto BOOLEAN DEFAULT FALSE/)
  })

  it("el trigger de repuestos escucha la marca", () => {
    expect(sql).toMatch(/UPDATE OF cantidad, precio_unitario, precio_venta_unitario, orden_id, incluido_en_presupuesto/)
  })

  it("el rollback vuelve a la 420 y borra lo nuevo", () => {
    expect(rollback).toMatch(/DROP FUNCTION IF EXISTS marcar_servicio_incluido_presupuesto/)
    expect(rollback).toMatch(/DROP FUNCTION IF EXISTS agregar_servicio_orden\(TEXT, TEXT, TEXT, TEXT, INTEGER, NUMERIC, BOOLEAN\)/)
    expect(rollback).toMatch(/ALTER TABLE servicios_orden DROP COLUMN IF EXISTS incluido_en_presupuesto/)
    expect(rollback).toMatch(/ALTER TABLE repuestos_orden DROP COLUMN IF EXISTS incluido_en_presupuesto/)
    expect(rollback).not.toMatch(/incluido_en_presupuesto AND/)
  })
})
