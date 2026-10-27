// @vitest-environment node
/**
 * Who may do what with a service order (change sucursales-aislamiento, PR3).
 *
 * `politicaOrden(actor, orden, everDerived)` is pure and the one place that decides it:
 *  - `ver`: the order is in the actor's scope. false means "not found" for the caller (XC-2).
 *  - `rol`: how the actor relates to it (ADMIN, ORIGEN, DESTINO, ASIGNADO, AJENO).
 *  - `leer` / `editar`: what a TECNICO is narrowed to today (assigned to him, or unassigned
 *    and takeable). Everybody else who can see an order can read and edit it.
 *  - `reparar` / `comercial` / `entregar` / `derivar` / `devolver`: what the branch the actor
 *    belongs to may do while the order is derived (OD-3, OD-4, OD-6, OD-7, OD-8).
 *  - `tomar`: the opt-in `tecnicos_toman_ordenes` claim.
 *
 * The derived rows are computed from the inputs. Nothing fills `derivadaA` until PR7, so in
 * production every order reaches the "not derived" rows.
 *
 * Approved split (design approvals, 2026-10-27): while derived, the ORIGIN sets client-facing
 * statuses (`comercial`) and the DESTINATION sets repair statuses (`reparar`); ENTREGADO is
 * origin-only for an order that has ever been derived.
 */
import { describe, it, expect } from "vitest"
import { politicaOrden } from "@/lib/sucursal-ordenes"

const A = "suc-A"
const B = "suc-B"
const C = "suc-C"

const admin = { userId: "adm", role: "ADMIN", sucursalId: null }
const vendA = { userId: "v-a", role: "VENDEDOR", sucursalId: A }
const vendB = { userId: "v-b", role: "VENDEDOR", sucursalId: B }
const vendC = { userId: "v-c", role: "VENDEDOR", sucursalId: C }
const vendSinSucursal = { userId: "v-0", role: "VENDEDOR", sucursalId: null }
const tecA = { userId: "t-a", role: "TECNICO", sucursalId: A }
const tecB = { userId: "t-b", role: "TECNICO", sucursalId: B }
const tecSanJusto = { userId: "t-sj", role: "TECNICO", sucursalId: "suc-SJ" }
const tecSinSucursal = { userId: "t-0", role: "TECNICO", sucursalId: null }
const conToma = <T extends object>(actor: T) => ({ ...actor, tomaSinAsignar: true })

/** An order created in A. */
const deA = (tecnicoId: string | null = null, derivadaA: string | null = null) => ({
  sucursalId: A,
  tecnicoId,
  derivadaA,
})

const NADA = {
  ver: false,
  rol: "AJENO",
  leer: false,
  editar: false,
  reparar: false,
  comercial: false,
  entregar: false,
  derivar: false,
  devolver: false,
  tomar: false,
} as const

type Marca = Exclude<keyof typeof NADA, "rol">
const esperado = (rol: string, verdaderas: Marca[]) => ({
  ...NADA,
  rol,
  ...Object.fromEntries(verdaderas.map((marca) => [marca, true])),
})

// [name, actor, order, everDerived, role, the permissions that are true]
type Caso = [string, object, ReturnType<typeof deA>, boolean, string, Marca[]]

const TODO_EL_TRABAJO: Marca[] = ["ver", "leer", "editar", "reparar", "comercial", "entregar"]

const SIN_DERIVAR: Caso[] = [
  ["ADMIN: everything but the return", admin, deA("t-x"), false, "ADMIN", [...TODO_EL_TRABAJO, "derivar"]],
  ["VENDEDOR of the order's branch", vendA, deA(), false, "ORIGEN", [...TODO_EL_TRABAJO, "derivar"]],
  ["VENDEDOR of another branch: out of scope", vendB, deA(), false, "AJENO", []],
  ["VENDEDOR with no branch: out of scope (XC-4)", vendSinSucursal, deA(), false, "AJENO", []],
  ["TECNICO of the branch, order assigned to him", tecA, deA("t-a"), false, "ORIGEN", [...TODO_EL_TRABAJO, "derivar"]],
  [
    "TECNICO of the branch, order assigned to a colleague: in scope, closed to him",
    tecA,
    deA("t-x"),
    false,
    "ORIGEN",
    ["ver", "reparar", "comercial", "entregar"],
  ],
  [
    "TECNICO of the branch, unassigned order, toma OFF: in scope, closed to him",
    tecA,
    deA(),
    false,
    "ORIGEN",
    ["ver", "reparar", "comercial", "entregar"],
  ],
  [
    "TECNICO of the branch, unassigned order, toma ON: he can open it and claim it",
    conToma(tecA),
    deA(),
    false,
    "ORIGEN",
    ["ver", "leer", "tomar", "reparar", "comercial", "entregar"],
  ],
  ["TECNICO of another branch, unassigned order, toma ON: out of scope (OI-3)", conToma(tecB), deA(), false, "AJENO", []],
  ["TECNICO of another branch, order assigned to a colleague: out of scope", tecB, deA("t-x"), false, "AJENO", []],
  [
    "TECNICO of another branch, assigned to him (BM-6, jed-electronics): works it, does not derive it",
    tecSanJusto,
    deA("t-sj"),
    false,
    "ASIGNADO",
    TODO_EL_TRABAJO,
  ],
  ["TECNICO with no branch, assigned to him: still his (XC-4)", tecSinSucursal, deA("t-0"), false, "ASIGNADO", TODO_EL_TRABAJO],
  ["TECNICO with no branch, unassigned order, toma ON: nothing (XC-4)", conToma(tecSinSucursal), deA(), false, "AJENO", []],
]

const DERIVADA_A_B: Caso[] = [
  [
    "ADMIN: unrestricted, but cannot deliver or derive again; can return",
    admin,
    deA(null, B),
    true,
    "ADMIN",
    ["ver", "leer", "editar", "reparar", "comercial", "devolver"],
  ],
  [
    "VENDEDOR of the origin: sets client-facing statuses, no repair work, cannot recall (OD-3, OD-4, OD-6)",
    vendA,
    deA(null, B),
    true,
    "ORIGEN",
    ["ver", "leer", "editar", "comercial"],
  ],
  [
    "VENDEDOR of the destination: repair work and the return, no commercial side (OD-3, OD-4, OD-6)",
    vendB,
    deA(null, B),
    true,
    "DESTINO",
    ["ver", "leer", "editar", "reparar", "devolver"],
  ],
  ["VENDEDOR of a third branch: out of scope (OD-4)", vendC, deA(null, B), true, "AJENO", []],
  [
    "TECNICO of the destination, order assigned to him: repair work and the return",
    tecB,
    deA("t-b", B),
    true,
    "DESTINO",
    ["ver", "leer", "editar", "reparar", "devolver"],
  ],
  [
    "TECNICO of the destination, unassigned, toma ON: opens and claims, cannot return it yet",
    conToma(tecB),
    deA(null, B),
    true,
    "DESTINO",
    ["ver", "leer", "tomar", "reparar"],
  ],
  ["TECNICO of the destination, unassigned, toma OFF: in scope, closed to him", tecB, deA(null, B), true, "DESTINO", ["ver", "reparar"]],
  [
    "TECNICO of the origin, unassigned, toma ON: the handling branch is B, so he cannot claim it",
    conToma(tecA),
    deA(null, B),
    true,
    "ORIGEN",
    ["ver", "comercial"],
  ],
  [
    "TECNICO of a third branch, assigned to him: keeps seeing it (BM-6), no commercial side",
    { userId: "t-c", role: "TECNICO", sucursalId: C },
    deA("t-c", B),
    true,
    "ASIGNADO",
    ["ver", "leer", "editar", "reparar"],
  ],
]

const DEVUELTA: Caso[] = [
  ["ADMIN of a returned order: delivers", admin, deA(null, null), true, "ADMIN", [...TODO_EL_TRABAJO, "derivar"]],
  [
    "VENDEDOR of the origin of a returned order: delivers, and may derive again (OD-7, OD-8)",
    vendA,
    deA(),
    true,
    "ORIGEN",
    [...TODO_EL_TRABAJO, "derivar"],
  ],
  ["VENDEDOR of the former destination: out of scope again (OD-6)", vendB, deA(), true, "AJENO", []],
  [
    "the destination's technician keeps the assignment after the return: works it, cannot deliver (OD-6, OD-7)",
    tecB,
    deA("t-b"),
    true,
    "ASIGNADO",
    ["ver", "leer", "editar", "reparar", "comercial"],
  ],
]

describe("politicaOrden", () => {
  describe.each([
    ["not derived, never derived (the only state production has)", SIN_DERIVAR],
    ["derived from A to B", DERIVADA_A_B],
    ["returned to A after a derivation", DEVUELTA],
  ])("%s", (_estado, casos) => {
    it.each(casos)("%s", (_nombre, actor, orden, everDerived, rol, verdaderas) => {
      expect(politicaOrden(actor as any, orden, everDerived)).toEqual(esperado(rol, verdaderas))
    })
  })

  it("nothing is granted to an actor for whom the order is out of scope", () => {
    const casos = [...SIN_DERIVAR, ...DERIVADA_A_B, ...DEVUELTA]
    const fueraDeAlcance = casos.filter(([, , , , rol]) => rol === "AJENO")
    expect(casos.length).toBeGreaterThan(20)
    expect(fueraDeAlcance.length).toBeGreaterThan(5)

    for (const [nombre, actor, orden, everDerived] of fueraDeAlcance) {
      const { ver, rol: _rol, ...resto } = politicaOrden(actor as any, orden, everDerived)
      expect(ver, nombre).toBe(false)
      expect(Object.values(resto).some(Boolean), nombre).toBe(false)
    }
  })

  it("an order with no origin branch is reachable only by an ADMIN or its technician (fail-closed)", () => {
    const sinOrigen = { sucursalId: null, tecnicoId: "t-a", derivadaA: null }

    expect(politicaOrden(vendA, sinOrigen, false).ver).toBe(false)
    expect(politicaOrden(vendSinSucursal, sinOrigen, false).ver).toBe(false)
    expect(politicaOrden(tecA, sinOrigen, false).ver).toBe(true)
    expect(politicaOrden(admin, sinOrigen, false).ver).toBe(true)
  })

  it("the toma flag is read only for a TECNICO and defaults to off", () => {
    const libre = deA()

    expect(politicaOrden(tecA, libre, false).tomar).toBe(false)
    expect(politicaOrden({ ...tecA, tomaSinAsignar: false }, libre, false).tomar).toBe(false)
    expect(politicaOrden(conToma(tecA), libre, false).tomar).toBe(true)
    expect(politicaOrden(conToma(vendA), libre, false).tomar).toBe(false)
    expect(politicaOrden(conToma(admin), libre, false).tomar).toBe(false)
  })

  it("a missing derivadaA means not derived", () => {
    expect(politicaOrden(vendA, { sucursalId: A, tecnicoId: null }, false)).toEqual(politicaOrden(vendA, deA(), false))
  })
})
