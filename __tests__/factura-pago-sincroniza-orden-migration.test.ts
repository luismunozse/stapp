import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync } from "fs"
import { join } from "path"

// Contrato de la regla "el pago de una factura cuenta en el cobro de la orden".
//
// recalcular_estado_cobro derivaba total_cobrado solo de cobros_orden, asi que
// una orden pagada por su factura seguia PENDIENTE y "Cobrar todo" la cobraba
// de nuevo. La regla vive en total_cobrado_orden() (migracion 345):
//   GREATEST(cobros_orden no anulados, pagos_parciales de la factura NO anulada)
// GREATEST y no suma: los dos libros espejan en parte el mismo dinero (la sena
// y los pagos cargados dos veces), y sumar los duplicaria.
//
// El chequeo es sobre el SQL fuente: las migraciones se aplican a mano y no hay
// Postgres en CI. El comportamiento real se verifico en un arnes pglite fuera
// del repo. Si otra migracion reescribe recalcular_estado_cobro (p.ej. el paso
// 1d de notas de credito), este test obliga a conservar la regla.

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations")
const MIGRACION = "345_factura_pago_sincroniza_orden.sql"

function archivos(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
}

/** Cuerpo de la ultima migracion (por numero) que redefine la funcion. */
function ultimaDefinicion(fn: string): string {
  const marca = `CREATE OR REPLACE FUNCTION ${fn}(`
  let cuerpo = ""
  for (const archivo of archivos()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, archivo), "utf8")
    const inicio = sql.lastIndexOf(marca)
    if (inicio === -1) continue
    const abre = sql.indexOf("$$", inicio)
    const cierra = sql.indexOf("$$", abre + 2)
    cuerpo = sql.slice(abre + 2, cierra)
  }
  return cuerpo
}

const sinComentarios = (sql: string) =>
  sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")

describe("migracion 345: pago de factura sincroniza la orden", () => {
  const sql = readFileSync(join(MIGRATIONS_DIR, MIGRACION), "utf8")
  const codigo = sinComentarios(sql)

  it("la definicion vigente de recalcular_estado_cobro usa total_cobrado_orden", () => {
    const cuerpo = ultimaDefinicion("recalcular_estado_cobro")
    expect(cuerpo).toContain("total_cobrado_orden(p_orden_id)")
    // ya no deriva el total solo de cobros_orden
    expect(cuerpo).not.toMatch(/SUM\(monto\)[\s\S]*FROM cobros_orden/)
  })

  it("total_cobrado_orden es GREATEST de los dos libros y excluye anulados", () => {
    const cuerpo = ultimaDefinicion("total_cobrado_orden")
    expect(cuerpo).toMatch(/GREATEST\(/)
    expect(cuerpo).toMatch(/FROM\s+cobros_orden/)
    expect(cuerpo).toMatch(/c\.anulado\s*=\s*FALSE/)
    expect(cuerpo).toMatch(/FROM\s+pagos_parciales/)
    expect(cuerpo).toMatch(/f\.estado_pago::text\s*<>\s*'ANULADA'/)
    // jamas la suma de ambos libros
    expect(cuerpo).not.toMatch(/\)\s*\+\s*COALESCE/)
  })

  it("bloquea la orden (FOR UPDATE) ANTES de sumar, en sentencias separadas", () => {
    const cuerpo = sinComentarios(ultimaDefinicion("recalcular_estado_cobro"))
    const lock = cuerpo.indexOf("PERFORM 1 FROM ordenes_servicio WHERE id = p_orden_id FOR UPDATE;")
    const suma = cuerpo.indexOf("v_total_cobrado := total_cobrado_orden(p_orden_id);")
    expect(lock).toBeGreaterThan(-1)
    expect(suma).toBeGreaterThan(lock)
    // el lock es la primera sentencia ejecutable tras el BEGIN
    const trasBegin = cuerpo.slice(cuerpo.indexOf("BEGIN") + "BEGIN".length).trim()
    expect(trasBegin.startsWith("PERFORM 1 FROM ordenes_servicio")).toBe(true)
  })

  it("el estado se sigue comparando contra costo_final - descuento_cobro", () => {
    const cuerpo = ultimaDefinicion("recalcular_estado_cobro")
    expect(cuerpo).toContain("v_costo_final := v_costo_final - v_descuento;")
    expect(cuerpo).toContain("v_total_cobrado >= v_costo_final")
  })

  it("hay triggers sobre pagos_parciales y facturas (estado_pago y DELETE)", () => {
    expect(codigo).toMatch(/CREATE TRIGGER pagos_parciales_recalcular_cobro[\s\S]*?ON pagos_parciales/)
    expect(codigo).toMatch(/AFTER INSERT OR UPDATE OF monto, factura_id OR DELETE ON pagos_parciales/)
    expect(codigo).toMatch(/AFTER UPDATE OF estado_pago ON facturas/)
    expect(codigo).toMatch(/AFTER DELETE ON facturas/)
  })

  it("una factura sin orden_id no hace nada", () => {
    expect(codigo).toMatch(/IF v_orden_id IS NOT NULL THEN/)
  })

  it("no crea dinero: ningun INSERT en tablas de cobro ni de caja", () => {
    expect(codigo).not.toMatch(/INSERT\s+INTO\s+(cobros_orden|pagos_parciales|movimientos_caja|cuenta_corriente|pagos_venta)/i)
  })

  it("no engancha ordenes_servicio: sin recursion con el trigger de la 277", () => {
    expect(codigo).not.toMatch(/ON ordenes_servicio/)
  })

  it("el backfill se limita a ordenes con pagos de factura", () => {
    const backfill = codigo.slice(codigo.indexOf("WITH cambio AS ("))
    expect(backfill).toMatch(/EXISTS \(SELECT 1\s+FROM pagos_parciales p/)
  })

  it("no abre transaccion propia en las primeras 40 lineas (el runner haria commit en dry-run)", () => {
    const ventana = sql.split("\n").slice(0, 40).join("\n")
    expect(/^\s*BEGIN\s*;/im.test(ventana)).toBe(false)
    expect(/^\s*COMMIT\s*;/im.test(sql)).toBe(false)
  })

  it("documenta la limitacion y el conflicto con el paso 1d de notas de credito", () => {
    expect(sql).toMatch(/LIMITACION CONOCIDA/)
    expect(sql).toMatch(/paso 1d/)
    expect(sql).toMatch(/DEBE conservar la regla GREATEST/)
  })
})
