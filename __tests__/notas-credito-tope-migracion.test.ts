// @vitest-environment node
import { describe, it, expect } from "vitest"
import { collapse, readByMarker, readBySuffix } from "./helpers/sql-text"

// No hay Postgres en CI: esto fija lo que dice el SQL de la migracion que topa
// las NC de orden con lo cobrado y les da idempotencia. Las reglas en si viven
// en los probes (supabase/migrations/verify).
const SUFIJO = "_nc_tope_idempotencia.sql"
const MARCADOR = "nc_tope_idempotencia"

const migracion = () => readBySuffix(SUFIJO)
const sql = () => collapse(migracion())
const rollback = () => readByMarker("rollback", MARCADOR)
const probes = () => readByMarker("verify", MARCADOR)

const abreTransaccion = (texto: string) =>
  /^\s*BEGIN\s*;/im.test(texto.split("\n").slice(0, 40).join("\n"))

describe("migración nc_tope_idempotencia", () => {
  it("ni la migración ni el rollback abren su propia transacción", () => {
    expect(abreTransaccion(migracion())).toBe(false)
    expect(migracion()).not.toMatch(/^\s*COMMIT\s*;/im)
    expect(abreTransaccion(rollback())).toBe(false)
    expect(rollback()).not.toMatch(/^\s*COMMIT\s*;/im)
  })

  it("los probes abren su transacción y la revierten", () => {
    expect(abreTransaccion(probes())).toBe(true)
    expect(probes().trimEnd()).toMatch(/ROLLBACK;$/)
  })

  it("reemplaza la firma de 9 parámetros por una con p_idempotency_key al final (sin sobrecarga ambigua)", () => {
    expect(sql()).toContain(
      "DROP FUNCTION IF EXISTS crear_nota_credito(TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, JSONB);"
    )
    expect(sql()).toMatch(/CREATE OR REPLACE FUNCTION crear_nota_credito\( p_org_id TEXT, .* p_items JSONB, p_idempotency_key TEXT DEFAULT NULL \)/)
  })

  it("bloquea la orden de la organización antes de validar", () => {
    expect(sql()).toMatch(/FROM ordenes_servicio WHERE id = p_orden_id AND organization_id = p_org_id FOR UPDATE/)
  })

  it("topa con lo cobrado (total_cobrado_orden) menos las NC activas de la orden", () => {
    expect(sql()).toContain("v_cobrado := COALESCE(total_cobrado_orden(p_orden_id), 0);")
    expect(sql()).toMatch(/SUM\(monto\).* FROM notas_credito WHERE orden_id = p_orden_id AND anulada = false/)
    expect(sql()).toContain("IF v_previas + p_monto > v_cobrado THEN")
    expect(sql()).toContain("ERRCODE = 'P0040'")
  })

  it("un reintento con la misma clave devuelve la NC ya creada sin volver a escribir", () => {
    expect(sql()).toMatch(/WHERE organization_id = p_org_id AND idempotency_key = p_idempotency_key/)
    expect(sql()).toContain("'replayed', true")
    expect(sql()).toContain("NULLIF(p_idempotency_key, '')")
  })

  it("conserva la acreditación en cuenta corriente con la sucursal de la 269 y el restock", () => {
    expect(sql()).toContain(
      "PERFORM devolver_cuenta_corriente(p_org_id, v_cliente_id, p_monto, 'NOTA_CREDITO', v_nc_id, p_user_id, 'Nota de credito', v_sucursal_id);"
    )
    expect(sql()).toContain("UPDATE inventario SET stock = stock + v_cant WHERE id = v_inv_id;")
  })

  it("solo service_role puede ejecutarla", () => {
    expect(sql()).toMatch(/REVOKE EXECUTE ON FUNCTION crear_nota_credito\([^)]*\) FROM PUBLIC, anon, authenticated;/)
    expect(sql()).toMatch(/GRANT EXECUTE ON FUNCTION crear_nota_credito\([^)]*\) TO service_role;/)
  })

  it("el rollback borra la firma nueva y restaura el cuerpo de la 269", () => {
    const rb = collapse(rollback())
    expect(rb).toContain(
      "DROP FUNCTION IF EXISTS crear_nota_credito(TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, JSONB, TEXT);"
    )
    expect(rb).toMatch(/CREATE OR REPLACE FUNCTION crear_nota_credito\( p_org_id TEXT, .* p_items JSONB \) RETURNS JSON/)
    expect(rb).not.toContain("total_cobrado_orden")
  })
})
