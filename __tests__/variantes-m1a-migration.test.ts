// @vitest-environment node
import { describe, it, expect } from "vitest"
import { collapse, readByMarker, readBySuffix, stripComments } from "./helpers/sql-text"

// M1a (variant groups) is applied by hand and there is no Postgres in CI: this pins by
// text what vitest cannot execute. The SQL probes cover the runtime behavior.

const RAW = readBySuffix("_variantes_grupos.sql")
const SQL = collapse(RAW)
const NINE_SHARED = [
  "descripcion", "categoria", "tipo_dispositivo", "proveedor", "proveedor_id",
  "dias_garantia_default", "trackea_lotes", "trackea_series", "dias_alerta_vencimiento",
]
const block = (re: RegExp) => {
  const m = re.exec(SQL)
  if (!m) throw new Error(`pattern not found: ${re}`)
  return m[1] ?? m[0]
}
const cols = (list: string) => list.split(",").map((c) => c.trim().replace(/^(OLD|NEW)\./, ""))

describe("M1a: transaction and lock guard", () => {
  it("starts with SET LOCAL lock_timeout and documents the ACCESS EXCLUSIVE window", () => {
    expect(SQL.startsWith("SET LOCAL lock_timeout = '3s';")).toBe(true)
    expect(RAW).toMatch(/ACCESS EXCLUSIVE/)
    expect(RAW).toMatch(/off-peak/i)
  })

  it("has no BEGIN/COMMIT of its own (db-run wraps the file)", () => {
    expect(stripComments(RAW)).not.toMatch(/^\s*BEGIN\s*;/im)
    expect(SQL).not.toMatch(/\bCOMMIT\b/i)
  })

  it("is re-runnable: every create has a guard", () => {
    const creates = SQL.match(/CREATE (?:UNIQUE )?(?:TABLE|INDEX)\b/g) ?? []
    expect(creates).toHaveLength(4) // 1 table + 3 indexes
    expect(SQL.match(/CREATE (?:UNIQUE )?(?:TABLE|INDEX) IF NOT EXISTS/g)).toHaveLength(4)
    expect(SQL.match(/ADD COLUMN\b/g)).toHaveLength(2)
    expect(SQL.match(/ADD COLUMN IF NOT EXISTS/g)).toHaveLength(2)
    for (const name of SQL.match(/CREATE TRIGGER (\w+)/g)!.map((s) => s.split(" ")[2])) {
      expect(SQL).toMatch(new RegExp(`DROP TRIGGER IF EXISTS ${name} ON \\w+; CREATE TRIGGER ${name}`))
    }
    expect(SQL).toMatch(/DROP CONSTRAINT IF EXISTS inventario_grupo_no_kit, ADD CONSTRAINT inventario_grupo_no_kit/)
  })
})

describe("M1a: inventario_grupos and the new inventario columns", () => {
  const table = block(/CREATE TABLE IF NOT EXISTS inventario_grupos \((.*?)\); /)

  it("bounds nombre (1-200) and opciones (array of 1-3); purged with its org (VI-3)", () => {
    expect(table).toMatch(/nombre TEXT NOT NULL CHECK \(length\(btrim\(nombre\)\) BETWEEN 1 AND 200\)/)
    expect(table).toMatch(/jsonb_typeof\(opciones\) = 'array'/)
    expect(table).toMatch(/jsonb_array_length\(opciones\) BETWEEN 1 AND 3/)
    expect(table).toMatch(/organization_id TEXT NOT NULL REFERENCES organizations\(id\) ON DELETE CASCADE/)
    expect(table).toMatch(/created_by TEXT REFERENCES users\(id\) ON DELETE SET NULL/)
  })

  it("adds grupo_id (FK SET NULL, so ungrouping frees the child) and atributos JSONB", () => {
    expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS grupo_id TEXT REFERENCES inventario_grupos\(id\) ON DELETE SET NULL/)
    expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS atributos JSONB/)
  })

  it("one ACTIVE child per combination: partial unique index on the canonical key", () => {
    expect(SQL).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS \w+ ON inventario \(grupo_id, inventario_combinacion_clave\(atributos\)\) WHERE grupo_id IS NOT NULL AND deleted_at IS NULL/
    )
    expect(SQL).toMatch(/CREATE INDEX IF NOT EXISTS \w+ ON inventario \(grupo_id\) WHERE grupo_id IS NOT NULL/)
  })

  it("a kit can never be a child", () => {
    expect(SQL).toMatch(/ADD CONSTRAINT inventario_grupo_no_kit CHECK \(grupo_id IS NULL OR es_kit IS NOT TRUE\)/)
  })

  it("RLS on, org-scoped select for authenticated, service_role ALL, anon revoked, updated_at kept", () => {
    expect(SQL).toMatch(/ALTER TABLE inventario_grupos ENABLE ROW LEVEL SECURITY/)
    expect(SQL).toMatch(/FOR SELECT TO authenticated USING \(organization_id = public\.get_current_organization_id\(\)\)/)
    expect(SQL).toMatch(/FOR ALL TO service_role USING \(true\) WITH CHECK \(true\)/)
    expect(SQL).toMatch(/REVOKE ALL ON public\.inventario_grupos FROM PUBLIC, anon;/)
    expect(SQL).toMatch(/BEFORE UPDATE ON inventario_grupos FOR EACH ROW EXECUTE FUNCTION update_updated_at\(\)/)
  })
})

describe("M1a: key and name functions", () => {
  for (const fn of ["inventario_combinacion_clave", "inventario_nombre_variante"]) {
    it(`${fn} is IMMUTABLE (it backs an index and the managed-name check)`, () => {
      expect(block(new RegExp(`CREATE OR REPLACE FUNCTION ${fn}\\((.*?)\\$\\$`))).toMatch(/\bIMMUTABLE\b/)
    })
  }

  it("the key uses the explicit translate map; ñ is not folded; no NFD or unaccent", () => {
    const body = block(/CREATE OR REPLACE FUNCTION inventario_combinacion_clave.*?AS \$\$(.*?)\$\$/)
    expect(body).toContain("translate(lower(btrim(")
    expect(body).toContain("'áàäâéèëêíìïîóòöôúùüû', 'aaaaeeeeiiiioooouuuu'")
    expect(body).not.toMatch(/ñ|unaccent/)
  })

  it("the name is base || ' - ' || values joined by ' / ' in option order", () => {
    const body = block(/CREATE OR REPLACE FUNCTION inventario_nombre_variante.*?AS \$\$(.*?)\$\$/)
    expect(body).toContain("' - '")
    expect(body).toMatch(/string_agg\(a\.e ->> 'valor', ' \/ ' ORDER BY a\.ord\)/)
  })
})

describe("M1a: sibling sync trigger (VG-7)", () => {
  const trig = block(/CREATE TRIGGER inventario_sync_compartidos_grupo (.*?) EXECUTE FUNCTION/)
  const fn = block(/CREATE OR REPLACE FUNCTION inventario_sync_compartidos_grupo.*?AS \$\$(.*?)\$\$/)

  it("fires on EXACTLY the 9 shared columns (column list, WHEN and UPDATE) and no image column", () => {
    expect(cols(/AFTER UPDATE OF (.*?) ON inventario FOR EACH ROW/.exec(trig)![1])).toEqual(NINE_SHARED)
    const [, oldList, newList] = /WHEN \(NEW\.grupo_id IS NOT NULL AND \((.*?)\) IS DISTINCT FROM \((.*?)\)\)/.exec(trig)!
    expect(cols(oldList)).toEqual(NINE_SHARED)
    expect(cols(newList)).toEqual(NINE_SHARED)
    const set = /UPDATE inventario i SET (.*?) WHERE/.exec(fn)![1]
    expect(set.split(",").map((s) => s.split("=")[0].trim())).toEqual(NINE_SHARED)
    expect(SQL).not.toMatch(/imagen_/) // one file, one row: images are never synced
  })

  it("guards recursion with the stapp.sync_grupo GUC, not pg_trigger_depth", () => {
    expect(fn).toContain("current_setting('stapp.sync_grupo', true) = 'on'")
    expect(fn).toContain("set_config('stapp.sync_grupo', 'on', true)")
    expect(fn).toContain("set_config('stapp.sync_grupo', 'off', true)")
    expect(SQL).not.toMatch(/pg_trigger_depth/)
  })

  it("only touches siblings of the same group and organization", () => {
    expect(fn).toMatch(/WHERE i\.grupo_id = NEW\.grupo_id AND i\.organization_id = NEW\.organization_id AND i\.id <> NEW\.id/)
  })
})

describe("M1a: ungroup trigger (VG-10)", () => {
  it("BEFORE DELETE on the group clears atributos; the FK SET NULL frees grupo_id", () => {
    expect(SQL).toMatch(/BEFORE DELETE ON inventario_grupos FOR EACH ROW EXECUTE FUNCTION inventario_grupos_limpiar_atributos\(\)/)
    expect(block(/CREATE OR REPLACE FUNCTION inventario_grupos_limpiar_atributos.*?AS \$\$(.*?)\$\$/)).toMatch(
      /UPDATE inventario SET atributos = NULL WHERE grupo_id = OLD\.id; RETURN OLD;/
    )
  })
})

describe("M1a rollback file", () => {
  const RB_RAW = readByMarker("rollback", "Rollback of M1a")
  const RB = collapse(RB_RAW)
  const at = (needle: string) => {
    const i = RB.indexOf(needle)
    if (i < 0) throw new Error(`rollback is missing: ${needle}`)
    return i
  }

  it("drops in dependency order: triggers, functions, indexes, check, columns, table", () => {
    const order = [
      "DROP TRIGGER IF EXISTS inventario_sync_compartidos_grupo ON inventario",
      "DROP TRIGGER IF EXISTS inventario_grupos_before_delete ON inventario_grupos",
      "DROP FUNCTION IF EXISTS inventario_sync_compartidos_grupo()",
      "DROP FUNCTION IF EXISTS inventario_grupos_limpiar_atributos()",
      "DROP INDEX IF EXISTS inventario_grupo_combinacion_activa_uniq",
      "DROP FUNCTION IF EXISTS inventario_combinacion_clave(JSONB)", // the unique index depends on it
      "DROP CONSTRAINT IF EXISTS inventario_grupo_no_kit",
      "DROP COLUMN IF EXISTS grupo_id",
      "DROP COLUMN IF EXISTS atributos",
      "DROP TABLE IF EXISTS inventario_grupos",
    ].map(at)
    expect([...order].sort((x, y) => x - y)).toEqual(order)
    expect(at("DROP FUNCTION IF EXISTS inventario_nombre_variante(TEXT, JSONB)")).toBeGreaterThan(-1)
  })

  it("warns that groups are lost, children survive, offers an export, deletes no rows", () => {
    expect(RB_RAW).toMatch(/groups are lost/i)
    expect(RB_RAW).toMatch(/children survive/i)
    expect(RB_RAW).toMatch(/--\s+SELECT\b/)
    expect(RB).not.toMatch(/\bDELETE\b|\bTRUNCATE\b|DROP TABLE IF EXISTS inventario ?;/)
  })
})
