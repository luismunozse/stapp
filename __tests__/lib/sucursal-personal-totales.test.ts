// @vitest-environment node
/**
 * The total of open orders a technician holds in EVERY branch (change sucursales-aislamiento, PR5b): the
 * second embed of the orders next to the one that narrows to the scope. Its two filters name the embed by
 * its alias, which is not the table's name (both embeds would answer to that), and what the embed holds is
 * counted, never read as rows of the orders table.
 */
import { describe, it, expect } from "vitest"
import { ESTADOS_ACTIVOS } from "@/lib/order-states"
import {
  ALIAS_ACTIVAS_TOTALES,
  EMBED_ORDENES_ACTIVAS_TOTALES,
  soloActivasEnTodasLasSucursales,
  totalDeOrdenesActivas,
} from "@/lib/sucursal-personal"

describe("the embed of the open orders of every branch", () => {
  it("is aliased, and the alias is not the table's own name", () => {
    expect(EMBED_ORDENES_ACTIVAS_TOTALES.startsWith(`${ALIAS_ACTIVAS_TOTALES}:`)).toBe(true)
    expect(ALIAS_ACTIVAS_TOTALES).not.toBe("ordenes_servicio")
  })

  it("embeds the orders the technician holds, by the technician column, and brings only their ids", () => {
    expect(EMBED_ORDENES_ACTIVAS_TOTALES).toBe("activas_totales:ordenes_servicio!tecnico_id (id)")
  })
})

describe("soloActivasEnTodasLasSucursales", () => {
  /** A query that records the filters it receives, in order, and answers itself. */
  function consulta() {
    const filtros: Array<[string, ...unknown[]]> = []
    const q: any = {
      eq: (...args: unknown[]) => (filtros.push(["eq", ...args]), q),
      in: (...args: unknown[]) => (filtros.push(["in", ...args]), q),
    }
    return { q, filtros }
  }

  it("answers the same query", () => {
    const { q } = consulta()
    expect(soloActivasEnTodasLasSucursales(q, "org-1")).toBe(q)
  })

  it("narrows the embed to the organization and to the open states: no filter on the branch", () => {
    const { q, filtros } = consulta()
    soloActivasEnTodasLasSucursales(q, "org-1")
    expect(filtros).toEqual([
      ["eq", "activas_totales.organization_id", "org-1"],
      ["in", "activas_totales.estado", [...ESTADOS_ACTIVOS]],
    ])
    expect(filtros.some(([, columna]) => String(columna).includes("sucursal_id"))).toBe(false)
  })
})

describe("totalDeOrdenesActivas", () => {
  it("counts the rows of the embed", () => {
    expect(totalDeOrdenesActivas({ activas_totales: [{ id: "a" }, { id: "b" }, { id: "c" }] })).toBe(3)
  })

  it("is zero for a technician who holds none", () => {
    expect(totalDeOrdenesActivas({ activas_totales: [] })).toBe(0)
  })

  it("a row that does not carry the embed is an error, not zero: a total that was never read must not read as 'holds nothing'", () => {
    expect(() => totalDeOrdenesActivas({})).toThrow(/activas_totales/)
    expect(() => totalDeOrdenesActivas({ activas_totales: null })).toThrow(/activas_totales/)
    expect(() => totalDeOrdenesActivas({ activas_totales: undefined })).toThrow(/activas_totales/)
  })
})
