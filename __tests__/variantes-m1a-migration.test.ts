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
  it("starts with SET LOCAL lock_timeout and documents every lock it takes", () => {
    expect(SQL.startsWith("SET LOCAL lock_timeout = '3s';")).toBe(true)
    expect(RAW).toMatch(/ACCESS EXCLUSIVE/)
    expect(RAW).toMatch(/SHARE ROW EXCLUSIVE/) // the new FKs lock organizations and users
    expect(RAW).toMatch(/off-peak/i)
  })

  it("creates every function before the first ALTER TABLE on inventario (short lock window)", () => {
    const firstAlter = SQL.indexOf("ALTER TABLE inventario ")
    expect(firstAlter).toBeGreaterThan(0)
    expect(SQL.lastIndexOf("CREATE OR REPLACE FUNCTION")).toBeLessThan(firstAlter)
  })

  it("has no BEGIN/COMMIT of its own (db-run wraps the file)", () => {
    expect(stripComments(RAW)).not.toMatch(/^\s*BEGIN\s*;/im)
    expect(SQL).not.toMatch(/\bCOMMIT\b/i)
  })

  it("is re-runnable: every create has a guard", () => {
    const creates = SQL.match(/CREATE (?:UNIQUE )?(?:TABLE|INDEX)\b/g) ?? []
    expect(creates).toHaveLength(3) // 1 table + 2 indexes (the unique (organization_id, id) covers the org lookups)
    expect(SQL.match(/CREATE (?:UNIQUE )?(?:TABLE|INDEX) IF NOT EXISTS/g)).toHaveLength(3)
    expect(SQL.match(/ADD COLUMN\b/g)).toHaveLength(2)
    expect(SQL.match(/ADD COLUMN IF NOT EXISTS/g)).toHaveLength(2)
    for (const name of SQL.match(/CREATE TRIGGER (\w+)/g)!.map((s) => s.split(" ")[2])) {
      expect(SQL).toMatch(new RegExp(`DROP TRIGGER IF EXISTS ${name} ON \\w+; CREATE TRIGGER ${name}`))
    }
    for (const name of ["inventario_grupo_id_fkey", "inventario_grupo_no_kit", "inventario_grupo_atributos"]) {
      expect(SQL).toMatch(new RegExp(`DROP CONSTRAINT IF EXISTS ${name},`))
      expect(SQL).toMatch(new RegExp(`ADD CONSTRAINT ${name}\\b`))
    }
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

  it("exposes UNIQUE (organization_id, id) as the target of the composite FK", () => {
    expect(table).toMatch(/CONSTRAINT inventario_grupos_org_id_uniq UNIQUE \(organization_id, id\)/)
  })

  it("adds grupo_id and atributos JSONB; the FK is composite so a child cannot join another org's group", () => {
    expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS grupo_id TEXT,/)
    expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS atributos JSONB,/)
    // SET NULL (grupo_id) only: a plain SET NULL would also try to null organization_id.
    expect(SQL).toMatch(
      /ADD CONSTRAINT inventario_grupo_id_fkey FOREIGN KEY \(organization_id, grupo_id\) REFERENCES inventario_grupos \(organization_id, id\) ON DELETE SET NULL \(grupo_id\)/
    )
  })

  it("grupo_id and atributos are NULL together; a grouped row carries a valid array (key holes)", () => {
    expect(SQL).toMatch(
      /ADD CONSTRAINT inventario_grupo_atributos CHECK \( CASE WHEN grupo_id IS NULL THEN atributos IS NULL ELSE inventario_atributos_validos\(atributos\) END\)/
    )
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

describe("M1a: key, validity and name functions", () => {
  for (const fn of ["inventario_combinacion_clave", "inventario_atributos_validos", "inventario_nombre_variante"]) {
    it(`${fn} is IMMUTABLE with a fixed search_path (it backs an index, a CHECK or the managed-name test)`, () => {
      const head = block(new RegExp(`CREATE OR REPLACE FUNCTION ${fn}\\((.*?)\\$\\$`))
      expect(head).toMatch(/\bIMMUTABLE\b/)
      expect(head).toContain("SET search_path = pg_catalog, pg_temp")
    })
  }

  const keyBody = block(/CREATE OR REPLACE FUNCTION inventario_combinacion_clave.*?AS \$\$(.*?)\$\$/)

  it("the key uses the explicit translate map; ñ is not folded; no NFD or unaccent", () => {
    expect(keyBody).toContain("translate(lower(btrim(")
    expect(keyBody).toContain("'áàäâéèëêíìïîóòöôúùüû', 'aaaaeeeeiiiioooouuuu'")
    expect(keyBody).not.toMatch(/ñ|unaccent/)
  })

  it("the key trims EXACTLY the characters String.prototype.trim() trims (SQL/JS parity)", () => {
    const literal = /btrim\(a\.e ->> 'valor', E'([^']*)'\)/.exec(keyBody)?.[1]
    if (literal === undefined) throw new Error("the key must call btrim(valor, E'...') with an explicit set")
    const sql = new Set(
      [...literal.replace(/\\u([0-9a-fA-F]{4})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)))
        .replace(/\\t/g, "\t").replace(/\\n/g, "\n").replace(/\\f/g, "\f").replace(/\\r/g, "\r")].map((c) => c.charCodeAt(0))
    )
    const js = new Set<number>()
    for (let c = 0; c <= 0xffff; c++) if (String.fromCharCode(c).trim() === "") js.add(c)
    expect([...sql].sort((a, b) => a - b)).toEqual([...js].sort((a, b) => a - b))
  })

  it("validity: non-empty array, every element has a non-blank string valor without the key separator", () => {
    const body = block(/CREATE OR REPLACE FUNCTION inventario_atributos_validos.*?AS \$\$(.*?)\$\$/)
    expect(body).toContain("jsonb_typeof(p_atributos) = 'array' AND jsonb_array_length(p_atributos) > 0")
    expect(body).toContain("jsonb_typeof(a.e -> 'valor') IS DISTINCT FROM 'string'")
    expect(body).toContain("public.inventario_combinacion_clave(jsonb_build_array(a.e))") // one trim definition, no copy
    expect(body).toContain("strpos(a.e ->> 'valor', chr(31)) > 0")
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

  it("fans out to the WHOLE group of the same org, the firing row included, so a bulk UPDATE converges", () => {
    expect(fn).toMatch(/WHERE i\.grupo_id = NEW\.grupo_id AND i\.organization_id = NEW\.organization_id AND \(i\.descripcion,/)
    expect(fn).not.toMatch(/i\.id\s*<>\s*NEW\.id/) // excluding the firing row left it stale
    expect(RAW).toMatch(/processed last wins/)
  })
})

describe("M1a: ungroup trigger (VG-10)", () => {
  const body = block(/CREATE OR REPLACE FUNCTION inventario_grupos_limpiar_atributos.*?AS \$\$(.*?)\$\$/)

  it("BEFORE DELETE on the group frees every child: grupo_id AND atributos NULL, as the CHECK needs", () => {
    expect(SQL).toMatch(/BEFORE DELETE ON inventario_grupos FOR EACH ROW EXECUTE FUNCTION inventario_grupos_limpiar_atributos\(\)/)
    expect(body).toMatch(/UPDATE inventario SET grupo_id = NULL, atributos = NULL WHERE grupo_id = OLD\.id; RETURN OLD;/)
  })

  it("steps aside during an organization purge (the org row is already gone)", () => {
    const early = "IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = OLD.organization_id) THEN RETURN OLD; END IF;"
    expect(body).toContain(early)
    expect(body.indexOf(early)).toBeLessThan(body.indexOf("UPDATE inventario"))
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

  it("sets its own lock_timeout as the first statement", () => {
    expect(RB.startsWith("SET LOCAL lock_timeout = '3s';")).toBe(true)
  })

  it("drops in dependency order: triggers, trigger fns, indexes, checks and columns, then the fns the checks used, table", () => {
    const order = [
      "DROP TRIGGER IF EXISTS inventario_sync_compartidos_grupo ON inventario",
      "DROP TRIGGER IF EXISTS inventario_grupos_before_delete ON inventario_grupos",
      "DROP FUNCTION IF EXISTS inventario_sync_compartidos_grupo()",
      "DROP FUNCTION IF EXISTS inventario_grupos_limpiar_atributos()",
      "DROP INDEX IF EXISTS inventario_grupo_combinacion_activa_uniq",
      "DROP CONSTRAINT IF EXISTS inventario_grupo_atributos",
      "DROP COLUMN IF EXISTS grupo_id",
      "DROP COLUMN IF EXISTS atributos",
      "DROP FUNCTION IF EXISTS inventario_atributos_validos(JSONB)", // the CHECK used it
      "DROP FUNCTION IF EXISTS inventario_combinacion_clave(JSONB)", // the unique index and validos used it
      "DROP TABLE IF EXISTS inventario_grupos",
    ].map(at)
    expect([...order].sort((x, y) => x - y)).toEqual(order)
    for (const extra of [
      "DROP FUNCTION IF EXISTS inventario_nombre_variante(TEXT, JSONB)",
      "DROP CONSTRAINT IF EXISTS inventario_grupo_no_kit",
      "DROP CONSTRAINT IF EXISTS inventario_grupo_id_fkey",
    ]) expect(at(extra)).toBeGreaterThan(-1)
  })

  it("warns that groups are lost, children survive, offers an export, deletes no rows", () => {
    expect(RB_RAW).toMatch(/groups are lost/i)
    expect(RB_RAW).toMatch(/children survive/i)
    expect(RB_RAW).toMatch(/--\s+SELECT\b/)
    expect(RB).not.toMatch(/\bDELETE\b|\bTRUNCATE\b|DROP TABLE IF EXISTS inventario ?;/)
  })

  it("says to revert M1b first and documents the ACCESS EXCLUSIVE lock", () => {
    expect(RB_RAW).toMatch(/revert M1b first/i)
    expect(RB_RAW).toMatch(/ACCESS EXCLUSIVE/)
  })
})
