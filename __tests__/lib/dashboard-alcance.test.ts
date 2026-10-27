// @vitest-environment node
/**
 * The scope of a dashboard load (change sucursales-aislamiento, PR4). The aggregates are cached for
 * two minutes, so the scope has to be an ARGUMENT of the cached function: it is what Next keys the
 * cache on. These are the pure parts: scope -> cache key -> branch.
 */
import { describe, it, expect } from "vitest"
import { claveDeAlcance, sucursalDeClave, CLAVE_TODAS } from "@/lib/dashboard-alcance"
import { SUCURSAL_NINGUNA } from "@/lib/sucursal"

describe("claveDeAlcance", () => {
  it("every branch (an ADMIN on Todas): the shared key", () => {
    expect(claveDeAlcance({ sucursalId: null, verTodas: true })).toBe(CLAVE_TODAS)
    expect(CLAVE_TODAS).toBe("todas")
  })

  it("one branch: the branch id, so each branch has its own cache entry", () => {
    expect(claveDeAlcance({ sucursalId: "suc-A", verTodas: false })).toBe("suc-A")
    expect(claveDeAlcance({ sucursalId: "suc-B", verTodas: false })).toBe("suc-B")
  })

  it("the sentinel (a non-admin without a branch) keeps its own key and matches no row", () => {
    expect(claveDeAlcance({ sucursalId: SUCURSAL_NINGUNA, verTodas: false })).toBe(SUCURSAL_NINGUNA)
  })

  it.each([
    ["a comma that would add a clause", "suc-A,sucursal_id.neq.x"],
    ["a closing parenthesis", "suc-A)"],
    ["a dot", "a.b"],
    ["empty", ""],
  ])("an id that cannot be spliced into a filter fails closed (%s)", (_caso, id) => {
    expect(claveDeAlcance({ sucursalId: id, verTodas: false })).toBe(SUCURSAL_NINGUNA)
  })

  it("no branch but not 'every branch' either (never produced today) fails closed, not open", () => {
    expect(claveDeAlcance({ sucursalId: null, verTodas: false })).toBe(SUCURSAL_NINGUNA)
  })
})

describe("sucursalDeClave (inside the cached function, from its arguments alone)", () => {
  it("the shared key means no branch filter", () => {
    expect(sucursalDeClave(CLAVE_TODAS)).toBeNull()
  })

  it("a branch key is the branch", () => {
    expect(sucursalDeClave("suc-A")).toBe("suc-A")
    expect(sucursalDeClave(SUCURSAL_NINGUNA)).toBe(SUCURSAL_NINGUNA)
  })

  it("anything else fails closed, so a key that was not made by claveDeAlcance never widens", () => {
    expect(sucursalDeClave("x,sucursal_id.neq.y")).toBe(SUCURSAL_NINGUNA)
    expect(sucursalDeClave("")).toBe(SUCURSAL_NINGUNA)
  })

  it("round trip: the key of a scope gives back the same scope", () => {
    for (const lectura of [
      { sucursalId: null, verTodas: true },
      { sucursalId: "suc-A", verTodas: false },
      { sucursalId: SUCURSAL_NINGUNA, verTodas: false },
    ]) {
      expect(sucursalDeClave(claveDeAlcance(lectura))).toBe(lectura.sucursalId)
    }
  })
})
