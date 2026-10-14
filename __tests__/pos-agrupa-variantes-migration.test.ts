// @vitest-environment node
import { describe, it, expect } from "vitest"
import { collapse, readByMarker, readBySuffix, stripComments } from "./helpers/sql-text"

// M3 (organizations.pos_agrupa_variantes) is applied by hand and there is no Postgres in CI: this pins
// by text what vitest cannot execute. The verify probes cover the runtime behavior. Files resolve by
// suffix or marker, never by number, so the renumber at merge time breaks nothing.

// Lazy reads: a missing file fails ITS tests, not the whole suite at collection time.
const migRaw = () => readBySuffix("_pos_agrupa_variantes.sql")
const rollbackRaw = () => readByMarker("rollback", "Rollback of M3")
const probesRaw = () => readByMarker("verify", "Verification of M3")

/** Header prose with the wrapped comment lines joined, for pinning what the file promises. */
const header = (raw: string, firstStatement: string) =>
  raw.slice(0, raw.indexOf(firstStatement)).replace(/\n--\s?/g, " ").replace(/\s+/g, " ")

/** Splits comment-free SQL on `;` outside single-quoted literals and `$$` bodies. */
function statements(raw: string): string[] {
  const text = collapse(raw)
  const out: string[] = []
  let cur = ""
  let quoted = false
  let dollar = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (!dollar && ch === "'") quoted = !quoted // '' toggles twice: net unchanged
    if (!quoted && text.startsWith("$$", i)) {
      dollar = !dollar
      cur += "$$"
      i++
      continue
    }
    if (ch === ";" && !quoted && !dollar) {
      out.push(cur.trim())
      cur = ""
    } else cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

const ADD_COLUMN =
  "ALTER TABLE organizations ADD COLUMN IF NOT EXISTS pos_agrupa_variantes BOOLEAN NOT NULL DEFAULT true"
const DROP_COLUMN = "ALTER TABLE organizations DROP COLUMN IF EXISTS pos_agrupa_variantes"

describe("M3 migration: the column", () => {
  it("starts with SET LOCAL lock_timeout and opens no transaction of its own", () => {
    expect(statements(migRaw())[0]).toBe("SET LOCAL lock_timeout = '3s'")
    expect(stripComments(migRaw())).not.toMatch(/^\s*BEGIN\s*;/im)
    expect(collapse(migRaw())).not.toMatch(/\bCOMMIT\b/i)
  })

  it("adds exactly one column, idempotently: BOOLEAN NOT NULL with a constant DEFAULT true (catalog-only, no rewrite)", () => {
    const alters = statements(migRaw()).filter((s) => /^ALTER TABLE/i.test(s))
    expect(alters).toEqual([ADD_COLUMN])
  })

  it("touches only organizations: nothing but the lock_timeout, the ALTER and the column COMMENT", () => {
    const rest = statements(migRaw()).slice(1)
    expect(rest).toHaveLength(2)
    for (const s of rest) {
      expect(s).toMatch(/^(ALTER TABLE organizations |COMMENT ON COLUMN organizations\.pos_agrupa_variantes IS )/)
    }
    expect(collapse(migRaw())).not.toMatch(/\b(INSERT|UPDATE|DELETE|CREATE|DROP|TRUNCATE|GRANT|REVOKE)\b/i)
    expect(collapse(migRaw())).not.toMatch(/\binventario/i)
  })

  it("documents the column with a COMMENT that is more than a placeholder", () => {
    const comment = statements(migRaw()).find((s) => s.startsWith("COMMENT ON COLUMN"))
    expect(comment).toBeDefined()
    const text = /IS '(.*)'$/.exec(comment!)?.[1] ?? ""
    expect(text.length).toBeGreaterThan(60)
    expect(text).toMatch(/default true/i)
  })

  it("says why the default is true, that a missing column reads as grouped, and what it locks", () => {
    const h = header(migRaw(), "SET LOCAL lock_timeout")
    expect(h).toMatch(/DEFAULT true/)
    expect(h).toMatch(/!== false/)
    expect(h).toMatch(/ACCESS EXCLUSIVE/)
    expect(h).toMatch(/own file|separate from M1/i)
  })
})

describe("M3 rollback file", () => {
  it("sets its own lock_timeout first and does nothing but drop the column", () => {
    const s = statements(rollbackRaw())
    expect(s[0]).toBe("SET LOCAL lock_timeout = '3s'")
    expect(s.slice(1)).toEqual([DROP_COLUMN])
  })

  it("warns that the organizations' choices are lost, offers an export SELECT, deletes no rows", () => {
    const raw = rollbackRaw()
    expect(header(raw, "SET LOCAL lock_timeout")).toMatch(/choices are lost/i)
    expect(raw).toMatch(/--\s+SELECT\b[^\n]*pos_agrupa_variantes/)
    expect(collapse(raw)).not.toMatch(/\b(DELETE|TRUNCATE|UPDATE|INSERT)\b/i)
    expect(collapse(raw)).not.toMatch(/\binventario/i)
  })

  it("says the code degrades by itself: without the column the POS reads grouped", () => {
    const h = header(rollbackRaw(), "SET LOCAL lock_timeout")
    expect(h).toMatch(/with the column missing/)
    expect(h).toMatch(/the POS reads grouped/)
  })
})

describe("M3 probes file", () => {
  const BEGIN_MARK = "-- ROLLBACK:BEGIN"
  const END_MARK = "-- ROLLBACK:END"

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
    expect(all.length).toBeGreaterThanOrEqual(8)
    expect(new Set(all).size).toBe(all.length)
  })

  it("creates the scratch org WITHOUT naming the column, so the DEFAULT is what gets tested", () => {
    const insert = /INSERT INTO organizations \(([^)]*)\)/.exec(collapse(probesRaw()))
    expect(insert).not.toBeNull()
    expect(insert![1]).not.toMatch(/pos_agrupa_variantes/)
  })

  it("guards the count probes against a vacuous pass: it also records that organizations exist", () => {
    const text = collapse(probesRaw())
    expect(text).toMatch(/pos_agrupa_variantes IS NOT TRUE/)
    expect(text).toMatch(/count\(\*\) > 0/)
  })

  it("expects a NOT NULL violation (23502) from writing NULL, through the SQLSTATE helper", () => {
    expect(collapse(probesRaw())).toMatch(
      /pg_temp\.probe\(\d+, '[^']+', '23502', 'UPDATE organizations SET pos_agrupa_variantes = NULL/,
    )
  })

  it("runs the rollback rehearsal inline, verbatim: the marked block equals the rollback file", () => {
    const raw = probesRaw()
    const from = raw.indexOf(BEGIN_MARK)
    const to = raw.indexOf(END_MARK)
    expect(from).toBeGreaterThan(-1)
    expect(to).toBeGreaterThan(from)
    const inline = raw.slice(from + BEGIN_MARK.length, to)
    expect(statements(inline)).toEqual(statements(rollbackRaw()))
  })

  it("checks after the rehearsal that the column is gone, the organizations survive and a sibling setting is untouched", () => {
    const raw = probesRaw()
    const after = collapse(raw.slice(raw.indexOf(END_MARK)))
    expect(after).toMatch(/column_name = 'pos_agrupa_variantes'/)
    expect(after).toMatch(/count\(\*\) FROM organizations/)
    expect(after).toMatch(/vendedores_ven_ingresos/)
  })
})
