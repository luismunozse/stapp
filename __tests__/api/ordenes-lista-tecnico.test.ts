// @vitest-environment node
/**
 * BM-6 / OI-3 / XC-4 on the orders LIST of a TECNICO.
 *
 * - Assigned to him: always listed, whatever branch handles the order (jed-electronics:
 *   a San Justo technician keeps his 7 Tablada orders).
 * - Unassigned: only with the opt-in `tecnicos_toman_ordenes`, and only from his branch.
 * - No branch: only what is assigned to him.
 * - Everyone else (VENDEDOR, ADMIN, one-branch orgs): same rows as before.
 *
 * The `ordenes_servicio` table is in-memory and honours every filter, including the
 * nested and(or(..),or(..)) the route builds. A route that composes the filter wrongly
 * returns the wrong rows instead of a false green.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { cookies } from "next/headers"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, parseResponse } from "./helpers"
import { tablaPostgrest } from "../helpers/postgrest-memoria"
import { GET } from "@/app/api/ordenes/route"

vi.mock("@/lib/notifications/queue", () => ({ queueNotification: vi.fn().mockResolvedValue(undefined) }))

const T = "suc-T" // Tablada
const SJ = "suc-SJ" // San Justo

let n = 0
function orden(id: string, sucursal: string, tecnico: string | null, extra: Record<string, unknown> = {}) {
  n++
  return {
    id,
    organization_id: "org-1",
    sucursal_id: sucursal,
    tecnico_id: tecnico,
    estado: "EN_REPARACION",
    numero_orden: n,
    codigo_orden: `CEL-${String(n).padStart(3, "0")}`,
    dispositivo: "Galaxy S21",
    marca: "Samsung",
    imei: null,
    fecha_ingreso: `2026-10-${String(10 + n).padStart(2, "0")}T10:00:00Z`,
    presupuesto: 1000,
    sena: 500,
    clientes: null,
    users: null,
    ...extra,
  }
}

function ordenes() {
  return [
    ...[1, 2, 3, 4, 5, 6, 7].map((i) => orden(`asig-T-${i}`, T, "tec-sj")),
    orden("libre-T", T, null),
    orden("libre-SJ", SJ, null),
    orden("de-otro-SJ", SJ, "tec-sj-2"),
    orden("de-otro-T", T, "tec-t"),
  ]
}

const ASIGNADAS = [1, 2, 3, 4, 5, 6, 7].map((i) => `asig-T-${i}`)

function mockCookie(valor: string | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn((name: string) => (name === "stapp-sucursal-activa" && valor ? { value: valor } : undefined)),
    set: vi.fn(),
  } as any)
}

function montar(opts: { toma: boolean; filas?: ReturnType<typeof ordenes>; clientes?: Array<Record<string, unknown>> }) {
  const tabla = tablaPostgrest(opts.filas ?? ordenes())
  mockSupabaseFrom({
    ordenes_servicio: tabla,
    organizations: createChainMock({ tecnicos_toman_ordenes: opts.toma }),
    clientes: tablaPostgrest(opts.clientes ?? []),
  } as any)
  return tabla
}

async function listar(query = "") {
  const res = await GET(new Request(`http://localhost:3000/api/ordenes${query}`))
  const { status, body } = await parseResponse(res)
  return { status, ids: (body.data ?? []).map((o: any) => o.id).sort(), body }
}

describe("GET /api/ordenes - TECNICO list", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    n = 0
    mockCookie(null)
  })

  it("permission off: his 7 orders from the other branch, nothing unassigned, nobody else's", async () => {
    mockAuthSuccess({ role: "TECNICO", userId: "tec-sj", sucursalId: SJ })
    montar({ toma: false })

    const { ids, body } = await listar()

    expect(ids).toEqual([...ASIGNADAS].sort())
    expect(body.total).toBe(7)
  })

  it("permission on: also the unassigned orders of HIS branch, never the other branch's", async () => {
    mockAuthSuccess({ role: "TECNICO", userId: "tec-sj", sucursalId: SJ })
    montar({ toma: true })

    const { ids, body } = await listar()

    expect(ids).toEqual([...ASIGNADAS, "libre-SJ"].sort())
    expect(ids).not.toContain("libre-T")
    const puedeTomar = Object.fromEntries(body.data.map((o: any) => [o.id, o.puedeTomar]))
    expect(puedeTomar["libre-SJ"]).toBe(true)
    expect(puedeTomar["asig-T-1"]).toBe(false)
  })

  it("permission on, a technician of the OTHER branch: the mirror image", async () => {
    mockAuthSuccess({ role: "TECNICO", userId: "tec-t", sucursalId: T })
    montar({ toma: true })

    const { ids } = await listar()

    expect(ids).toEqual(["de-otro-T", "libre-T"])
  })

  it("no branch (XC-4): only what is assigned to him, even with the permission on", async () => {
    mockAuthSuccess({ role: "TECNICO", userId: "tec-sj", sucursalId: null })
    montar({ toma: true })

    const { ids, body } = await listar()

    expect(ids).toEqual([...ASIGNADAS].sort())
    expect(body.data.every((o: any) => o.puedeTomar !== true)).toBe(true)
  })

  it("a switcher cookie of another branch changes nothing for him", async () => {
    mockCookie(T)
    mockAuthSuccess({ role: "TECNICO", userId: "tec-sj", sucursalId: SJ })
    montar({ toma: true })

    expect((await listar()).ids).toEqual([...ASIGNADAS, "libre-SJ"].sort())
  })

  describe("with a search (open item 7: ONE combined filter, not repeated or params)", () => {
    it("the search narrows what he may see and never adds to it", async () => {
      mockAuthSuccess({ role: "TECNICO", userId: "tec-sj", sucursalId: SJ })
      const tabla = montar({
        toma: true,
        filas: [
          ...ordenes().map((o) => ({ ...o, dispositivo: "Galaxy S21" })),
          orden("libre-SJ-iphone", SJ, null, { dispositivo: "iPhone 14" }),
          orden("libre-T-iphone", T, null, { dispositivo: "iPhone 14" }),
          orden("de-otro-SJ-iphone", SJ, "tec-sj-2", { dispositivo: "iPhone 14" }),
        ],
      })

      const { ids } = await listar("?search=iPhone")

      expect(ids).toEqual(["libre-SJ-iphone"])
      expect(tabla.consultas).toHaveLength(1)
      expect(tabla.consultas[0].or).toHaveLength(1)
    })

    it("a term that tries to close the expression and add a clause cannot widen the list", async () => {
      mockAuthSuccess({ role: "TECNICO", userId: "tec-sj", sucursalId: SJ })
      montar({ toma: true })

      const hostil = encodeURIComponent("x)),sucursal_id.neq.zz,and(a")
      const { status, ids } = await listar(`?search=${hostil}`)

      expect(status).toBe(200)
      expect(ids).toEqual([])
    })

    it("a term that does match is still found when it has the characters of the filter syntax", async () => {
      mockAuthSuccess({ role: "TECNICO", userId: "tec-sj", sucursalId: SJ })
      montar({
        toma: true,
        filas: [orden("mia", T, "tec-sj", { dispositivo: "Equipo (negro), 128" }), orden("ajena", T, "tec-t", { dispositivo: "Equipo (negro), 128" })],
      })

      expect((await listar(`?search=${encodeURIComponent("(negro), 128")}`)).ids).toEqual(["mia"])
    })
  })

  it("a search that matches a client works inside the combined filter (the cliente_id.in list)", async () => {
    mockAuthSuccess({ role: "TECNICO", userId: "tec-sj", sucursalId: SJ })
    montar({
      toma: true,
      clientes: [
        { id: "cli-1", organization_id: "org-1", nombre: "Marta Lopez", telefono: "1155" },
        { id: "cli-2", organization_id: "org-1", nombre: "Pedro Diaz", telefono: "1166" },
      ],
      filas: [
        orden("mia-marta", T, "tec-sj", { cliente_id: "cli-1" }),
        orden("libre-SJ-marta", SJ, null, { cliente_id: "cli-1" }),
        orden("libre-T-marta", T, null, { cliente_id: "cli-1" }),
        orden("ajena-marta", SJ, "tec-sj-2", { cliente_id: "cli-1" }),
        orden("mia-pedro", T, "tec-sj", { cliente_id: "cli-2" }),
      ],
    })

    expect((await listar("?search=Marta")).ids).toEqual(["libre-SJ-marta", "mia-marta"])
  })

  it("the other or-filters of the list (sin seña) share the same single combined filter", async () => {
    mockAuthSuccess({ role: "TECNICO", userId: "tec-sj", sucursalId: SJ })
    const tabla = montar({
      toma: true,
      filas: [
        orden("mia-con-sena", T, "tec-sj", { sena: 500 }),
        orden("mia-sin-sena", T, "tec-sj", { sena: 0 }),
        orden("libre-SJ-sin-sena", SJ, null, { sena: null }),
        orden("libre-T-sin-sena", T, null, { sena: 0 }),
      ],
    })

    const { ids } = await listar("?conSena=no")

    expect(ids).toEqual(["libre-SJ-sin-sena", "mia-sin-sena"])
    expect(tabla.consultas[0].or).toHaveLength(1)
  })
})

describe("GET /api/ordenes - everyone else is unchanged", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    n = 0
    mockCookie(null)
  })

  it("a VENDEDOR sees exactly his branch's orders (no assigned-to-me crossing for him)", async () => {
    mockAuthSuccess({ role: "VENDEDOR", userId: "vend-1", sucursalId: SJ })
    montar({ toma: true })

    expect((await listar()).ids).toEqual(["de-otro-SJ", "libre-SJ"])
  })

  it("an ADMIN with no branch selected sees every order of the org", async () => {
    mockAuthSuccess({ role: "ADMIN", userId: "adm" })
    montar({ toma: true })

    expect((await listar()).ids).toHaveLength(11)
  })

  it("an ADMIN with a branch selected sees that branch", async () => {
    mockCookie(SJ)
    mockAuthSuccess({ role: "ADMIN", userId: "adm" })
    montar({ toma: true })

    expect((await listar()).ids).toEqual(["de-otro-SJ", "libre-SJ"])
  })

  it.each([
    ["a comma", "Pérez, Juan"],
    ["parentheses", "(011) 4444"],
  ])("a client search with %s still finds the client (the lookup shares the sanitized term)", async (_caso, busqueda) => {
    mockAuthSuccess({ role: "ADMIN", userId: "adm" })
    montar({
      toma: false,
      clientes: [
        { id: "cli-1", organization_id: "org-1", nombre: "Pérez, Juan", telefono: "(011) 4444-5555" },
        { id: "cli-2", organization_id: "org-1", nombre: "Lopez", telefono: "1166" },
      ],
      filas: [orden("de-perez", SJ, null, { cliente_id: "cli-1" }), orden("de-lopez", SJ, null, { cliente_id: "cli-2" })],
    })

    const { status, ids } = await listar(`?search=${encodeURIComponent(busqueda)}`)

    expect(status).toBe(200)
    expect(ids).toEqual(["de-perez"])
  })

  it("a one-branch org: a technician gets exactly assigned + unassigned, as before (XC-3)", async () => {
    mockAuthSuccess({ role: "TECNICO", userId: "tec-1", sucursalId: SJ })
    montar({
      toma: true,
      filas: [
        orden("mia-1", SJ, "tec-1"),
        orden("mia-2", SJ, "tec-1"),
        orden("libre", SJ, null),
        orden("ajena", SJ, "tec-2"),
      ],
    })

    expect((await listar()).ids).toEqual(["libre", "mia-1", "mia-2"])
  })

  it("a one-branch org with the permission off: only his own", async () => {
    mockAuthSuccess({ role: "TECNICO", userId: "tec-1", sucursalId: SJ })
    montar({
      toma: false,
      filas: [orden("mia-1", SJ, "tec-1"), orden("libre", SJ, null), orden("ajena", SJ, "tec-2")],
    })

    expect((await listar()).ids).toEqual(["mia-1"])
  })
})
