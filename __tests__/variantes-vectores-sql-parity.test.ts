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

// The probes run by hand against a real database; these pins stop one from being deleted unnoticed.
describe("probes: integrity and runtime checks are present", () => {
  const sql = collapse(PROBES)
  it.each([
    ["every invalid atributos shape is refused with 23514", /invalid atributos refused: .* '23514'/],
    ["a child cannot join a group of another org (23503)", /join a group of another org.*'23503'/],
    ["GUC on suppresses the fan-out", /GUC on: the fan-out is suppressed/],
    ["the fan-out stays inside its group", /fan-out does not leave its group/],
    ["a bulk UPDATE with divergent values leaves identical siblings", /bulk UPDATE with divergent values/],
    ["purging an org succeeds with a seeded group and child", /DELETE FROM organizations succeeds with a group and a child/],
    // Prod already rejects a kit without tipo_kit (inventario_kit_tipo_required_check, 177): without
    // tipo_kit the two kit probes would pass even if inventario_grupo_no_kit were missing.
    ["the kit UPDATE carries tipo_kit, so only the group check can reject it", /SET es_kit = true, tipo_kit = 'ENSAMBLADO' WHERE/],
    ["the kit INSERT carries tipo_kit, so only the group check can reject it", /es_kit, tipo_kit, grupo_id, atributos\) SELECT org, 'PRB-KIT', 'kit', 'Fundas', 1, 1, true, 'ENSAMBLADO', grupo/],
    ["an ungrouped row of the same org proves the fan-out stays in its group", /fan-out does not touch an ungrouped row of the same org.*'PlainCat'/],
  ])("%s", (_name, re) => {
    expect(sql).toMatch(re)
  })

  it("the header says what ran only on the local engine (no production claim for the new DML)", () => {
    expect(PROBES).not.toMatch(/also dry-run on production/)
    expect(PROBES).toMatch(/local engine only/)
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
