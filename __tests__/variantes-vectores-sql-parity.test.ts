// @vitest-environment node
import { describe, it, expect } from "vitest"
import { collapse, readByMarker } from "./helpers/sql-text"
import { KEY_VECTORS, NAME_VECTORS } from "./helpers/variantes-vectores"

// G3: the JS twins and the SQL functions must agree. The probes carry the same vectors
// between markers and execute them on the real database; this test pins that the two
// lists have not drifted, and that the rollback rehearsal is the rollback file itself.

const PROBES = readByMarker("verify", "-- VECTORS:BEGIN")
const vectorBlock = PROBES.split("-- VECTORS:BEGIN")[1].split("-- VECTORS:END")[0]

describe("variant vectors: probes mirror the shared fixtures", () => {
  it("carries every key vector, in order", () => {
    const rows = [...vectorBlock.matchAll(/\(\s*\d+,\s*'(\[.*?\])',\s*'(\[.*?\])',\s*(true|false)\s*\)/g)]
    expect(rows.map(([, a, b, same]) => ({ a: JSON.parse(a), b: JSON.parse(b), same: same === "true" }))).toEqual(KEY_VECTORS)
  })

  it("carries every name vector, in order", () => {
    const rows = [...vectorBlock.matchAll(/\(\s*\d+,\s*'([^']*)',\s*'(\[.*?\])',\s*'([^']*)'\s*\)/g)]
    expect(rows.map(([, base, values, expected]) => ({ base, values: JSON.parse(values), expected }))).toEqual(NAME_VECTORS)
  })

  it("executes the SQL functions on those vectors after the block", () => {
    const after = PROBES.split("-- VECTORS:END")[1]
    expect(after).toContain("inventario_combinacion_clave(")
    expect(after).toContain("inventario_nombre_variante(")
  })
})

describe("probes: rollback rehearsal", () => {
  it("inlines the rollback statements verbatim", () => {
    const inline = PROBES.split("-- ROLLBACK:BEGIN")[1].split("-- ROLLBACK:END")[0]
    expect(collapse(inline)).toBe(collapse(readByMarker("rollback", "Rollback of M1a")))
  })

  it("is one transaction: opens with BEGIN, ends with ROLLBACK, one final SELECT over _r", () => {
    const sql = collapse(PROBES)
    expect(sql.startsWith("BEGIN;")).toBe(true)
    expect(sql.endsWith("ROLLBACK;")).toBe(true)
    expect(sql).toMatch(/SELECT orden, probe, esperado, obtenido FROM _r ORDER BY orden, probe; ROLLBACK;$/)
  })
})
