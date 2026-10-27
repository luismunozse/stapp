// @vitest-environment node
/**
 * Pure rules of branch isolation for service orders (change sucursales-aislamiento, PR2):
 * which branch HANDLES an order, the PostgREST filters that scope a list to a branch, the
 * technician list rule (BM-6, OI-3, XC-4) and the assignment rule (BM-5).
 *
 * Until migration M1 is applied there is no `derivada_a_sucursal_id` column, so the
 * handling branch IS the origin `sucursal_id` and no filter may mention the new column
 * (a missing column is a 42703 on the hot list query). PR7 flips these; the tests that
 * say "ignores derivada" are the ones it replaces.
 */
import { describe, it, expect } from "vitest"
import {
  sucursalQueAtiende,
  filtroVisibleEnSucursal,
  filtroAtiendeSucursal,
  filtroListaTecnico,
  tecnicoAsignable,
  combinarOr,
  terminoDeBusquedaSeguro,
  esIdSeguro,
  tecnicoOfrecido,
  MENSAJE_TECNICO_OTRA_SUCURSAL,
} from "@/lib/sucursal-ordenes"
import { SUCURSAL_NINGUNA } from "@/lib/sucursal"

describe("esIdSeguro", () => {
  it.each(["suc-A", "cmabc123XYZ", "3f2b1c9e-1111-4222-8333-444455556666", "a_b-c"])(
    "accepts %s",
    (id) => {
      expect(esIdSeguro(id)).toBe(true)
    },
  )

  it.each([
    ["empty", ""],
    ["comma", "a,b"],
    ["paren", "a)"],
    ["dot", "a.b"],
    ["space", "a b"],
    ["quote", 'a"b'],
    ["null", null],
    ["number", 7],
  ])("rejects %s", (_nombre, id) => {
    expect(esIdSeguro(id)).toBe(false)
  })
})

describe("sucursalQueAtiende", () => {
  it("is the origin branch", () => {
    expect(sucursalQueAtiende({ sucursal_id: "suc-A" })).toBe("suc-A")
    expect(sucursalQueAtiende({ sucursal_id: "suc-B" })).toBe("suc-B")
  })

  it("ignores derivada_a_sucursal_id until the derivation migration is live", () => {
    expect(sucursalQueAtiende({ sucursal_id: "suc-A", derivada_a_sucursal_id: "suc-B" })).toBe("suc-A")
  })
})

describe.each([
  ["filtroVisibleEnSucursal", filtroVisibleEnSucursal],
  ["filtroAtiendeSucursal", filtroAtiendeSucursal],
])("%s", (_nombre, filtro) => {
  it("matches the origin branch and never references the derivation column", () => {
    expect(filtro("suc-A")).toBe("sucursal_id.eq.suc-A")
    expect(filtro("suc-B")).toBe("sucursal_id.eq.suc-B")
    expect(filtro("suc-A")).not.toContain("derivada_a_sucursal_id")
  })

  it.each([
    ["a comma that would add a clause", "suc-A,sucursal_id.neq.x"],
    ["a closing paren", "suc-A)"],
    ["empty", ""],
    ["null", null],
    ["undefined", undefined],
  ])("fails closed on %s", (_caso, id) => {
    expect(filtro(id as string | null)).toBe(`sucursal_id.eq.${SUCURSAL_NINGUNA}`)
  })
})

describe("filtroListaTecnico", () => {
  it("toma ON + own branch: assigned to me, or unassigned AND handled by my branch", () => {
    expect(filtroListaTecnico("tec-1", "suc-A", true)).toBe(
      "tecnico_id.eq.tec-1,and(tecnico_id.is.null,sucursal_id.eq.suc-A)",
    )
    expect(filtroListaTecnico("tec-2", "suc-B", true)).toBe(
      "tecnico_id.eq.tec-2,and(tecnico_id.is.null,sucursal_id.eq.suc-B)",
    )
  })

  it("toma OFF: null, i.e. only what is assigned to me (the caller uses an eq on tecnico_id)", () => {
    expect(filtroListaTecnico("tec-1", "suc-A", false)).toBeNull()
  })

  it("branchless technician (XC-4): null even with toma ON, never the whole org's unassigned orders", () => {
    expect(filtroListaTecnico("tec-1", null, true)).toBeNull()
  })

  it("a branch id that cannot be spliced fails closed to the sentinel branch, assigned orders still listed", () => {
    expect(filtroListaTecnico("tec-1", "suc-A,x", true)).toBe(
      `tecnico_id.eq.tec-1,and(tecnico_id.is.null,sucursal_id.eq.${SUCURSAL_NINGUNA})`,
    )
  })

  it("a user id that cannot be spliced: null (the caller falls back to the eq)", () => {
    expect(filtroListaTecnico("tec-1,x", "suc-A", true)).toBeNull()
  })

  it("never references the derivation column", () => {
    expect(filtroListaTecnico("tec-1", "suc-A", true)).not.toContain("derivada_a_sucursal_id")
  })
})

describe("tecnicoAsignable (BM-5)", () => {
  const tec = (over: Partial<{ id: string; rol: string; sucursal_id: string | null }> = {}) => ({
    id: "tec-9",
    rol: "TECNICO",
    sucursal_id: "suc-A",
    ...over,
  })

  it.each([
    ["same branch as the handling branch", tec({ sucursal_id: "suc-A" }), "suc-A", null, true],
    ["another branch", tec({ sucursal_id: "suc-C" }), "suc-A", null, false],
    ["no branch (fail closed)", tec({ sucursal_id: null }), "suc-A", null, false],
    ["an ADMIN, who belongs to no branch", tec({ rol: "ADMIN", sucursal_id: null }), "suc-A", null, true],
    ["an ADMIN of whatever branch", tec({ rol: "ADMIN", sucursal_id: "suc-C" }), "suc-A", null, true],
    ["the unchanged legacy cross-branch assignee", tec({ sucursal_id: "suc-C" }), "suc-A", "tec-9", true],
    ["another technician than the previous one, cross-branch", tec({ sucursal_id: "suc-C" }), "suc-A", "tec-1", false],
    ["no handling branch to compare with (fail closed)", tec({ sucursal_id: "suc-A" }), null, null, false],
    ["no branch on either side is not a match (fail closed)", tec({ sucursal_id: null }), null, null, false],
    ["no handling branch, but unchanged", tec({ sucursal_id: "suc-A" }), null, "tec-9", true],
  ] as const)("%s", (_caso, tecnico, atiende, previo, esperado) => {
    expect(tecnicoAsignable(tecnico, atiende, previo)).toBe(esperado)
  })

  it("has the message the API returns to the user", () => {
    expect(MENSAJE_TECNICO_OTRA_SUCURSAL).toBe("Ese técnico no pertenece a la sucursal de esta orden")
  })
})

describe("combinarOr (open item 7: no reliance on repeated or params ANDing)", () => {
  it("one list stays as it is", () => {
    expect(combinarOr("a.eq.1,b.eq.2")).toBe("a.eq.1,b.eq.2")
  })

  it("two lists become ONE and(or(..),or(..)) expression", () => {
    expect(combinarOr("a.eq.1,b.eq.2", "c.eq.3,d.eq.4")).toBe("and(or(a.eq.1,b.eq.2),or(c.eq.3,d.eq.4))")
  })

  it("a single-condition list is not wrapped, a nested one is", () => {
    expect(combinarOr("a.eq.1", "c.eq.3,and(d.is.null,e.eq.5)")).toBe(
      "and(a.eq.1,or(c.eq.3,and(d.is.null,e.eq.5)))",
    )
  })

  it("three lists", () => {
    expect(combinarOr("a.eq.1,a.eq.2", "b.eq.1,b.eq.2", "c.eq.1,c.eq.2")).toBe(
      "and(or(a.eq.1,a.eq.2),or(b.eq.1,b.eq.2),or(c.eq.1,c.eq.2))",
    )
  })

  it("ignores empty lists", () => {
    expect(combinarOr("", "a.eq.1,b.eq.2", "")).toBe("a.eq.1,b.eq.2")
    expect(combinarOr()).toBe("")
  })
})

describe("terminoDeBusquedaSeguro", () => {
  it("keeps an ordinary term", () => {
    expect(terminoDeBusquedaSeguro("iPhone 11")).toBe("iPhone 11")
  })

  it("replaces every character that could close the nested expression with the one-char wildcard", () => {
    expect(terminoDeBusquedaSeguro("x)),sucursal_id.neq.zz,and(a")).toBe("x___sucursal_id.neq.zz_and_a")
    expect(terminoDeBusquedaSeguro('a"b\\c')).toBe("a_b_c")
  })

  it("leaves the term safe to put inside a combined expression", () => {
    const hostil = "x)),sucursal_id.neq.zz,and(a"
    const expr = combinarOr(
      "tecnico_id.eq.tec-1,and(tecnico_id.is.null,sucursal_id.eq.suc-A)",
      `dispositivo.ilike.%${terminoDeBusquedaSeguro(hostil)}%,marca.ilike.%${terminoDeBusquedaSeguro(hostil)}%`,
    )
    // Balanced parens and exactly one top-level and(...): the term cannot add a sibling clause.
    const abre = (expr.match(/\(/g) ?? []).length
    const cierra = (expr.match(/\)/g) ?? []).length
    expect(abre).toBe(cierra)
    expect(expr.startsWith("and(")).toBe(true)
    expect(expr.endsWith(")")).toBe(true)
    expect(expr).not.toMatch(/\)\s*,\s*sucursal_id\.neq/)
  })
})

describe("tecnicoOfrecido (a technician that came from a draft or an appointment)", () => {
  const OFRECIDOS = [{ id: "t-a" }, { id: "t-a2" }]

  // `cargada` = the list was fetched successfully (an empty list is a list: nobody is offered).
  it.each([
    ["is kept when the picker offers it", "t-a2", OFRECIDOS, true, "t-a2"],
    ["is dropped when the loaded picker does not offer it", "t-b", OFRECIDOS, true, ""],
    ["is dropped when the loaded picker offers NOBODY (an empty list is still a list)", "t-b", [], true, ""],
    ["is kept while the list has not loaded", "t-b", [], false, "t-b"],
    ["is kept when the list failed to load (nothing to judge against)", "t-b", [], false, "t-b"],
    ["nobody chosen stays nobody", "", OFRECIDOS, true, ""],
    ["nobody chosen stays nobody, loaded and empty", "", [], true, ""],
  ])("a choice that %s", (_caso, elegido, ofrecidos, cargada, esperado) => {
    expect(tecnicoOfrecido(elegido, ofrecidos, cargada)).toBe(esperado)
  })
})
