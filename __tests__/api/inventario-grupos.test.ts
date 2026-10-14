import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { mockAuthSuccess, mockAuthError, parseResponse } from "./helpers"

import { GET, DELETE } from "@/app/api/inventario/grupos/[id]/route"

// GET + DELETE of /api/inventario/grupos/[id] (PUT arrives with the save RPC).
// The store holds a SECOND organization (a group, its child, and a child row that
// points at org-1's group from org-2) so a query that forgets its organization filter
// returns data and the test goes red instead of passing on an empty store (G2).

type Fila = Record<string, any>

const hijo = (id: string, org: string, grupo: string, valor: string, extra: Fila = {}): Fila => ({
  id,
  organization_id: org,
  grupo_id: grupo,
  atributos: [{ opcion: "Color", valor }],
  nombre: `Funda - ${valor}`,
  codigo: `FX-${valor}`,
  stock: 5,
  stock_reservado: 0,
  precio_compra: 300,
  precio_venta: 900,
  created_at: "2026-01-01T00:00:00Z",
  deleted_at: null,
  ...extra,
})

function datos() {
  return {
    organizations: [
      { id: "org-1", vendedores_administran_inventario: false },
      { id: "org-2", vendedores_administran_inventario: false },
    ] as Fila[],
    inventario_grupos: [
      { id: "g-1", organization_id: "org-1", nombre: "Funda X", opciones: [{ nombre: "Color", valores: ["Rojo", "Azul", "Verde"] }] },
      { id: "g-2", organization_id: "org-2", nombre: "Funda Y", opciones: [{ nombre: "Color", valores: ["Negro"] }] },
      { id: "g-vacio", organization_id: "org-1", nombre: "Sin hijos", opciones: [{ nombre: "Color", valores: ["Rojo"] }] },
      { id: "g-empate", organization_id: "org-1", nombre: "Empate", opciones: [{ nombre: "Color", valores: ["Rojo", "Azul"] }] },
    ] as Fila[],
    inventario: [
      // Azul comes first in the array but was created after Rojo: the route must order.
      hijo("a1", "org-1", "g-1", "Azul", { created_at: "2026-01-02T00:00:00Z" }),
      hijo("r1", "org-1", "g-1", "Rojo"),
      hijo("v1", "org-1", "g-1", "Verde", { stock: 4, deleted_at: "2026-02-01T00:00:00Z" }),
      hijo("n1", "org-2", "g-2", "Negro"),
      // Same created_at (children of one save share the transaction's NOW()): z9 comes
      // first in the array, so only the id tiebreak puts m5 first.
      hijo("z9", "org-1", "g-empate", "Azul"),
      hijo("m5", "org-1", "g-empate", "Rojo"),
      // Impossible in the database (composite FK), but a children query without its
      // organization filter would leak it.
      hijo("leak", "org-2", "g-1", "Rojo"),
      { ...hijo("s1", "org-1", "g-1", "x"), grupo_id: null, atributos: null, nombre: "Suelto" },
    ] as Fila[],
  }
}

interface Consulta {
  tabla: string
  op: "select" | "delete"
  filtros: [string, unknown][]
}

const MISSING = {
  tabla: { code: "42P01", message: 'relation "public.inventario_grupos" does not exist' },
  cache: { code: "PGRST205", message: "Could not find the table 'public.inventario_grupos' in the schema cache" },
  columna: { code: "42703", message: "column inventario.atributos does not exist" },
}

function instalarBase(falla: Record<string, { code: string; message: string }> = {}) {
  const tablas = datos()
  const consultas: Consulta[] = []

  vi.mocked(supabaseAdmin.from).mockImplementation(((tabla: string) => {
    const c: Consulta = { tabla, op: "select", filtros: [] }
    let columnas = "*"
    let conSelect = false
    const orden: string[] = []
    const ejecutar = (unica: "single" | "maybe" | null) => {
      consultas.push(c)
      if (falla[tabla]) return { data: null, error: falla[tabla] }
      const todas = (tablas as Record<string, Fila[]>)[tabla]
      const filas = todas
        .filter((f) => c.filtros.every(([col, val]) => (f[col] ?? null) === val))
        .sort((x, y) => orden.map((o) => String(x[o]).localeCompare(String(y[o]))).find((n) => n !== 0) ?? 0)
      if (c.op === "delete") (tablas as Record<string, Fila[]>)[tabla] = todas.filter((f) => !filas.includes(f))
      // supabase-js returns no rows for a DELETE unless .select() was chained after it.
      if (c.op === "delete" && !conSelect) return { data: null, error: null }
      const pedidas = columnas.split(",").map((s) => s.trim())
      const proyectar = (f: Fila) =>
        columnas.startsWith("*") ? { ...f } : Object.fromEntries(pedidas.filter((k) => k in f).map((k) => [k, f[k]]))
      if (unica === "single" && filas.length !== 1) return { data: null, error: { code: "PGRST116", message: "no rows" } }
      return unica ? { data: filas[0] ? proyectar(filas[0]) : null, error: null } : { data: filas.map(proyectar), error: null }
    }
    const api: any = {
      select: (cols: string) => ((columnas = cols), (conSelect = true), api),
      delete: () => ((c.op = "delete"), api),
      eq: (col: string, val: unknown) => (c.filtros.push([col, val]), api),
      order: (col: string) => (orden.push(col), api),
      maybeSingle: async () => ejecutar("maybe"),
      single: async () => ejecutar("single"),
      then: (resolve: any, reject?: any) => Promise.resolve(ejecutar(null)).then(resolve, reject),
    }
    return api
  }) as any)

  return { tablas, consultas }
}

const params = (id: string) => ({ params: Promise.resolve({ id }) })
const url = (id: string) => `http://localhost:3000/api/inventario/grupos/${id}`
const get = (id: string) => GET(new Request(url(id)), params(id))
const del = (id: string) => DELETE(new Request(url(id), { method: "DELETE" }), params(id))

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("GET /api/inventario/grupos/[id]", () => {
  it("answers 401 without a session and touches no table", async () => {
    mockAuthError()
    const { consultas } = instalarBase()
    expect((await get("g-1")).status).toBe(401)
    expect(consultas).toEqual([])
  })

  it("returns the group, its active variants oldest first and the archived ones", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    instalarBase()

    const { status, body } = await parseResponse(await get("g-1"))

    expect(status).toBe(200)
    expect(body.grupo).toEqual({
      id: "g-1",
      nombre: "Funda X",
      opciones: [{ nombre: "Color", valores: ["Rojo", "Azul", "Verde"] }],
    })
    expect(body.variantes.map((v: Fila) => v.id)).toEqual(["r1", "a1"])
    expect(body.variantes[1]).toMatchObject({
      id: "a1",
      grupoId: "g-1",
      atributos: [{ opcion: "Color", valor: "Azul" }],
      etiqueta: "Azul",
      precioCompra: 300,
      precioVenta: 900,
    })
    expect(body.archivadas).toEqual([{ id: "v1", atributos: [{ opcion: "Color", valor: "Verde" }], stock: 4 }])
  })

  it("ties on created_at (one save) are ordered by id", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    instalarBase()

    const { body } = await parseResponse(await get("g-empate"))

    expect(body.variantes.map((v: Fila) => v.id)).toEqual(["m5", "z9"])
  })

  it("never returns another organization's rows or a standalone product", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    instalarBase()

    const { body } = await parseResponse(await get("g-1"))

    const ids = [...body.variantes.map((v: Fila) => v.id), ...body.archivadas.map((v: Fila) => v.id)]
    expect(ids.sort()).toEqual(["a1", "r1", "v1"])
  })

  it("scopes both queries by organization and by group", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const { consultas } = instalarBase()

    await get("g-1")

    expect(consultas.map((c) => [c.tabla, c.op, c.filtros])).toEqual([
      ["inventario_grupos", "select", [["id", "g-1"], ["organization_id", "org-1"]]],
      ["inventario", "select", [["grupo_id", "g-1"], ["organization_id", "org-1"]]],
    ])
  })

  it("a group of another organization is a 404 identical to a missing one", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const { consultas } = instalarBase()

    const ajeno = await parseResponse(await get("g-2"))
    const inexistente = await parseResponse(await get("g-404"))

    expect(ajeno.status).toBe(404)
    expect(ajeno).toEqual(inexistente)
    expect(consultas.filter((c) => c.tabla === "inventario")).toEqual([])
  })

  it("a group without children answers empty lists", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    instalarBase()

    const { status, body } = await parseResponse(await get("g-vacio"))

    expect(status).toBe(200)
    expect(body).toMatchObject({ grupo: { id: "g-vacio" }, variantes: [], archivadas: [] })
  })

  describe("cost visibility follows hasInventarioAccess", () => {
    it.each([
      ["ADMIN", false, true],
      ["TECNICO", false, false],
      ["VENDEDOR", false, false],
      ["VENDEDOR", true, true],
    ])("%s (org opted in: %s) sees the cost: %s", async (role, optIn, ve) => {
      mockAuthSuccess({ role, organizationId: "org-1" })
      const { tablas } = instalarBase()
      tablas.organizations[0].vendedores_administran_inventario = optIn

      const { status, body } = await parseResponse(await get("g-1"))

      expect(status).toBe(200)
      expect(body.variantes).toHaveLength(2)
      for (const v of body.variantes) {
        if (ve) expect(v.precioCompra).toBe(300)
        else expect(v).not.toHaveProperty("precioCompra")
      }
      if (!ve) expect(JSON.stringify(body)).not.toMatch(/precioCompra|precio_compra/)
    })
  })

  describe("while migration 355 is not applied", () => {
    it.each(Object.entries(MISSING).filter(([k]) => k !== "columna"))(
      "the group table missing (%s) is a controlled 503",
      async (_k, error) => {
        mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
        instalarBase({ inventario_grupos: error })

        const { status, body } = await parseResponse(await get("g-1"))

        expect(status).toBe(503)
        expect(body.code).toBe("MIGRACION_PENDIENTE")
      }
    )

    it("a missing column on the children is a 503 too", async () => {
      mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
      instalarBase({ inventario: MISSING.columna })

      const { status, body } = await parseResponse(await get("g-1"))

      expect(status).toBe(503)
      expect(body.code).toBe("MIGRACION_PENDIENTE")
    })

    it("any other database error stays a 500", async () => {
      mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
      instalarBase({ inventario_grupos: { code: "57014", message: "canceling statement due to statement timeout" } })

      const { status, body } = await parseResponse(await get("g-1"))

      expect(status).toBe(500)
      expect(body).not.toHaveProperty("code")
    })
  })
})

describe("DELETE /api/inventario/grupos/[id] (ungroup)", () => {
  it("answers 401 without a session and writes nothing", async () => {
    mockAuthError()
    const { consultas } = instalarBase()
    expect((await del("g-1")).status).toBe(401)
    expect(consultas).toEqual([])
  })

  it.each([
    ["TECNICO", false],
    ["VENDEDOR", false],
  ])("%s without inventory access gets 403 and writes nothing", async (role, optIn) => {
    mockAuthSuccess({ role, organizationId: "org-1" })
    const { tablas, consultas } = instalarBase()
    tablas.organizations[0].vendedores_administran_inventario = optIn

    expect((await del("g-1")).status).toBe(403)
    expect(consultas.filter((c) => c.op === "delete")).toEqual([])
    expect(tablas.inventario_grupos.map((g) => g.id)).toContain("g-1")
  })

  it("deletes only the group row, filtered by id AND organization", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const { tablas, consultas } = instalarBase()

    const { status, body } = await parseResponse(await del("g-1"))

    expect(status).toBe(200)
    expect(body).toEqual({ success: true })
    expect(consultas.filter((c) => c.op === "delete")).toEqual([
      { tabla: "inventario_grupos", op: "delete", filtros: [["id", "g-1"], ["organization_id", "org-1"]] },
    ])
    expect(tablas.inventario_grupos.map((g) => g.id)).toEqual(["g-2", "g-vacio", "g-empate"])
    // The database trigger and the foreign key clear the children: the route never touches them.
    expect(consultas.filter((c) => c.tabla === "inventario")).toEqual([])
  })

  it("a second DELETE is a 404 and changes nothing", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const { tablas } = instalarBase()
    await del("g-1")
    const despues = structuredClone(tablas)

    const { status } = await parseResponse(await del("g-1"))

    expect(status).toBe(404)
    expect(tablas).toEqual(despues)
  })

  it("a group of another organization is a 404 identical to a missing one and survives", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const { tablas } = instalarBase()

    const ajeno = await parseResponse(await del("g-2"))
    const inexistente = await parseResponse(await del("g-404"))

    expect(ajeno.status).toBe(404)
    expect(ajeno).toEqual(inexistente)
    expect(tablas.inventario_grupos.map((g) => g.id)).toEqual(["g-1", "g-2", "g-vacio", "g-empate"])
  })

  it.each(Object.values(MISSING).slice(0, 2))("the group table missing (%j) is a controlled 503", async (error) => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    instalarBase({ inventario_grupos: error })

    const { status, body } = await parseResponse(await del("g-1"))

    expect(status).toBe(503)
    expect(body.code).toBe("MIGRACION_PENDIENTE")
  })

  it("any other database error stays a 500", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    instalarBase({ inventario_grupos: { code: "23503", message: "foreign key violation" } })

    expect((await del("g-1")).status).toBe(500)
  })
})
