import { describe, it, expect, vi } from "vitest"
import {
  resolverAlcanceOrdenes,
  ordenEnAlcance,
  aplicarAlcanceOrdenes,
} from "@/lib/ordenes/alcance-lectura"
import { SUCURSAL_NINGUNA } from "@/lib/sucursal"

const S1 = "11111111-1111-4111-8111-111111111111"
const S2 = "22222222-2222-4222-8222-222222222222"
const U1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const U2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

describe("resolverAlcanceOrdenes", () => {
  it("ADMIN viewing all branches has no filter", () => {
    expect(
      resolverAlcanceOrdenes({ role: "ADMIN", sucursalId: null, verTodas: true, userId: U1 })
    ).toEqual({ tipo: "todas" })
  })

  it("ADMIN with a branch selected is filtered by that branch only", () => {
    expect(
      resolverAlcanceOrdenes({ role: "ADMIN", sucursalId: S1, verTodas: false, userId: U1 })
    ).toEqual({ tipo: "sucursal", sucursalId: S1 })
  })

  it("VENDEDOR is filtered by branch only", () => {
    expect(
      resolverAlcanceOrdenes({ role: "VENDEDOR", sucursalId: S1, verTodas: false, userId: U1 })
    ).toEqual({ tipo: "sucursal", sucursalId: S1 })
  })

  it("TECNICO gets branch OR assigned", () => {
    expect(
      resolverAlcanceOrdenes({ role: "TECNICO", sucursalId: S1, verTodas: false, userId: U1 })
    ).toEqual({ tipo: "sucursal_o_asignadas", sucursalId: S1, userId: U1 })
  })

  it("non-admin never gets the unfiltered scope, even if verTodas leaks in", () => {
    expect(
      resolverAlcanceOrdenes({ role: "VENDEDOR", sucursalId: null, verTodas: true, userId: U1 })
    ).toEqual({ tipo: "sucursal", sucursalId: SUCURSAL_NINGUNA })
  })

  it("unknown or null role is treated as branch-scoped", () => {
    expect(
      resolverAlcanceOrdenes({ role: null, sucursalId: S1, verTodas: false, userId: U1 })
    ).toEqual({ tipo: "sucursal", sucursalId: S1 })
  })

  it("TECNICO with a malformed user id degrades to branch only", () => {
    expect(
      resolverAlcanceOrdenes({ role: "TECNICO", sucursalId: S1, verTodas: false, userId: "x,y" })
    ).toEqual({ tipo: "sucursal", sucursalId: S1 })
    expect(
      resolverAlcanceOrdenes({ role: "TECNICO", sucursalId: S1, verTodas: false, userId: null })
    ).toEqual({ tipo: "sucursal", sucursalId: S1 })
  })

  it("a malformed branch id fails closed", () => {
    expect(
      resolverAlcanceOrdenes({ role: "VENDEDOR", sucursalId: "a),or(x", verTodas: false, userId: U1 })
    ).toEqual({ tipo: "sucursal", sucursalId: SUCURSAL_NINGUNA })
  })
})

describe("ordenEnAlcance", () => {
  const propia = { sucursal_id: S1, tecnico_id: null }
  const otraSinAsignar = { sucursal_id: S2, tecnico_id: null }
  const otraAsignadaAMi = { sucursal_id: S2, tecnico_id: U1 }
  const otraAsignadaAOtro = { sucursal_id: S2, tecnico_id: U2 }
  const propiaAsignadaAOtro = { sucursal_id: S1, tecnico_id: U2 }

  const admin = (verTodas: boolean) =>
    resolverAlcanceOrdenes({
      role: "ADMIN",
      sucursalId: verTodas ? null : S1,
      verTodas,
      userId: U1,
    })
  const vendedor = resolverAlcanceOrdenes({ role: "VENDEDOR", sucursalId: S1, verTodas: false, userId: U1 })
  const tecnico = resolverAlcanceOrdenes({ role: "TECNICO", sucursalId: S1, verTodas: false, userId: U1 })

  it("ADMIN verTodas sees every order", () => {
    for (const o of [propia, otraSinAsignar, otraAsignadaAMi, otraAsignadaAOtro]) {
      expect(ordenEnAlcance(admin(true), o)).toBe(true)
    }
  })

  it("ADMIN with a branch selected sees only that branch, assigned or not", () => {
    expect(ordenEnAlcance(admin(false), propia)).toBe(true)
    expect(ordenEnAlcance(admin(false), propiaAsignadaAOtro)).toBe(true)
    expect(ordenEnAlcance(admin(false), otraSinAsignar)).toBe(false)
    expect(ordenEnAlcance(admin(false), otraAsignadaAMi)).toBe(false)
  })

  it("VENDEDOR sees only the current branch, no matter who is assigned", () => {
    expect(ordenEnAlcance(vendedor, propia)).toBe(true)
    expect(ordenEnAlcance(vendedor, propiaAsignadaAOtro)).toBe(true)
    expect(ordenEnAlcance(vendedor, otraSinAsignar)).toBe(false)
    expect(ordenEnAlcance(vendedor, otraAsignadaAMi)).toBe(false)
    expect(ordenEnAlcance(vendedor, otraAsignadaAOtro)).toBe(false)
  })

  it("TECNICO sees the current branch plus orders assigned to them elsewhere", () => {
    expect(ordenEnAlcance(tecnico, propia)).toBe(true)
    expect(ordenEnAlcance(tecnico, propiaAsignadaAOtro)).toBe(true)
    expect(ordenEnAlcance(tecnico, otraAsignadaAMi)).toBe(true)
    expect(ordenEnAlcance(tecnico, otraSinAsignar)).toBe(false)
    expect(ordenEnAlcance(tecnico, otraAsignadaAOtro)).toBe(false)
  })

  it("an order with no branch is only visible to the unfiltered scope", () => {
    const sinSucursal = { sucursal_id: null, tecnico_id: null }
    expect(ordenEnAlcance(admin(true), sinSucursal)).toBe(true)
    expect(ordenEnAlcance(vendedor, sinSucursal)).toBe(false)
    expect(ordenEnAlcance(tecnico, sinSucursal)).toBe(false)
  })

  it("a missing order is never in scope", () => {
    expect(ordenEnAlcance(admin(true), null)).toBe(false)
    expect(ordenEnAlcance(vendedor, undefined)).toBe(false)
  })
})

function fakeQuery() {
  const q: any = {}
  q.eq = vi.fn().mockReturnValue(q)
  q.or = vi.fn().mockReturnValue(q)
  return q
}

describe("aplicarAlcanceOrdenes", () => {
  it("adds nothing for the unfiltered scope", () => {
    const q = fakeQuery()
    aplicarAlcanceOrdenes(q, { tipo: "todas" })
    expect(q.eq).not.toHaveBeenCalled()
    expect(q.or).not.toHaveBeenCalled()
  })

  it("adds eq sucursal_id for a branch scope", () => {
    const q = fakeQuery()
    aplicarAlcanceOrdenes(q, { tipo: "sucursal", sucursalId: S1 })
    expect(q.eq).toHaveBeenCalledWith("sucursal_id", S1)
  })

  it("adds an or() for the technician scope", () => {
    const q = fakeQuery()
    aplicarAlcanceOrdenes(q, { tipo: "sucursal_o_asignadas", sucursalId: S1, userId: U1 })
    expect(q.or).toHaveBeenCalledWith(`sucursal_id.eq.${S1},tecnico_id.eq.${U1}`, undefined)
  })

  it("prefixes columns and passes referencedTable for embedded orders", () => {
    const q1 = fakeQuery()
    aplicarAlcanceOrdenes(q1, { tipo: "sucursal", sucursalId: S1 }, { referencedTable: "ordenes_servicio" })
    expect(q1.eq).toHaveBeenCalledWith("ordenes_servicio.sucursal_id", S1)

    const q2 = fakeQuery()
    aplicarAlcanceOrdenes(
      q2,
      { tipo: "sucursal_o_asignadas", sucursalId: S1, userId: U1 },
      { referencedTable: "ordenes_servicio" }
    )
    expect(q2.or).toHaveBeenCalledWith(`sucursal_id.eq.${S1},tecnico_id.eq.${U1}`, {
      referencedTable: "ordenes_servicio",
    })
  })
})
