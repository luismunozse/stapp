// @vitest-environment node
import { describe, it, expect } from "vitest"
import { collapse, readByMarker, readBySuffix, stripComments } from "./helpers/sql-text"

// M2 drops the legacy per-product variants (migration 176: the table inventario_variantes, its
// trigger, its function, three RPCs and two policies). It is applied by hand, there is no Postgres
// in CI, and a DROP cannot be taken back: this pins by text what vitest cannot execute. The verify
// probes cover the runtime behavior. Files resolve by suffix or marker, never by number, so the
// renumber at merge time breaks nothing.

// Lazy reads: a missing file fails ITS tests, not the whole suite at collection time.
const migRaw = () => readBySuffix("_drop_inventario_variantes.sql")
const rollbackRaw = () => readByMarker("rollback", "Rollback of M2")
const probesRaw = () => readByMarker("verify", "Verification of M2")
const precheckRaw = () => readByMarker("verify", "Pre-check of M2")
const src176 = () => readBySuffix("176_inventario_variantes.sql")
const src201 = () => readBySuffix("201_rls_hardening_phase1.sql")

const TABLE = "inventario_variantes"
const FUNCTIONS = [
  "sync_inventario_total_variantes()",
  "crear_variantes_bulk(TEXT, TEXT, TEXT, JSONB)",
  "ajustar_stock_variante_atomic(TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT)",
  "eliminar_variantes_y_consolidar(TEXT, TEXT, TEXT)",
]
const POLICIES = ["inventario_variantes_select", "inventario_variantes_all_service"]
const TRIGGERS = ["inventario_variantes_sync_total", "inventario_variantes_updated_at"]
const INDEXES = [
  "inventario_variantes_codigo_unique",
  "inventario_variantes_barcode_unique",
  "inventario_variantes_inv_idx",
  "inventario_variantes_org_idx",
  "inventario_variantes_barcode_idx",
  "inventario_variantes_activo_idx",
]

/** Header prose with the wrapped comment lines joined, for pinning what the file promises. */
const header = (raw: string, firstStatement: string) =>
  raw.slice(0, raw.indexOf(firstStatement)).replace(/\n--\s?/g, " ").replace(/\s+/g, " ")

/** Text between two comment markers (exclusive), or null when a marker is missing. */
function between(raw: string, from: string, to: string): string | null {
  const a = raw.indexOf(from)
  const b = raw.indexOf(to)
  return a === -1 || b === -1 || b < a ? null : raw.slice(a + from.length, b)
}

/** Splits comment-free SQL on `;` outside single-quoted literals and dollar-quoted bodies (any tag, nested). */
function statements(raw: string): string[] {
  const text = collapse(raw)
  const out: string[] = []
  let cur = ""
  let quoted = false
  let tag: string | null = null
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (tag === null && ch === "'") quoted = !quoted // '' toggles twice: net unchanged
    if (!quoted) {
      const m = /^\$[A-Za-z_]*\$/.exec(text.slice(i))
      if (m && (tag === null || m[0] === tag)) {
        tag = tag === null ? m[0] : null
        cur += m[0]
        i += m[0].length - 1
        continue
      }
    }
    if (ch === ";" && !quoted && tag === null) {
      out.push(cur.trim())
      cur = ""
    } else cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

describe("M2 migration: the drop", () => {
  it("starts with SET LOCAL lock_timeout and opens no transaction of its own", () => {
    expect(statements(migRaw())[0]).toBe("SET LOCAL lock_timeout = '3s'")
    expect(stripComments(migRaw())).not.toMatch(/^\s*BEGIN\s*;/im)
    expect(collapse(migRaw())).not.toMatch(/\bCOMMIT\b/i)
  })

  it("refuses to run while the legacy table holds ANY row: the guard raises an exception", () => {
    const guard = statements(migRaw()).find((s) => /^DO\b/.test(s))
    expect(guard).toBeDefined()
    expect(guard).toContain("IF EXISTS (SELECT 1 FROM inventario_variantes)")
    expect(guard).toMatch(/RAISE EXCEPTION/)
    // Not a NOTICE and not a quiet skip: the error aborts the whole transaction.
    expect(guard).not.toMatch(/RAISE (NOTICE|WARNING|INFO)/)
  })

  it("counts every row, soft-deleted ones included: the guard has no deleted_at filter", () => {
    const guard = statements(migRaw()).find((s) => /^DO\b/.test(s))!
    expect(guard).not.toMatch(/deleted_at|activo/i)
  })

  it("takes the table lock BEFORE counting, so no row can slip in between the guard and the DROP", () => {
    const guard = statements(migRaw()).find((s) => /^DO\b/.test(s))!
    expect(guard).toMatch(/LOCK TABLE inventario_variantes IN ACCESS EXCLUSIVE MODE/)
    expect(guard.indexOf("LOCK TABLE")).toBeLessThan(guard.indexOf("IF EXISTS (SELECT 1 FROM inventario_variantes)"))
  })

  it("is re-runnable: the guard only looks at the table when it still exists", () => {
    const guard = statements(migRaw()).find((s) => /^DO\b/.test(s))!
    expect(guard).toMatch(/to_regclass\('public\.inventario_variantes'\) IS NOT NULL/)
    expect(guard.indexOf("to_regclass")).toBeLessThan(guard.indexOf("LOCK TABLE"))
  })

  it("the guard comes BEFORE the first DROP, by position in the comment-free text", () => {
    const text = collapse(migRaw())
    const guard = text.indexOf("RAISE EXCEPTION")
    const firstDrop = text.search(/\bDROP\b/)
    expect(guard).toBeGreaterThan(-1)
    expect(firstDrop).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(firstDrop)
    // ...and before any write at all.
    expect(guard).toBeLessThan(text.search(/\bUPDATE inventario\b/))
  })

  it.each(TRIGGERS)("drops trigger %s explicitly", (name) => {
    expect(statements(migRaw())).toContain(`DROP TRIGGER IF EXISTS ${name} ON ${TABLE}`)
  })

  it.each(POLICIES)("drops policy %s explicitly", (name) => {
    expect(statements(migRaw())).toContain(`DROP POLICY IF EXISTS ${name} ON ${TABLE}`)
  })

  it.each(FUNCTIONS)("drops function %s by its full signature", (signature) => {
    expect(statements(migRaw())).toContain(`DROP FUNCTION IF EXISTS ${signature}`)
  })

  it("drops the table with a plain DROP TABLE: no blind CASCADE anywhere", () => {
    expect(statements(migRaw())).toContain("DROP TABLE IF EXISTS inventario_variantes")
    expect(collapse(migRaw())).not.toMatch(/\bCASCADE\b/i)
  })

  it("drops the objects that depend on others first: triggers, then the trigger function, then the table", () => {
    const s = statements(migRaw())
    const at = (stmt: string) => s.indexOf(stmt)
    const syncTrigger = at(`DROP TRIGGER IF EXISTS inventario_variantes_sync_total ON ${TABLE}`)
    const syncFunction = at("DROP FUNCTION IF EXISTS sync_inventario_total_variantes()")
    const table = at("DROP TABLE IF EXISTS inventario_variantes")
    expect(syncTrigger).toBeGreaterThan(-1)
    expect(syncTrigger).toBeLessThan(syncFunction)
    expect(syncFunction).toBeLessThan(table)
    for (const name of POLICIES) expect(at(`DROP POLICY IF EXISTS ${name} ON ${TABLE}`)).toBeLessThan(table)
  })

  it("clears the legacy flag on the items that still carry it, and never drops the column", () => {
    const s = statements(migRaw())
    expect(s).toContain("UPDATE inventario SET tiene_variantes = false WHERE tiene_variantes IS TRUE")
    const text = collapse(migRaw())
    expect(text).not.toMatch(/DROP COLUMN/i)
    expect(text).not.toMatch(/ALTER TABLE inventario\b/i)
    // The only UPDATE is the flag: no other column of inventario is touched.
    expect(s.filter((x) => /^UPDATE\b/.test(x))).toHaveLength(1)
  })

  it("retires the stale column comment, which still promises the trigger that is gone", () => {
    const comment = statements(migRaw()).find((s) => s.startsWith("COMMENT ON COLUMN inventario.tiene_variantes IS"))
    expect(comment).toBeDefined()
    expect(comment).toMatch(/legacy/i)
    expect(comment).not.toMatch(/sync_inventario_total_variantes/)
  })

  it("touches nothing but the legacy objects and the flag: no catalog, group or depósito object", () => {
    // Column comments are prose and may name the groups; the objects the statements operate on may not.
    const code = statements(migRaw()).filter((x) => !x.startsWith("COMMENT")).join(" ")
    expect(code).not.toMatch(/\b(catalogo_variantes|catalogo_items|inventario_grupos|inventario_depositos|movimientos_inventario)\b/)
    const text = collapse(migRaw())
    expect(text).not.toMatch(/\b(INSERT|DELETE|TRUNCATE|GRANT|REVOKE|CREATE)\b/i)
    const kinds = statements(migRaw()).map((x) => x.split(" ")[0])
    expect(new Set(kinds)).toEqual(new Set(["SET", "DO", "DROP", "UPDATE", "COMMENT"]))
  })

  it("says what it does, what it locks and where the pre-check lives", () => {
    const h = header(migRaw(), "SET LOCAL lock_timeout")
    expect(h).toMatch(/ABORTS|aborts/)
    expect(h).toMatch(/ACCESS EXCLUSIVE/)
    expect(h).toMatch(/precheck/i)
    expect(h).toMatch(/tiene_variantes/)
    expect(h).toMatch(/CASCADE/)
  })
})

describe("M2 rollback file", () => {
  it("sets its own lock_timeout first and opens no transaction", () => {
    expect(statements(rollbackRaw())[0]).toBe("SET LOCAL lock_timeout = '3s'")
    expect(stripComments(rollbackRaw())).not.toMatch(/^\s*BEGIN\s*;/im)
  })

  it("recreates the table, its six indexes, RLS, two triggers, the sync function and the three RPCs", () => {
    const text = collapse(rollbackRaw())
    expect(text).toMatch(/CREATE TABLE IF NOT EXISTS inventario_variantes \(/)
    for (const name of INDEXES) expect(text).toContain(`INDEX IF NOT EXISTS ${name}`)
    expect(text).toContain("ALTER TABLE inventario_variantes ENABLE ROW LEVEL SECURITY")
    for (const name of TRIGGERS) expect(text).toContain(`CREATE TRIGGER ${name}`)
    expect(text).toContain("CREATE OR REPLACE FUNCTION sync_inventario_total_variantes()")
    expect(text).toContain("CREATE OR REPLACE FUNCTION crear_variantes_bulk(")
    expect(text).toContain("CREATE OR REPLACE FUNCTION ajustar_stock_variante_atomic(")
    expect(text).toContain("CREATE OR REPLACE FUNCTION eliminar_variantes_y_consolidar(")
    for (const name of POLICIES) expect(text).toContain(`CREATE POLICY ${name} ON ${TABLE}`)
  })

  it("every statement is a verbatim substring of the comment-free 176/201 sources: nothing hand-typed", () => {
    const sources = collapse(src176() + "\n" + src201())
    const body = statements(rollbackRaw()).slice(1)
    expect(body).toHaveLength(24)
    for (const stmt of body) {
      expect(sources, stmt.slice(0, 90)).toContain(stmt)
    }
  })

  it("restores the policies as 201 left them (service_role only), not as 176 first wrote them", () => {
    const text = collapse(rollbackRaw())
    expect(text).toContain(
      "CREATE POLICY inventario_variantes_all_service ON inventario_variantes FOR ALL TO service_role USING (true) WITH CHECK (true)",
    )
    expect(text).toContain("get_current_organization_id()")
    expect(text).not.toContain("current_setting('app.organization_id'")
  })

  it("restores the original column comment of 176", () => {
    const comment = statements(rollbackRaw()).find((s) => s.startsWith("COMMENT ON COLUMN inventario.tiene_variantes IS"))
    expect(comment).toBeDefined()
    expect(comment).toMatch(/sync_inventario_total_variantes/)
  })

  it("brings back empty objects only: it writes no row and says so", () => {
    // Function bodies legitimately contain UPDATE and INSERT: only the top-level statements count.
    const kinds = new Set(statements(rollbackRaw()).map((x) => x.split(" ")[0]))
    expect(kinds).toEqual(new Set(["SET", "COMMENT", "CREATE", "ALTER", "DROP"]))
    const h = header(rollbackRaw(), "SET LOCAL lock_timeout")
    expect(h).toMatch(/empty/i)
    expect(h).toMatch(/tiene_variantes/)
    expect(h).toMatch(/not restored|NOT restored/)
  })
})

describe("M2 pre-check file", () => {
  it("is read-only by construction: the first statement makes the transaction READ ONLY", () => {
    expect(statements(precheckRaw())[0]).toBe("SET TRANSACTION READ ONLY")
    expect(stripComments(precheckRaw())).not.toMatch(/^\s*BEGIN\s*;/im)
  })

  it("writes nothing: no DML, no DDL, no function that writes", () => {
    expect(collapse(precheckRaw())).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|GRANT|REVOKE|LOCK|COMMENT)\b/i)
  })

  it("counts the rows of the legacy table (total, active, deleted) and says whether the guard will pass", () => {
    const text = collapse(precheckRaw())
    expect(text).toContain("FROM inventario_variantes")
    expect(text).toMatch(/count\(\*\)/)
    expect(text).toMatch(/deleted_at IS NULL/)
    expect(text).toMatch(/guard/i)
  })

  it("lists the items still flagged tiene_variantes, which the migration will clear", () => {
    expect(collapse(precheckRaw())).toMatch(/FROM inventario WHERE tiene_variantes IS TRUE/)
  })

  it("lists every kind of dependent: views, foreign keys, triggers, policies and functions", () => {
    const text = collapse(precheckRaw())
    expect(text).toContain("pg_rewrite")
    expect(text).toContain("pg_constraint")
    expect(text).toContain("pg_trigger")
    expect(text).toContain("pg_policies")
    expect(text).toContain("pg_proc")
    for (const name of ["sync_inventario_total_variantes", "crear_variantes_bulk", "ajustar_stock_variante_atomic", "eliminar_variantes_y_consolidar"]) {
      expect(text).toContain(name)
    }
    expect(text).toMatch(/UNEXPECTED/)
  })

  it("counts the movement history that the drop leaves untouched", () => {
    expect(collapse(precheckRaw())).toMatch(/FROM movimientos_inventario WHERE referencia_tipo IN \('VARIANTE', 'CONSOLIDACION_VARIANTES'\)/)
  })
})

describe("M2 probes file", () => {
  const RB_BEGIN = "-- ROLLBACK:BEGIN"
  const RB_END = "-- ROLLBACK:END"
  const MIG_BEGIN = "-- MIGRATION:BEGIN"
  const MIG_END = "-- MIGRATION:END"
  const GUARD_BEGIN = "-- GUARD:BEGIN"
  const GUARD_END = "-- GUARD:END"

  it("opens a transaction, ends in ROLLBACK, never commits", () => {
    const s = statements(probesRaw())
    expect(s[0]).toBe("BEGIN")
    expect(s.at(-1)).toBe("ROLLBACK")
    expect(s).not.toContain("COMMIT")
  })

  it("accumulates in _r and returns ONE result: a single top-level SELECT, right before the ROLLBACK", () => {
    const s = statements(probesRaw())
    const selects = s.filter((x) => /^SELECT\b/i.test(x))
    expect(selects).toEqual(["SELECT orden, probe, esperado, obtenido FROM _r ORDER BY orden, probe"])
    expect(s.at(-2)).toBe(selects[0])
    expect(s).toContain("CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT)")
  })

  it("gives every probe row its own unique orden", () => {
    const text = collapse(probesRaw())
    const ordenes = [...text.matchAll(/INSERT INTO _r (?:VALUES \(|SELECT )(\d+),/g)].map((m) => m[1])
    const viaHelper = [...text.matchAll(/pg_temp\.probe\((\d+),/g)].map((m) => m[1])
    const all = [...ordenes, ...viaHelper]
    expect(all.length).toBeGreaterThanOrEqual(15)
    expect(new Set(all).size).toBe(all.length)
  })

  it("checks the real post-apply state first: table, functions, policies and variants triggers are gone", () => {
    const text = collapse(probesRaw())
    expect(text).toContain("to_regclass('public.inventario_variantes')")
    expect(text).toContain("FROM pg_proc")
    for (const name of ["sync_inventario_total_variantes", "crear_variantes_bulk", "ajustar_stock_variante_atomic", "eliminar_variantes_y_consolidar"]) {
      expect(text).toContain(name)
    }
  })

  it("VL-4: no trigger on a variants table writes inventario.stock, and none runs the sync function", () => {
    const text = collapse(probesRaw())
    expect(text).toMatch(/relname LIKE '%variantes%'/)
    expect(text).toMatch(/NOT t\.tgisinternal/)
    expect(text).toMatch(/p.prosrc ILIKE '%update inventario%'/)
    expect(text).toMatch(/tgfoid::regproc::text LIKE '%sync_inventario_total_variantes%'/)
  })

  it("keeps the column, clears the flag, and guards the count against a vacuous pass", () => {
    const text = collapse(probesRaw())
    expect(text).toMatch(/column_name = 'tiene_variantes'/)
    expect(text).toMatch(/tiene_variantes IS TRUE/)
    expect(text).toMatch(/count\(\*\) > 0/)
  })

  it("leaves the catalog domain and the groups alone: they must still exist", () => {
    const text = collapse(probesRaw())
    expect(text).toContain("to_regclass('public.catalogo_variantes')")
    expect(text).toContain("to_regclass('public.inventario_grupos')")
    expect(text).toContain("guardar_grupo_variantes")
  })

  it("reports the informational stock-vs-depósitos drift without failing on it", () => {
    const text = collapse(probesRaw())
    expect(text).toMatch(/inventario_depositos/)
    expect(text).toMatch(/i\.stock <>/)
    expect(text).toMatch(/'INFO/)
  })

  it("rehearses the rollback inline, verbatim: the marked block equals the rollback file", () => {
    const inline = between(probesRaw(), RB_BEGIN, RB_END)
    expect(inline).not.toBeNull()
    expect(statements(inline!)).toEqual(statements(rollbackRaw()))
  })

  it("rehearses the migration inline, verbatim: the marked block equals the migration file", () => {
    const inline = between(probesRaw(), MIG_BEGIN, MIG_END)
    expect(inline).not.toBeNull()
    expect(statements(inline!)).toEqual(statements(migRaw()))
  })

  it("rehearses the GUARD inline, verbatim, against a real legacy row: it must raise and leave the table", () => {
    const inProbe = between(probesRaw(), GUARD_BEGIN, GUARD_END)
    const inMigration = between(migRaw(), GUARD_BEGIN, GUARD_END)
    expect(inProbe).not.toBeNull()
    expect(inMigration).not.toBeNull()
    expect(collapse(inProbe!)).toBe(collapse(inMigration!))
    expect(collapse(inProbe!)).toMatch(/^DO \$\$/)
    const text = collapse(probesRaw())
    // The scratch legacy row goes in before the guard runs, through the helper that records the SQLSTATE.
    expect(text).toMatch(/INSERT INTO inventario_variantes \(/)
    expect(text).toMatch(/pg_temp\.probe\(\d+, '[^']*guard[^']*', '55000'/i)
    expect(text.indexOf("INSERT INTO inventario_variantes (")).toBeLessThan(text.indexOf("'55000'"))
  })

  it("the guard probe is followed by proof that the refusal changed nothing: table and row still there", () => {
    const text = collapse(probesRaw())
    const after = text.slice(text.indexOf("'55000'"))
    expect(after).toMatch(/FROM inventario_variantes/)
    expect(after).toMatch(/to_regclass\('public\.inventario_variantes'\)/)
  })

  it("after the migration rehearsal checks everything is gone, the flagged scratch item is cleared and the item survives", () => {
    const raw = probesRaw()
    const after = collapse(raw.slice(raw.indexOf(MIG_END)))
    expect(after).toContain("to_regclass('public.inventario_variantes')")
    expect(after).toMatch(/tiene_variantes/)
    expect(after).toMatch(/FROM inventario WHERE/)
  })
})
