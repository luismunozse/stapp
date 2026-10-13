// @vitest-environment node
import { describe, it, expect } from "vitest"
import { collapse, readByMarker } from "./helpers/sql-text"
import { NAME_VECTORS } from "./helpers/variantes-vectores"

// The M1b probes run by hand against a real database. These pins stop a probe from being deleted or
// weakened unnoticed, and keep the name vectors of the JS twin and of the RPC probes in step (G3).

const PROBES = readByMarker("verify", "Verification of M1b")
const SQL = collapse(PROBES)

describe("M1b probes: name vectors mirror the shared fixture (G3)", () => {
  const block = PROBES.split("-- NAMES:BEGIN")[1].split("-- NAMES:END")[0]

  it("carries every name vector, in order", () => {
    const rows = [...block.matchAll(/\(\s*\d+,\s*'([^']*)',\s*'(\[.*?\])',\s*'([^']*)'\s*\)/g)]
    expect(rows.map(([, base, values, expected]) => ({ base, values: JSON.parse(values), expected }))).toEqual(NAME_VECTORS)
  })

  it("pushes each vector through the RPC and compares the stored name", () => {
    const after = PROBES.split("-- NAMES:END")[1]
    expect(after).toContain("pg_temp.run('v' || n")
    expect(after).toMatch(/pg_temp\.ck\(200 \+ n, 'name vector '/)
  })
})

describe("M1b probes: frame and rehearsal", () => {
  it("is one transaction: BEGIN first, one final SELECT over _r, ROLLBACK last", () => {
    expect(SQL.startsWith("BEGIN;")).toBe(true)
    expect(SQL).toMatch(/SELECT orden, probe, esperado, obtenido FROM _r ORDER BY orden, probe; ROLLBACK;$/)
  })

  it("inlines the rollback file verbatim and checks the function is gone and the data stays", () => {
    const inline = PROBES.split("-- ROLLBACK:BEGIN")[1].split("-- ROLLBACK:END")[0]
    expect(collapse(inline)).toBe(collapse(readByMarker("rollback", "Rollback of M1b")))
    expect(SQL).toMatch(/rehearsal: the function is gone/)
    expect(SQL).toMatch(/rehearsal: groups and children are untouched/)
  })

  it("counts its own rows, so a check that finds no row cannot vanish unseen", () => {
    expect(SQL).toMatch(/INSERT INTO _r SELECT 999, [^;]*FROM _r;/)
  })

  it("says what ran only on the local engine (no production claim)", () => {
    expect(PROBES).toMatch(/local engine only/)
    expect(PROBES).not.toMatch(/dry-run on production/)
  })

  it("holds no raw invisible Unicode and no backslash-u escapes (the editor tools turn them into characters; the probes use chr())", () => {
    const invisible = [0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff]
    for (const code of invisible) expect(PROBES.includes(String.fromCharCode(code))).toBe(false)
    expect(PROBES.includes(String.fromCharCode(92) + "u")).toBe(false)
  })
})

describe("M1b probes: every error probe can fail for ITS reason (G12)", () => {
  it("the probe helper refuses an error expectation without a message pattern and compares SQLSTATE and message", () => {
    expect(SQL).toMatch(/IF p_esperado <> 'ok' AND p_msg IS NULL THEN RAISE EXCEPTION/)
    expect(SQL).toMatch(/v_got = p_esperado AND \(p_msg IS NULL OR v_msg LIKE p_msg\)/)
  })

  it("each battery probe has its own group id (a wrongly accepted call cannot change a later one)", () => {
    // These act on an EXISTING group on purpose: 115, 142, 152 and 153 test the membership rules of the
    // archive group 8, 147 tries to use group 1 from the other organization, 306-308 and 317-318 need the
    // members of groups 204 and 208, and 328-329 test thresholds against the stored rows of group 200.
    const existing: Record<string, number> = {
      "115": 8, "142": 8, "147": 1, "152": 8, "153": 8, "306": 204, "307": 204, "308": 204, "317": 208, "318": 208, "328": 200, "329": 200,
    }
    let checked = 0
    for (const line of PROBES.split("\n")) {
      const m = /^\s*PERFORM pg_temp\.probe\(([13]\d\d),/.exec(line)
      if (!m || !line.includes("pg_temp.grupo(")) continue
      checked++
      expect(line).toContain(`pg_temp.grupo(${existing[m[1]] ?? m[1]},`)
    }
    expect(checked).toBeGreaterThan(55)
  })

  // Production already rejects a kit without tipo_kit (inventario_kit_tipo_required_check, 177) with a
  // 23514: without tipo_kit the kit probe would pass even if the P0032 guard were missing.
  it("the kit fixture carries tipo_kit, so only the RPC guard or the M1a CHECK can reject it", () => {
    expect(SQL).toMatch(/'PB8-KIT', 'Probe kit', 'Fundas', 1, 1, true, 'ENSAMBLADO'/)
    expect(SQL).toMatch(/'P0032', .*?'KIT_NO_PERMITIDO: %'/)
  })

  it.each([
    ["restore into an occupied slot is P0030", /restore into an occupied slot is P0030.*?'COMBINACION_DUPLICADA%'/],
    ["restore with a reused code is P0035 and names the code", /restore with a code now used by another active item is P0035.*?'CODIGO_DUPLICADO:PB7-RO'/],
    ["every offending code is listed, sorted", /'CODIGO_DUPLICADO:PB8-S,PB8-X1,PB8-X2'/],
    ["reserved stock is P0033 and names the row and the units", /'STOCK_RESERVADO:' \|\| pg_temp\.cid\(82\) \|\| ':2'/],
    ["a P0033 save rolls back whole (group name, new row, archived row)", /the P0033 save rolled back whole.*?'Probe Archivo\/0\/true'/],
    ["three 1000-character valores are refused before the btree limit", /three oversized valores are refused before the btree limit.*?repeat\('x', 1000\)/],
    ["a valor of 101 characters", /a valor of 101 characters.*?repeat\('x', 101\)/],
    ["an oversized codigo", /an oversized codigo \(btree\).*?repeat\('c', 3000\)/],
    ["imagen_url is refused in p_compartidos and in a variante", /refuses a column outside the 9 shared ones \(imagen_url\).*?a variante refuses imagen_url/],
    ["more than 100 rows, more than 3 options, a product above 100", /more than 100 rows.*?more than 3 options.*?above 100/],
    ["items, groups and depots of another org are P0002 and left untouched", /an item of another organization is refused as not found \(P0002\).*?group id owned by another organization is P0002.*?depot of another organization.*?not touched by the P0002 probes/],
    ["an inactive depot and a foreign supplier are P0002", /an inactive depot for the initial stock \(P0002\).*?supplier of another organization \(P0002\)/],
    ["an ungrouped control row proves the fan-out stays in its group", /an ungrouped row of the same org keeps its categoria', 'PlainCat'/],
  ])("%s", (_name, re) => {
    expect(SQL).toMatch(re)
  })
})

describe("M1b probes: positive behavior is checked on rows, not only on the result object", () => {
  it.each([
    ["initial stock lands in the non-principal depot and equals the sum of the depots", /initial stock sits in Norte only/],
    ["a retry does not double stock or movements", /retry: the initial stock is not applied twice/],
    ["promotion keeps id, stock per depot, reservation, photo and gallery and writes no movement", /promotion keeps imagen_url, imagen_path and both gallery rows/],
    ["archive keeps stock, photo and gallery", /archive keeps stock, depot rows, photo, gallery and writes no movement/],
    ["restore reuses the SAME row", /restore reactivates the SAME row/],
    ["renaming the base and a value together uses the PREVIOUS base and values", /renaming base and value together re-derives the managed name/],
    ["renombrar = false keeps names through a later base rename", /a later base rename leaves those custom names alone/],
    ["a no-op save renames nothing", /a no-op save renames nothing/],
    ["absent precio_compra leaves the cost, barcode null clears", /absent precio_compra leaves the stored cost.*?barcode null clears it/],
    ["the fan-out reaches the archived sibling", /reach Azul AND the archived Negro/],
    ["new rows start without a photo", /new rows start with no photo/],
  ])("%s", (_name, re) => {
    expect(SQL).toMatch(re)
  })
})

describe("M1b probes: the review fixes and the old survivors are covered", () => {
  it.each([
    ["a save that leaves active members out names them (add option, rename option too)",
      /a save that leaves out active members is refused and names them.*?'PAYLOAD_INVALIDO:miembros_faltantes:' \|\| pg_temp\.cid\(2042\) \|\| ',' \|\| pg_temp\.cid\(2043\).*?adding an option while leaving members out.*?renaming an option while leaving members out/],
    ["the refused saves change nothing, and archiving the rest in the same call is accepted",
      /the refused saves left the group \(1 option\).*?leaving a member out is fine when the same call archives it/],
    ["restore after a base rename shows the CURRENT base; a custom name survives; a new value re-derives",
      /restoring after a base rename gives the row the CURRENT base name.*?a custom name survives archive, base rename and restore.*?restoring with a new value re-derives the managed name/],
    ["existing rows are written before new ones (value and code), archive first",
      /rename a row and give a NEW row its freed combination, new row listed FIRST.*?a code freed by an existing row can be taken by a new row listed first.*?archive a row and add a new one on its code AND its combination in the same call/],
    ["swaps and chains among existing rows are documented as a raw 23505",
      /swapping two existing combinations in one save is still a raw 23505.*?'23505'.*?a code chain among existing rows, mover first, is still a raw 23505.*?'23505'/],
    ["thresholds and location: insert, update, null and absent",
      /insert writes min, max, reorder point and the trimmed location.*?update writes each of the four.*?a JSON null clears a threshold/],
    ["stock_minimo and stock_maximo are compared against the STORED row",
      /stock_minimo alone above the STORED stock_maximo.*?stock_maximo alone below the STORED stock_minimo/],
    ["an edit stores the group name, the option values and a renamed option",
      /an edit stores the new group name and the new option values.*?an edit stores a renamed option and the row follows it/],
    ["an item joining an existing group takes the group values", /the joining item takes the group values \(GCat, gdesc, no series\)/],
    ["shared-field shapes: boolean, whole numbers, descripcion and categoria caps",
      /trackea_lotes must be a boolean.*?dias_garantia_default must be a whole number.*?dias_alerta_vencimiento must be a number, not text.*?descripcion over 2000 characters.*?categoria over 200 characters/],
    ["a blank and a NULL p_org, more than 100 ids to archive, an unknown p_user",
      /a blank p_org.*?a NULL p_org.*?more than 100 ids to archive.*?an unknown p_user/],
    ["prices: rounding past the column, more than 2 decimals, the largest valid price",
      /a price that rounds up past the column \(99999999\.995\).*?a price with more than 2 decimals.*?the largest valid price is stored exactly/],
    ["names: padded group name, padded option name, repeated option names (exact and by case)",
      /a group name padded with spaces past 200 raw characters.*?an option name padded with spaces past 100 raw characters.*?two options with the same name.*?two options whose names differ only by case/],
    ["the initial-stock movement is labelled", /the initial-stock movements are labelled/],
  ])("%s", (_name, re) => {
    expect(SQL).toMatch(re)
  })

  it("executes the RPC as the real caller: service_role works, anon and authenticated get 42501", () => {
    expect(SQL).toMatch(/service_role, the real caller, saves a group with initial stock', 'service_role', 'ok'/)
    expect(SQL).toMatch(/anon cannot call it', 'anon', '42501'.*?'permission denied for function guardar_grupo_variantes%'/)
    expect(SQL).toMatch(/authenticated cannot call it', 'authenticated', '42501'.*?'permission denied for function guardar_grupo_variantes%'/)
    expect(SQL).toMatch(/the service_role save wrote its row, its stock and its movement; the refused callers wrote nothing/)
  })

  it("the role helper restores the role, refuses an error expectation without a message and keeps temp tables out of the other role", () => {
    const helper = need(/CREATE FUNCTION pg_temp\.como\((.*?)END \$\$;/)[1]
    expect(helper).toContain("EXECUTE format('SET LOCAL ROLE %I', p_role); EXECUTE p_sql;")
    expect(helper).toContain("RESET ROLE;")
    expect(helper).toContain("IF p_esperado <> 'ok' AND p_msg IS NULL THEN RAISE EXCEPTION")
    expect(PROBES).toMatch(/must not read this session's temp tables/)
  })

  it("the header says to run the probes before PR4 merges because the DROP rehearsal holds a lock", () => {
    const head = PROBES.slice(0, PROBES.indexOf("BEGIN;")).replace(/\n--\s?/g, " ")
    expect(head).toMatch(/RUN IT BEFORE PR4 MERGES/)
    expect(head).toMatch(/rehearsal holds the DROP, a save that arrives waits on the lock until the ROLLBACK/)
  })
})

function need(re: RegExp): RegExpExecArray {
  const m = re.exec(SQL)
  if (!m) throw new Error(`pattern not found: ${re}`)
  return m
}
