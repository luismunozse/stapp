// @vitest-environment node
import { describe, it, expect } from "vitest"
import { readFileSync, existsSync } from "fs"
import { join } from "path"
import { collapse, stripComments } from "./helpers/sql-text"

// Migration 409 (multimoneda S4): a variant group keeps ONE currency (sync trigger + inheritance /
// mixed-currency guard) and the kit cost converts foreign-currency components. Pinned by text: CI
// has no Postgres.
const ROOT = process.cwd()
const MIG = join(ROOT, "supabase/migrations")
const SQL_PATH = join(MIG, "409_multimoneda_catalogo.sql")
const ROLLBACK_PATH = join(MIG, "rollback/409_rollback.sql")
const PROBES_PATH = join(MIG, "verify/409_probes.sql")
const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8").replace(/\r\n/g, "\n") : "")
const SQL = read(SQL_PATH)
const RB = read(ROLLBACK_PATH)
const PR = read(PROBES_PATH)
const CODE = collapse(SQL)
// Statements outside function bodies: dollar-quoted bodies removed.
const OUTSIDE = collapse(SQL.replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, "$$$$"))

// The exact text of an older definition, from the migration that created it.
const between = (text: string, from: string, to: string) => {
  const a = text.indexOf(from)
  const b = text.indexOf(to, a)
  if (a < 0 || b < 0) throw new Error(`not found: ${from} .. ${to}`)
  return text.slice(a, b + to.length)
}
const M177 = read(join(MIG, "177_kits_bom.sql"))
const M355 = read(join(MIG, "355_variantes_grupos.sql"))
const COSTO_177 = between(M177, "CREATE OR REPLACE FUNCTION calcular_costo_kit(", "$$ LANGUAGE plpgsql STABLE;")
const SYNC_FN_355 = between(M355, "CREATE OR REPLACE FUNCTION inventario_sync_compartidos_grupo()", "$$;")
const SYNC_TRG_355 = between(M355, "AFTER UPDATE OF descripcion", "EXECUTE FUNCTION inventario_sync_compartidos_grupo();")

const fnBody = (text: string, name: string) => {
  const m = text.match(new RegExp(`CREATE OR REPLACE FUNCTION ${name}\\([\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$`))
  return m ? m[1] : ""
}

describe("migration 409: moneda del grupo de variantes y costo de kit", () => {
  it("exists with rollback and probes", () => {
    expect(existsSync(SQL_PATH)).toBe(true)
    expect(existsSync(ROLLBACK_PATH)).toBe(true)
    expect(existsSync(PROBES_PATH)).toBe(true)
  })

  it("bounds the lock wait and states the locks it takes", () => {
    expect(CODE).toMatch(/SET LOCAL lock_timeout = '3s';/)
    expect(SQL).toMatch(/SHARE ROW EXCLUSIVE/)
    expect(SQL).toMatch(/AFTER UPDATE \.\.\. FOR EACH ROW/)
  })

  it("changes no data: no DELETE, TRUNCATE or UPDATE inventario outside function bodies", () => {
    expect(CODE.length).toBeGreaterThan(0)
    expect(OUTSIDE).not.toMatch(/\bDELETE\s+FROM\b/i)
    expect(OUTSIDE).not.toMatch(/\bTRUNCATE\b/i)
    expect(OUTSIDE).not.toMatch(/\bUPDATE\s+inventario\b/i)
    expect(OUTSIDE).not.toMatch(/\bDROP\s+(TABLE|COLUMN|CONSTRAINT)\b/i)
  })

  it("sync trigger: moneda joins the SET, the IS DISTINCT FROM tuple and the UPDATE OF list", () => {
    const body = collapse(fnBody(SQL, "inventario_sync_compartidos_grupo"))
    expect(body).toMatch(/moneda = NEW\.moneda/)
    expect(body).toMatch(/i\.dias_alerta_vencimiento, i\.moneda\) IS DISTINCT FROM/)
    expect(body).toMatch(/NEW\.dias_alerta_vencimiento, NEW\.moneda\);/)
    expect(body).toMatch(/current_setting\('stapp\.sync_grupo', true\) = 'on'/)
    expect(CODE).toMatch(
      /CREATE OR REPLACE TRIGGER inventario_sync_compartidos_grupo AFTER UPDATE OF descripcion, [^;]*dias_alerta_vencimiento, moneda ON inventario FOR EACH ROW WHEN \(NEW\.grupo_id IS NOT NULL AND [^;]*OLD\.moneda\) IS DISTINCT FROM [^;]*NEW\.moneda\)\) EXECUTE FUNCTION inventario_sync_compartidos_grupo\(\);/
    )
  })

  it("new trigger: inherits on INSERT, refuses a mixed group on a grupo_id change", () => {
    expect(CODE).toMatch(/CREATE OR REPLACE FUNCTION inventario_moneda_grupo\(\) RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp/)
    const body = collapse(fnBody(SQL, "inventario_moneda_grupo"))
    expect(body).toMatch(/NEW\.moneda := v_moneda/)
    expect(body).toMatch(/OLD\.grupo_id IS NOT DISTINCT FROM NEW\.grupo_id/)
    expect(body).toMatch(/RAISE EXCEPTION 'MONEDA_GRUPO_MIXTA'[^;]*USING ERRCODE = '23514'/)
    expect(body).not.toMatch(/stapp\.sync_grupo/)
    expect(CODE).toMatch(
      /CREATE OR REPLACE TRIGGER inventario_moneda_grupo BEFORE INSERT OR UPDATE OF grupo_id ON inventario FOR EACH ROW EXECUTE FUNCTION inventario_moneda_grupo\(\);/
    )
  })

  it("kit cost: one function with the five-parameter signature and the 177 grant", () => {
    expect(CODE).toMatch(/DROP FUNCTION IF EXISTS calcular_costo_kit\(TEXT, TEXT\);/)
    expect(CODE).toMatch(
      /CREATE OR REPLACE FUNCTION calcular_costo_kit\( p_kit_id TEXT, p_org_id TEXT, p_moneda TEXT DEFAULT NULL, p_tipo_cambio NUMERIC DEFAULT NULL, p_unidad NUMERIC DEFAULT 0 \) RETURNS NUMERIC LANGUAGE plpgsql STABLE/
    )
    expect(CODE.indexOf("DROP FUNCTION IF EXISTS calcular_costo_kit(TEXT, TEXT);")).toBeLessThan(
      CODE.indexOf("CREATE OR REPLACE FUNCTION calcular_costo_kit(")
    )
    const body = collapse(fnBody(SQL, "calcular_costo_kit"))
    expect(body).toMatch(/inv\.moneda IS DISTINCT FROM p_moneda OR p_tipo_cambio IS NULL OR p_tipo_cambio <= 0/)
    expect(body).toMatch(/RETURN NULL;/)
    expect(body).toMatch(/ROUND\(COALESCE\(inv\.precio_compra, 0\) \* p_tipo_cambio \/ p_unidad\) \* p_unidad/)
    expect(body).toMatch(/ROUND\(COALESCE\(inv\.precio_compra, 0\) \* p_tipo_cambio, 2\)/)
    expect(CODE).toMatch(
      /GRANT EXECUTE ON FUNCTION calcular_costo_kit\(TEXT, TEXT, TEXT, NUMERIC, NUMERIC\) TO authenticated, service_role;/
    )
  })

  it("wrapper: saves the group and changes its currency in one function, service_role only", () => {
    const SIG = "guardar_grupo_variantes_moneda(TEXT, TEXT, JSONB, JSONB, JSONB, JSONB, TEXT, TEXT)"
    expect(CODE).toMatch(
      /CREATE OR REPLACE FUNCTION guardar_grupo_variantes_moneda\( p_org TEXT, p_user TEXT, p_grupo JSONB, p_compartidos JSONB, p_variantes JSONB, p_archivar JSONB, p_deposito_inicial TEXT, p_moneda TEXT\) RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp/
    )
    const body = collapse(fnBody(SQL, "guardar_grupo_variantes_moneda"))
    const llamada = body.indexOf(
      "guardar_grupo_variantes(p_org, p_user, p_grupo, p_compartidos, p_variantes, p_archivar, p_deposito_inicial)"
    )
    const update = body.search(/UPDATE inventario SET moneda = p_moneda WHERE grupo_id = p_grupo ->> 'id' AND organization_id = p_org/)
    expect(llamada).toBeGreaterThan(-1)
    // the currency changes AFTER the save (see the ORDER comment in the migration)
    expect(update).toBeGreaterThan(llamada)
    expect(body).toMatch(/p_moneda NOT IN \('USD', 'EUR'\)/)
    expect(CODE).toContain(`REVOKE EXECUTE ON FUNCTION ${SIG} FROM PUBLIC, anon, authenticated;`)
    expect(CODE).toContain(`GRANT EXECUTE ON FUNCTION ${SIG} TO service_role;`)
    expect(collapse(RB)).toContain(`DROP FUNCTION IF EXISTS ${SIG};`)
  })

  it("rollback restores the 177 and 355 definitions and drops the new trigger and function", () => {
    const rb = collapse(RB)
    expect(rb).toMatch(/SET LOCAL lock_timeout = '3s';/)
    expect(rb).toMatch(/DROP TRIGGER IF EXISTS inventario_moneda_grupo ON inventario;/)
    expect(rb).toMatch(/DROP FUNCTION IF EXISTS inventario_moneda_grupo\(\);/)
    expect(rb).toMatch(/DROP FUNCTION IF EXISTS calcular_costo_kit\(TEXT, TEXT, TEXT, NUMERIC, NUMERIC\);/)
    expect(rb).toContain(collapse(COSTO_177))
    expect(rb).toMatch(/GRANT EXECUTE ON FUNCTION calcular_costo_kit\(TEXT,TEXT\) TO authenticated, service_role;/)
    expect(rb).toContain(collapse(SYNC_FN_355))
    expect(rb).toContain(`CREATE OR REPLACE TRIGGER inventario_sync_compartidos_grupo ${collapse(SYNC_TRG_355)}`)
    expect(rb).not.toMatch(/\.moneda\b/)
  })

  it("probes: one transaction ending in ROLLBACK, inline rollback rehearsal, the spec cases", () => {
    expect(PR.trimStart().split("\n").find((l) => l.trim() && !l.startsWith("--"))).toBe("BEGIN;")
    expect(PR).toMatch(/ROLLBACK;\s*$/)
    const inline = PR.split("-- ROLLBACK:BEGIN")[1]?.split("-- ROLLBACK:END")[0] ?? ""
    expect(collapse(inline)).toBe(collapse(RB))
    const pr = stripComments(PR)
    expect(pr).toMatch(/23514/)
    expect(pr).toMatch(/calcular_costo_kit\([^)]*'USD', 1200, 10\)/)
    expect(pr).toMatch(/'24500'/)
    expect(pr).toMatch(/calcular_costo_kit\(k2, org\)/)
    expect(pr).toMatch(/calcular_costo_kit\([^)]*'EUR', 1200, 10\)/)
    expect(pr).toMatch(/proname = 'calcular_costo_kit'/)
    expect(pr).toMatch(/INSERT INTO _r SELECT 999, [^;]*FROM _r;/)
    // the group rules through the real save RPC and the wrapper
    expect(pr).toMatch(/guardar_grupo_variantes\(\(SELECT org FROM _s\)[\s\S]*'23514\|MONEDA_GRUPO_MIXTA'/)
    expect(pr).toMatch(/SELECT guardar_grupo_variantes\(%L, NULL/)
    expect(pr).toMatch(/SELECT guardar_grupo_variantes_moneda\(%L, NULL[^;]*'EUR'\)\);/)
  })
})
