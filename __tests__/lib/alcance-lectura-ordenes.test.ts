// @vitest-environment node
/**
 * The door for LISTS of orders (change sucursales-aislamiento, PR5; OI-1, SC-3, SC-6, BM-6, OI-3, XC-4):
 * one place says which orders an actor reads, so the list, the export and the rest of the read
 * surfaces cannot disagree. The tables are in-memory and honor every filter.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { cookies } from "next/headers"
import { supabaseAdmin } from "@/lib/supabase"
import { SUCURSAL_COOKIE } from "@/lib/sucursal"
import { alcanceLecturaOrdenes } from "@/lib/ordenes/alcance-lectura"
import { montarSupabaseEnMemoria } from "../helpers/supabase-memoria"

const A = "suc-A"
const B = "suc-B"

const orden = (id: string, sucursal: string, tecnico: string | null, estado = "RECIBIDO") => ({
  id,
  organization_id: "org-1",
  sucursal_id: sucursal,
  tecnico_id: tecnico,
  estado,
})

const FILAS = [
  orden("a-libre", A, null),
  orden("a-de-ta", A, "t-a"),
  orden("a-de-tb", A, "t-b"),
  orden("b-libre", B, null),
  orden("b-de-ta", B, "t-a"), // a technician of A holds an order of B (jed-electronics)
  orden("b-de-tb", B, "t-b", "EN_REPARACION"),
]

function montar(toma: boolean) {
  montarSupabaseEnMemoria({
    ordenes_servicio: FILAS,
    organizations: [{ id: "org-1", tecnicos_toman_ordenes: toma }],
  })
}

function conCookie(valor: string | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: (nombre: string) => (nombre === SUCURSAL_COOKIE && valor ? { value: valor } : undefined),
    set: vi.fn(),
  } as any)
}

const actor = (role: string, userId: string, sucursalId: string | null) => ({ organizationId: "org-1", userId, role, sucursalId })

/** The ids a query narrowed by the door returns. */
async function ids(a: ReturnType<typeof actor>, otrosOr: string[] = []) {
  const alcance = await alcanceLecturaOrdenes(a)
  const { data, error } = await alcance.aplicar(supabaseAdmin.from("ordenes_servicio").select("id"), otrosOr)
  expect(error).toBeNull()
  return (data as Array<{ id: string }>).map((o) => o.id).sort()
}

beforeEach(() => {
  conCookie(null)
  montar(false)
})

describe("an ADMIN (SC-3, SC-6)", () => {
  it("on Todas reads every order", async () => {
    expect(await ids(actor("ADMIN", "u-admin", null))).toEqual(FILAS.map((o) => o.id).sort())
  })

  it("with a branch selected reads what that branch's staff reads", async () => {
    conCookie(B)
    const admin = await ids(actor("ADMIN", "u-admin", null))
    expect(admin).toEqual(["b-de-ta", "b-de-tb", "b-libre"])
    expect(admin).toEqual(await ids(actor("VENDEDOR", "v-b", B)))
  })

  it("with a cookie that cannot be spliced into a filter reads nothing, not everything", async () => {
    conCookie("suc-A,sucursal_id.neq.zzz")
    expect(await ids(actor("ADMIN", "u-admin", null))).toEqual([])
  })
})

describe("a VENDEDOR (the branch, whatever the cookie says)", () => {
  it("reads the orders of his branch, assigned or not", async () => {
    expect(await ids(actor("VENDEDOR", "v-a", A))).toEqual(["a-de-ta", "a-de-tb", "a-libre"])
  })

  it("ignores the stored choice of a branch", async () => {
    conCookie(B)
    expect(await ids(actor("VENDEDOR", "v-a", A))).toEqual(["a-de-ta", "a-de-tb", "a-libre"])
  })

  it("without a branch reads nothing (XC-4)", async () => {
    expect(await ids(actor("VENDEDOR", "v-x", null))).toEqual([])
  })

  it("with a branch id that cannot be spliced reads nothing", async () => {
    expect(await ids(actor("VENDEDOR", "v-x", `${A},sucursal_id.neq.zzz`))).toEqual([])
  })
})

describe("a TECNICO (BM-6, OI-3, XC-4)", () => {
  it("opt-in off: what is assigned to him, from any branch, and nothing else", async () => {
    expect(await ids(actor("TECNICO", "t-a", A))).toEqual(["a-de-ta", "b-de-ta"])
  })

  it("opt-in on: also the unassigned orders of his own branch, never another branch's", async () => {
    montar(true)
    expect(await ids(actor("TECNICO", "t-a", A))).toEqual(["a-de-ta", "a-libre", "b-de-ta"])
    expect(await ids(actor("TECNICO", "t-b", B))).toEqual(["a-de-tb", "b-de-tb", "b-libre"])
  })

  it("without a branch: only what is assigned to him, even with the opt-in on", async () => {
    montar(true)
    expect(await ids(actor("TECNICO", "t-a", null))).toEqual(["a-de-ta", "b-de-ta"])
  })

  it("ignores the stored choice of a branch", async () => {
    conCookie(B)
    expect(await ids(actor("TECNICO", "t-a", A))).toEqual(["a-de-ta", "b-de-ta"])
  })

  it("says whether he may claim the unassigned ones, for the list to mark", async () => {
    expect((await alcanceLecturaOrdenes(actor("TECNICO", "t-a", A))).puedeTomarSinAsignar).toBe(false)
    montar(true)
    expect((await alcanceLecturaOrdenes(actor("TECNICO", "t-a", A))).puedeTomarSinAsignar).toBe(true)
    expect((await alcanceLecturaOrdenes(actor("TECNICO", "t-a", null))).puedeTomarSinAsignar).toBe(false)
    expect((await alcanceLecturaOrdenes(actor("VENDEDOR", "v-a", A))).puedeTomarSinAsignar).toBe(false)
  })

  it("reads the opt-in only for a TECNICO", async () => {
    const { lecturas } = montarSupabaseEnMemoria({ ordenes_servicio: FILAS, organizations: [{ id: "org-1", tecnicos_toman_ordenes: true }] })
    await alcanceLecturaOrdenes(actor("VENDEDOR", "v-a", A))
    await alcanceLecturaOrdenes(actor("ADMIN", "u-admin", null))
    expect(lecturas).not.toContain("organizations")
    await alcanceLecturaOrdenes(actor("TECNICO", "t-a", A))
    expect(lecturas).toContain("organizations")
  })
})

describe("other OR lists of the caller are ANDed with the scope in ONE expression", () => {
  it("a branch scope plus a search list", async () => {
    expect(await ids(actor("VENDEDOR", "v-a", A), ["estado.eq.EN_REPARACION,estado.eq.APROBADO"])).toEqual([])
    expect(await ids(actor("VENDEDOR", "v-b", B), ["estado.eq.EN_REPARACION,estado.eq.APROBADO"])).toEqual(["b-de-tb"])
  })

  it("the search cannot widen the scope: a list that matches every order still stays in the branch", async () => {
    expect(await ids(actor("VENDEDOR", "v-a", A), ["estado.eq.RECIBIDO,estado.eq.EN_REPARACION"])).toEqual(["a-de-ta", "a-de-tb", "a-libre"])
  })

  it("a technician's scope plus a search list", async () => {
    montar(true)
    expect(await ids(actor("TECNICO", "t-a", A), ["tecnico_id.is.null,estado.eq.EN_REPARACION"])).toEqual(["a-libre"])
  })

  it("Todas with a search list is just the list", async () => {
    expect(await ids(actor("ADMIN", "u-admin", null), ["estado.eq.EN_REPARACION"])).toEqual(["b-de-tb"])
  })

  it("a technician without the opt-in keeps the assigned-to-me filter next to the list", async () => {
    expect(await ids(actor("TECNICO", "t-b", B), ["estado.eq.EN_REPARACION"])).toEqual(["b-de-tb"])
  })
})
