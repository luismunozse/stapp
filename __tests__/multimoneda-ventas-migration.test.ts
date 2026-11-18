// @vitest-environment node
import { describe, it, expect } from "vitest"
import { readFileSync, existsSync } from "fs"
import { join } from "path"
import { collapse, stripComments } from "./helpers/sql-text"

// Migration 412 (multimoneda S5): crear_venta_atomica and editar_venta_atomica keep the origin
// snapshot of each line (moneda_origen, precio_origen, tipo_cambio) and the sale its rate, and never
// store a raw foreign purchase price as a local cost. Pinned by text: CI has no Postgres
// (verify/412_probes.sql covers the runtime).
const ROOT = process.cwd()
const MIG = join(ROOT, "supabase/migrations")
const SQL_PATH = join(MIG, "412_multimoneda_ventas.sql")
const ROLLBACK_PATH = join(MIG, "rollback/412_rollback.sql")
const PROBES_PATH = join(MIG, "verify/412_probes.sql")
const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8").replace(/\r\n/g, "\n") : "")
const SQL = read(SQL_PATH)
const RB = read(ROLLBACK_PATH)
const PR = read(PROBES_PATH)
const M406 = read(join(MIG, "406_pos_no_vende_stock_reservado.sql"))
const M372 = read(join(MIG, "372_editar_venta_factura_anulada.sql"))

const CREAR_START = "CREATE OR REPLACE FUNCTION public.crear_venta_atomica("
const CREAR_END = "$function$\n;"
const EDITAR_START = "CREATE OR REPLACE FUNCTION editar_venta_atomica("
const EDITAR_END = "$$ LANGUAGE plpgsql;"

/** The whole CREATE OR REPLACE FUNCTION statement, comments included ("" when missing). */
const stmt = (text: string, from: string, to: string) => {
  const a = text.indexOf(from)
  if (a < 0) return ""
  const b = text.indexOf(to, a)
  return b < 0 ? "" : text.slice(a, b + to.length)
}
/** The parameter list, whitespace collapsed. */
const firma = (statement: string) => {
  const m = statement.match(/FUNCTION [\w.]+\(([\s\S]*?)\)\s*RETURNS/)
  return m ? m[1].replace(/\s+/g, " ").trim() : ""
}
/** Lines of `a` (trimmed, non-empty) missing from `b`, counted as a multiset. */
const faltantes = (a: string, b: string) => {
  const pool = new Map<string, number>()
  for (const l of b.split("\n").map((x) => x.trim()).filter(Boolean)) pool.set(l, (pool.get(l) ?? 0) + 1)
  const out: string[] = []
  for (const l of a.split("\n").map((x) => x.trim()).filter(Boolean)) {
    const n = pool.get(l) ?? 0
    if (n > 0) pool.set(l, n - 1)
    else out.push(l)
  }
  return out
}

const CREAR_406 = stmt(M406, CREAR_START, CREAR_END)
const EDITAR_372 = stmt(M372, EDITAR_START, EDITAR_END)
const CREAR_412 = stmt(SQL, CREAR_START, CREAR_END)
const EDITAR_412 = stmt(SQL, EDITAR_START, EDITAR_END)

describe("migration 412: la venta guarda la foto de origen y la cotización", () => {
  it("exists with rollback and probes", () => {
    expect(existsSync(SQL_PATH)).toBe(true)
    expect(existsSync(ROLLBACK_PATH)).toBe(true)
    expect(existsSync(PROBES_PATH)).toBe(true)
  })

  it("source definitions are found (the comparisons below are not vacuous)", () => {
    expect(CREAR_406.length).toBeGreaterThan(1000)
    expect(EDITAR_372.length).toBeGreaterThan(1000)
    expect(firma(CREAR_406)).toMatch(/^p_org_id text, .* p_sucursal_id text DEFAULT NULL::text$/)
    expect(firma(EDITAR_372)).toMatch(/^p_org_id TEXT, .* p_deposito_id TEXT DEFAULT NULL$/)
  })

  it("transaction hygiene: lock_timeout first, no BEGIN/COMMIT, no DROP, no grant or security change", () => {
    const code = collapse(SQL)
    expect(code.startsWith("SET LOCAL lock_timeout = '3s';")).toBe(true)
    expect(stripComments(SQL)).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im)
    expect(code).not.toMatch(/\bDROP\s+FUNCTION\b/i)
    expect(code).not.toMatch(/\b(GRANT|REVOKE|ALTER FUNCTION|SECURITY DEFINER|SECURITY INVOKER|SET search_path)\b/i)
    expect(code).not.toMatch(/\b(ALTER TABLE|CREATE TABLE|CREATE INDEX)\b/i)
    expect(code.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(2)
  })

  it("aborts before replacing anything when the 365 columns are missing", () => {
    const code = collapse(SQL)
    const abort = code.indexOf("RAISE EXCEPTION 'Abort:")
    expect(abort).toBeGreaterThan(-1)
    expect(abort).toBeLessThan(code.indexOf("CREATE OR REPLACE FUNCTION"))
    expect(code).toMatch(/table_name = 'items_venta' AND column_name = 'moneda_origen'/)
    expect(code).toMatch(/table_name = 'ventas' AND column_name = 'tipo_cambio_fuente'/)
    expect(code).toMatch(/table_name = 'inventario' AND column_name = 'moneda'/)
  })

  it("same signatures as 406 (crear) and 372 (editar)", () => {
    expect(CREAR_412).not.toBe("")
    expect(EDITAR_412).not.toBe("")
    expect(firma(CREAR_412)).toBe(firma(CREAR_406))
    expect(firma(EDITAR_412)).toBe(firma(EDITAR_372))
    expect(collapse(CREAR_412)).toMatch(/\) RETURNS jsonb LANGUAGE plpgsql AS \$function\$/)
    expect(collapse(EDITAR_412)).toMatch(/\) RETURNS JSONB AS \$\$/)
  })

  // The only 406/372 lines that may change: the cost lookups the brief replaces and the last
  // column/value of each INSERT, which gain a trailing comma or the new columns.
  it("crear: every line of 406 survives except the cost lookup and the INSERT tails", () => {
    expect(faltantes(CREAR_406, CREAR_412)).toEqual([
      "idempotency_key, sucursal_id",
      "p_sucursal_id",
      "SELECT precio_compra INTO v_inv_costo",
      "IF v_inv_costo IS NULL AND (v_item ? 'costo') AND (v_item->>'costo') IS NOT NULL THEN",
      "costo_unitario_snapshot",
      "v_inv_costo",
    ])
  })

  it("editar: every line of 372 survives except the cost fallback and the INSERT tail", () => {
    expect(faltantes(EDITAR_372, EDITAR_412)).toEqual([
      "SELECT precio_compra INTO v_inv_costo",
      "costo_unitario_snapshot",
      "v_inv_costo",
    ])
  })

  it("crear: one currency and one rate per sale, else 22023 TIPO_CAMBIO_MIXTO, before the ventas INSERT", () => {
    const body = collapse(CREAR_412)
    const raise = body.search(/RAISE EXCEPTION 'TIPO_CAMBIO_MIXTO' USING ERRCODE = '22023'/)
    expect(raise).toBeGreaterThan(-1)
    expect(raise).toBeLessThan(body.indexOf("INSERT INTO ventas ("))
    expect(body).toMatch(/v_tc IS NULL OR v_tc <= 0/)
    expect(body).toMatch(/IS DISTINCT FROM v_tc/)
    expect(body).toMatch(/IS DISTINCT FROM v_moneda_origen/)
  })

  it("crear: ventas gets tipo_cambio and tipo_cambio_fuente", () => {
    const body = collapse(CREAR_412)
    expect(body).toMatch(/INSERT INTO ventas \([^)]*idempotency_key, sucursal_id, tipo_cambio, tipo_cambio_fuente \) VALUES \(/)
    expect(body).toMatch(/p_sucursal_id, v_tc, v_tc_fuente \) RETURNING id INTO v_venta_id;/)
  })

  it("crear: foreign line costs come from costoUnitario; a foreign inventory price is never a local cost", () => {
    const body = collapse(CREAR_412)
    expect(body).toMatch(/v_inv_costo := NULLIF\(v_item->>'costoUnitario', ''\)::DECIMAL;/)
    expect(body).toMatch(/SELECT precio_compra, moneda INTO v_inv_costo, v_inv_moneda FROM inventario WHERE id = \(v_item->>'inventarioId'\);/)
    expect(body).toMatch(/IF v_inv_moneda IS NOT NULL THEN v_inv_costo := NULL; ELSIF v_inv_costo IS NULL AND \(v_item \? 'costo'\)/)
  })

  it("both: the items_venta INSERT carries moneda_origen, precio_origen, tipo_cambio", () => {
    for (const s of [CREAR_412, EDITAR_412]) {
      expect(collapse(s)).toMatch(
        /INSERT INTO items_venta \( venta_id, [^)]*costo_unitario_snapshot, moneda_origen, precio_origen, tipo_cambio \) VALUES \(/
      )
    }
  })

  it("editar: keeps the snapshot only when the unit price did not change; never touches the sale rate", () => {
    const body = collapse(EDITAR_412)
    expect(body).toMatch(/INTO v_origenes/)
    expect(body).toMatch(/iv\.moneda_origen IS NOT NULL/)
    expect(body).toMatch(
      /v_origen := v_origenes->v_clave; IF \(v_item->>'precioUnitario'\)::DECIMAL IS DISTINCT FROM \(v_origen->>'precio_unitario'\)::DECIMAL THEN v_origen := NULL; END IF;/
    )
    expect(body).toMatch(/v_origen->>'moneda_origen', \(v_origen->>'precio_origen'\)::DECIMAL, \(v_origen->>'tipo_cambio'\)::DECIMAL \) RETURNING id INTO v_item_id;/)
    expect(body).toMatch(/SELECT precio_compra, moneda INTO v_inv_costo, v_inv_moneda FROM inventario WHERE id = \(v_item->>'inventarioId'\);/)
    expect(body).toMatch(/IF v_inv_moneda IS NOT NULL THEN v_inv_costo := NULL; END IF;/)
    expect(body).not.toMatch(/tipo_cambio_fuente/)
    expect(body).not.toMatch(/monedaOrigen/)
  })

  it("rollback recreates the exact 406 and 372 definitions, nothing else", () => {
    const rb = collapse(RB)
    expect(rb.startsWith("SET LOCAL lock_timeout = '3s';")).toBe(true)
    expect(rb).toContain(collapse(CREAR_406))
    expect(rb).toContain(collapse(EDITAR_372))
    expect(rb.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(2)
    expect(rb).not.toMatch(/moneda_origen|precio_origen|tipo_cambio|\bDROP\b|\bGRANT\b|\bREVOKE\b/i)
    expect(stripComments(RB)).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im)
  })

  it("probes: one transaction ending in ROLLBACK, inline rollback rehearsal, the brief's cases", () => {
    expect(PR.trimStart().split("\n").find((l) => l.trim() && !l.startsWith("--"))).toBe("BEGIN;")
    expect(PR).toMatch(/ROLLBACK;\s*$/)
    const inline = PR.split("-- ROLLBACK:BEGIN")[1]?.split("-- ROLLBACK:END")[0] ?? ""
    expect(collapse(inline)).toBe(collapse(RB))
    const pr = stripComments(PR)
    expect(pr).toMatch(/INSERT INTO organizations/)
    expect(pr).toMatch(/'monedaOrigen', p_moneda, 'precioOrigen', p_origen, 'tipoCambio', p_tc,/)
    expect(pr).toMatch(/'costoUnitario', p_costo/)
    // monedaOrigen USD, precioOrigen 10, tipoCambio 1200, costoUnitario 7250 next to a local line
    expect(pr).toMatch(/pg_temp\.linea\(pg_temp\.s\('L'\), 1000\),\s*pg_temp\.linea_div\(pg_temp\.s\('U'\), 12000, 'USD', 10, 1200, 7250\)\), 13000\)/)
    expect(pr).toMatch(/'USD\|10\|1200\|7250'/)
    expect(pr).toMatch(/'NULL\|NULL\|NULL\|NULL'/)
    expect(pr).toMatch(/22023 TIPO_CAMBIO_MIXTO/)
    expect(pr).toMatch(/editar_venta_atomica\(/)
    expect(pr).toMatch(/convertir_cotizacion_venta_atomica\(/)
    expect(pr).toMatch(/pg_get_functiondef\([^)]*\) ~ 'moneda_origen'/)
    expect(pr).toMatch(/INSERT INTO _r SELECT 999, [^;]*FROM _r;/)
  })
})
