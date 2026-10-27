// @vitest-environment node
/**
 * BM-4 (server side): the technician and seller lists take `?sucursalId=` and answer
 * with that branch's staff only. With no param the request's effective branch applies
 * (ADMIN: the selected branch or all of them; anyone else: their own). A param outside
 * the actor's scope is ignored, never obeyed and never an error.
 *
 * The `users` and `sucursales` tables are in-memory and honour the filters and the
 * select list: a route that filters wrongly, or forgets to select `sucursal_id`, gets
 * the wrong rows instead of a false green.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { cookies } from "next/headers"
import { supabaseAdmin } from "@/lib/supabase"
import { mockAuthSuccess, mockSupabaseFrom, parseResponse } from "./helpers"
import { tablaPostgrest } from "../helpers/postgrest-memoria"
import { GET as GET_TECNICOS } from "@/app/api/tecnicos/route"
import { GET as GET_VENDEDORES } from "@/app/api/vendedores/route"

function mockCookie(valor: string | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn((name: string) => (name === "stapp-sucursal-activa" && valor ? { value: valor } : undefined)),
    set: vi.fn(),
  } as any)
}

function usuario(id: string, nombre: string, rol: string, sucursal: string | null, org = "org-1") {
  return {
    id,
    nombre,
    email: `${id}@x.com`,
    telefono: null,
    activo: true,
    rol,
    organization_id: org,
    sucursal_id: sucursal,
    porcentaje_comision: 0,
    especialidades: [],
    avatar_url: null,
    fecha_ingreso_tecnico: null,
    created_at: "2026-01-01",
  }
}

const SUCURSALES = [
  { id: "suc-A", nombre: "Cerro", organization_id: "org-1", principal: true, deleted_at: null },
  { id: "suc-B", nombre: "San Justo", organization_id: "org-1", principal: false, deleted_at: null },
  { id: "suc-OTRA", nombre: "De otra org", organization_id: "org-2", principal: true, deleted_at: null },
]

function usuariosDe(prefijo: string, rol: string) {
  return [
    usuario(`${prefijo}-a1`, "Ana", rol, "suc-A"),
    usuario(`${prefijo}-a2`, "Beto", rol, "suc-A"),
    usuario(`${prefijo}-b1`, "Carla", rol, "suc-B"),
    usuario(`${prefijo}-sin`, "Dario", rol, null),
    usuario(`${prefijo}-otra`, "Eva", rol, "suc-A", "org-2"),
  ]
}

function montarDb(sucursales = SUCURSALES) {
  const users = tablaPostgrest([
    ...usuariosDe("t", "TECNICO"),
    ...usuariosDe("v", "VENDEDOR"),
    usuario("adm", "Fede", "ADMIN", null),
  ])
  mockSupabaseFrom({ users, sucursales: tablaPostgrest(sucursales) } as any)
  vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: [], error: null } as any)
  return users
}

const RUTAS = [
  {
    nombre: "tecnicos",
    prefijo: "t",
    url: "http://localhost:3000/api/tecnicos",
    GET: GET_TECNICOS,
    ids: (body: any) => body.map((t: any) => t.id),
    filas: (body: any) => body as any[],
  },
  {
    nombre: "vendedores",
    prefijo: "v",
    url: "http://localhost:3000/api/vendedores",
    GET: GET_VENDEDORES,
    ids: (body: any) => body.data.map((v: any) => v.id),
    filas: (body: any) => body.data as any[],
  },
]

describe.each(RUTAS)("GET /api/$nombre?sucursalId= (ADMIN)", ({ prefijo, url, GET, ids, filas }) => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCookie(null)
    mockAuthSuccess({ role: "ADMIN", userId: "adm" })
    montarDb()
  })

  async function pedir(query = "") {
    return parseResponse(await GET(new Request(`${url}${query}`)))
  }

  it("returns only the branch asked for", async () => {
    expect(ids((await pedir("?sucursalId=suc-A")).body)).toEqual([`${prefijo}-a1`, `${prefijo}-a2`])
    expect(ids((await pedir("?sucursalId=suc-B")).body)).toEqual([`${prefijo}-b1`])
  })

  it("no param and no branch selected: every branch of the org, each row says which one", async () => {
    const { body } = await pedir()

    expect(ids(body)).toEqual([`${prefijo}-a1`, `${prefijo}-a2`, `${prefijo}-b1`, `${prefijo}-sin`])
    expect(filas(body).map((f) => [f.id, f.sucursalId])).toEqual([
      [`${prefijo}-a1`, "suc-A"],
      [`${prefijo}-a2`, "suc-A"],
      [`${prefijo}-b1`, "suc-B"],
      [`${prefijo}-sin`, null],
    ])
  })

  it("no param with a branch selected in the switcher: that branch", async () => {
    mockCookie("suc-B")

    expect(ids((await pedir()).body)).toEqual([`${prefijo}-b1`])
  })

  it("the param wins over the switcher", async () => {
    mockCookie("suc-B")

    expect(ids((await pedir("?sucursalId=suc-A")).body)).toEqual([`${prefijo}-a1`, `${prefijo}-a2`])
  })

  it.each([
    ["a branch that does not exist", "suc-NO-EXISTE"],
    ["a branch of ANOTHER organization", "suc-OTRA"],
    ["something that would add a filter clause", "suc-A,rol.neq.TECNICO"],
    ["an empty value", ""],
  ])("ignores %s and falls back to the effective branch", async (_caso, valor) => {
    const todas = await pedir(`?sucursalId=${encodeURIComponent(valor)}`)
    expect(todas.status).toBe(200)
    expect(ids(todas.body)).toEqual([`${prefijo}-a1`, `${prefijo}-a2`, `${prefijo}-b1`, `${prefijo}-sin`])

    mockCookie("suc-B")
    expect(ids((await pedir(`?sucursalId=${encodeURIComponent(valor)}`)).body)).toEqual([`${prefijo}-b1`])
  })

  it("never lists another organization's staff, whatever the branch", async () => {
    for (const q of ["", "?sucursalId=suc-A", "?sucursalId=suc-OTRA"]) {
      expect(ids((await pedir(q)).body)).not.toContain(`${prefijo}-otra`)
    }
  })
})

describe("GET /api/tecnicos?sucursalId= (not ADMIN)", () => {
  const url = "http://localhost:3000/api/tecnicos"

  beforeEach(() => {
    vi.clearAllMocks()
    mockCookie(null)
    montarDb()
  })

  it.each([
    ["VENDEDOR of A, no param", "VENDEDOR", "suc-A", "", ["t-a1", "t-a2"]],
    ["VENDEDOR of A asking for B: the param is ignored", "VENDEDOR", "suc-A", "?sucursalId=suc-B", ["t-a1", "t-a2"]],
    ["TECNICO of B asking for A: the param is ignored", "TECNICO", "suc-B", "?sucursalId=suc-A", ["t-b1"]],
    ["TECNICO of B, no param", "TECNICO", "suc-B", "", ["t-b1"]],
  ])("%s", async (_caso, role, sucursalId, query, esperados) => {
    mockAuthSuccess({ role, userId: "u-9", sucursalId })

    const { status, body } = await parseResponse(await GET_TECNICOS(new Request(`${url}${query}`)))

    expect(status).toBe(200)
    expect(body.map((t: any) => t.id)).toEqual(esperados)
  })

  it("a switcher cookie of another branch does nothing for them", async () => {
    mockCookie("suc-B")
    mockAuthSuccess({ role: "VENDEDOR", userId: "u-9", sucursalId: "suc-A" })

    const { body } = await parseResponse(await GET_TECNICOS(new Request(url)))

    expect(body.map((t: any) => t.id)).toEqual(["t-a1", "t-a2"])
  })

  it("a user with no branch gets an empty picker (XC-4), even asking for a branch", async () => {
    mockAuthSuccess({ role: "VENDEDOR", userId: "u-9", sucursalId: null })

    const { body } = await parseResponse(await GET_TECNICOS(new Request(`${url}?sucursalId=suc-A`)))

    expect(body).toEqual([])
  })
})

// What the order form offers when it CREATES an order: the technicians of the branch POST
// /api/ordenes will validate against (sucursalParaEscritura), not the read scope. On Todas an
// ADMIN creates in the principal branch, so the list shows the principal's technicians.
describe("GET /api/tecnicos?alcance=escritura", () => {
  const url = "http://localhost:3000/api/tecnicos"

  beforeEach(() => {
    vi.clearAllMocks()
    mockCookie(null)
    montarDb()
  })

  const ids = async (query: string) =>
    (await parseResponse(await GET_TECNICOS(new Request(`${url}${query}`)))).body.map((t: any) => t.id)

  it("an ADMIN on Todas gets the principal branch's technicians, where the plain list gives every branch", async () => {
    mockAuthSuccess({ role: "ADMIN", userId: "adm" })

    expect(await ids("?alcance=escritura")).toEqual(["t-a1", "t-a2"])
    expect(await ids("")).toEqual(["t-a1", "t-a2", "t-b1", "t-sin"])
  })

  it("an ADMIN with a branch selected gets that branch", async () => {
    mockAuthSuccess({ role: "ADMIN", userId: "adm" })
    mockCookie("suc-B")

    expect(await ids("?alcance=escritura")).toEqual(["t-b1"])
  })

  it("an explicit branch wins over both the switcher and the principal", async () => {
    mockAuthSuccess({ role: "ADMIN", userId: "adm" })

    expect(await ids("?alcance=escritura&sucursalId=suc-B")).toEqual(["t-b1"])
    mockCookie("suc-A")
    expect(await ids("?alcance=escritura&sucursalId=suc-B")).toEqual(["t-b1"])
  })

  it("an explicit branch that is not in the org is ignored: the write scope applies", async () => {
    mockAuthSuccess({ role: "ADMIN", userId: "adm" })

    expect(await ids("?alcance=escritura&sucursalId=suc-OTRA")).toEqual(["t-a1", "t-a2"])
  })

  it.each([
    ["a VENDEDOR of B gets B, not the principal", "VENDEDOR", "suc-B", ["t-b1"]],
    ["a TECNICO of A gets A", "TECNICO", "suc-A", ["t-a1", "t-a2"]],
    ["a user with no branch still gets nothing", "VENDEDOR", null, []],
  ])("%s", async (_caso, role, sucursalId, esperados) => {
    mockAuthSuccess({ role, userId: "u-9", sucursalId })

    expect(await ids("?alcance=escritura")).toEqual(esperados)
  })

  it("any other value is the plain read scope", async () => {
    mockAuthSuccess({ role: "ADMIN", userId: "adm" })

    expect(await ids("?alcance=todas")).toEqual(["t-a1", "t-a2", "t-b1", "t-sin"])
  })

  // POST /api/ordenes cannot resolve a write branch in these states and rejects everyone; the
  // list must not answer "every branch" (null) where the server accepts nobody. Fail closed.
  describe("when the write scope cannot be resolved", () => {
    const SIN_PRINCIPAL = SUCURSALES.map((s) => ({ ...s, principal: false }))
    const DOS_PRINCIPALES = SUCURSALES.map((s) => (s.organization_id === "org-1" ? { ...s, principal: true } : s))

    it.each([
      ["the org has no principal branch", SIN_PRINCIPAL],
      ["two branches are flagged principal (the lookup is a .single())", DOS_PRINCIPALES],
    ])("%s: an ADMIN on Todas gets nobody, not every branch", async (_caso, sucursales) => {
      montarDb(sucursales)
      mockAuthSuccess({ role: "ADMIN", userId: "adm" })

      expect(await ids("?alcance=escritura")).toEqual([])
      // The plain read scope is not affected: it never needed the principal.
      expect(await ids("")).toEqual(["t-a1", "t-a2", "t-b1", "t-sin"])
    })

    it("an explicit valid branch or a selected one still works without a principal", async () => {
      montarDb(SIN_PRINCIPAL)
      mockAuthSuccess({ role: "ADMIN", userId: "adm" })

      expect(await ids("?alcance=escritura&sucursalId=suc-B")).toEqual(["t-b1"])
      mockCookie("suc-A")
      expect(await ids("?alcance=escritura")).toEqual(["t-a1", "t-a2"])
    })
  })
})

describe("GET /api/vendedores - still ADMIN only, branch and search compose", () => {
  const url = "http://localhost:3000/api/vendedores"

  beforeEach(() => {
    vi.clearAllMocks()
    mockCookie(null)
    montarDb()
  })

  it("a VENDEDOR is refused whatever branch it asks for", async () => {
    mockAuthSuccess({ role: "VENDEDOR", userId: "u-9", sucursalId: "suc-A" })

    const res = await GET_VENDEDORES(new Request(`${url}?sucursalId=suc-A`))

    expect(res.status).toBe(403)
  })

  it("the page total counts the branch's sellers, not the org's", async () => {
    mockAuthSuccess({ role: "ADMIN", userId: "adm" })

    const { body } = await parseResponse(await GET_VENDEDORES(new Request(`${url}?sucursalId=suc-A`)))

    expect(body.total).toBe(2)
    expect(body.data.map((v: any) => v.id)).toEqual(["v-a1", "v-a2"])
  })

  it("a search never widens the branch", async () => {
    mockAuthSuccess({ role: "ADMIN", userId: "adm" })

    const enA = await parseResponse(await GET_VENDEDORES(new Request(`${url}?sucursalId=suc-A&search=Ana`)))
    const enB = await parseResponse(await GET_VENDEDORES(new Request(`${url}?sucursalId=suc-B&search=Ana`)))

    expect(enA.body.data.map((v: any) => v.id)).toEqual(["v-a1"])
    expect(enB.body.data).toEqual([])
  })
})
