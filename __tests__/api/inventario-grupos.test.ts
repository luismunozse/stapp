import { describe, it, expect, vi, beforeEach } from "vitest"
import { revalidateTag } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase"
import { requireInventarioAccess } from "@/lib/auth-utils"
import { emitWebhookEvent } from "@/lib/webhooks/dispatcher"
import { depositoPermitido, depositoPorDefecto } from "@/lib/depositos"
import { nombreVariante } from "@/lib/variantes"
import { mockAuthSuccess, mockAuthError, parseResponse } from "./helpers"

const { auditoria, createAuditLogger } = vi.hoisted(() => {
  const auditoria = { create: vi.fn(), update: vi.fn(), delete: vi.fn() }
  return { auditoria, createAuditLogger: vi.fn(() => auditoria) }
})

vi.mock("@/lib/audit", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/audit")>()),
  createAuditLogger,
}))
vi.mock("@/lib/webhooks/dispatcher", () => ({ emitWebhookEvent: vi.fn() }))
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }))
vi.mock("@/lib/depositos", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/depositos")>()),
  depositoPermitido: vi.fn(),
  depositoPorDefecto: vi.fn(),
}))
// The real guard runs by default; one test swaps it to prove the route does not lean on it for the cost gate.
vi.mock("@/lib/auth-utils", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/auth-utils")>()
  return { ...actual, requireInventarioAccess: vi.fn(actual.requireInventarioAccess) }
})

import { GET, PUT, DELETE } from "@/app/api/inventario/grupos/[id]/route"

// GET, PUT and DELETE of /api/inventario/grupos/[id].
// The store holds a SECOND organization (a group, its child, and a child row that
// points at org-1's group from org-2) so a query that forgets its organization filter
// returns data and the test goes red instead of passing on an empty store (G2).
// The save RPC is an in-memory model of guardar_grupo_variantes (see guardarGrupoFalso):
// it records its arguments and mutates the store, so a retry or a second call is real.

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
      hijo("z9", "org-1", "g-empate", "Azul", { codigo: "EM-Azul" }),
      hijo("m5", "org-1", "g-empate", "Rojo", { codigo: "EM-Rojo" }),
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

interface ErrorDb {
  code: string
  message: string
}

/** Everything the fake did, in order: reads/deletes and RPC calls (the order is what some tests assert). */
type Evento =
  | { tipo: "consulta"; tabla: string; op: string; columnas: string; filtros: [string, unknown][]; en: [string, unknown[]][] }
  | { tipo: "rpc"; nombre: string }

interface OpcionesBase {
  /** One entry per RPC call, consumed in order: an error answers that call WITHOUT touching the store (a rolled back transaction); null runs the model. */
  rpcErrores?: (ErrorDb | null)[]
  /** An error for the reads of `inventario` that happen after an RPC call. */
  lecturaTrasRpc?: ErrorDb
  /** Makes the RPC answer this data (and change nothing) instead of running the model. */
  rpcDatos?: unknown
}

const ID_NUEVO = /^c[0-9a-f]{24}$/
const cid = (n: number) => "c" + n.toString(16).padStart(24, "0")
const falloRpc = (code: string, message: string) => ({ data: null, error: { code, message, details: null, hint: null } })

/**
 * In-memory model of guardar_grupo_variantes: same contract (arguments, result lists, full-state
 * check, org scoping, error codes), simplified internals. It exists so the route is tested
 * against a store that really changes, not against canned answers.
 */
function guardarGrupoFalso(tablas: Record<string, Fila[]>, a: any) {
  const org: string = a.p_org
  const g = a.p_grupo
  const variantes: Fila[] = a.p_variantes
  const archivar: string[] = a.p_archivar
  const filas = tablas.inventario
  const grupo = tablas.inventario_grupos.find((x) => x.id === g.id)
  if (grupo && grupo.organization_id !== org) return falloRpc("P0002", `NO_ENCONTRADO: group ${g.id}`)
  if (!grupo && !ID_NUEVO.test(g.id)) return falloRpc("22023", "PAYLOAD_INVALIDO: a new group id looks like c + 24 hex characters")

  const propia = (id: string) => filas.find((f) => f.id === id && f.organization_id === org)
  const clases = variantes.map((v) => {
    const f = propia(v.id)
    if (!f) return filas.some((x) => x.id === v.id) ? "AJENA" : "N"
    return f.grupo_id == null ? "P" : f.deleted_at ? "R" : "A"
  })
  if (clases.includes("AJENA")) return falloRpc("P0002", "NO_ENCONTRADO: item")
  if (variantes.some((v, i) => clases[i] === "N" && !ID_NUEVO.test(v.id))) {
    return falloRpc("22023", "PAYLOAD_INVALIDO: a new variante needs an id like c + 24 hex characters and a codigo")
  }

  const faltan = filas
    .filter((f) => f.organization_id === org && f.grupo_id === g.id && !f.deleted_at)
    .filter((f) => !variantes.some((v) => v.id === f.id) && !archivar.includes(f.id))
    .map((f) => f.id)
    .sort()
  if (faltan.length) return falloRpc("22023", `PAYLOAD_INVALIDO:miembros_faltantes:${faltan.join(",")}`)

  const reservada = archivar.map(propia).find((f) => f && f.stock_reservado > 0)
  if (reservada) return falloRpc("P0033", `STOCK_RESERVADO:${reservada.id}:${reservada.stock_reservado}`)

  const ocupados = filas
    .filter((f) => f.organization_id === org && !f.deleted_at && !archivar.includes(f.id) && !variantes.some((v) => v.id === f.id))
    .map((f) => f.codigo)
  const choque = [...new Set(variantes.map((v) => v.codigo ?? propia(v.id)?.codigo).filter((c) => ocupados.includes(c)))].sort()
  if (choque.length) return falloRpc("P0035", `CODIGO_DUPLICADO:${choque.join(",")}`)

  // The checks passed: commit (everything above is read-only, like the real function before its writes).
  if (grupo) Object.assign(grupo, { nombre: g.nombre, opciones: g.opciones })
  else tablas.inventario_grupos.push({ id: g.id, organization_id: org, nombre: g.nombre, opciones: g.opciones })

  const res = { grupoId: g.id, creados: [] as string[], actualizados: [] as string[], promovidos: [] as string[], restaurados: [] as string[], archivados: [] as string[] }
  const aArchivar = archivar.map(propia).filter((f): f is Fila => !!f && !f.deleted_at).sort((x, y) => x.id.localeCompare(y.id))
  for (const f of aArchivar) {
    f.deleted_at = "2026-03-01T00:00:00Z"
    res.archivados.push(f.id)
  }
  const CLAVES = ["codigo", "barcode", "ubicacion", "precio_venta", "precio_compra", "stock_minimo", "stock_maximo", "punto_reorden"]
  variantes.forEach((v, i) => {
    if (clases[i] === "N") {
      filas.push({
        id: v.id, organization_id: org, grupo_id: g.id, atributos: v.atributos, nombre: nombreVariante(g.nombre, v.atributos),
        codigo: v.codigo, barcode: v.barcode ?? null, ubicacion: v.ubicacion ?? null, precio_venta: v.precio_venta ?? 0,
        precio_compra: v.precio_compra ?? 0, stock: v.stock_inicial ?? 0, stock_reservado: 0, stock_minimo: v.stock_minimo ?? null,
        stock_maximo: v.stock_maximo ?? null, punto_reorden: v.punto_reorden ?? null, created_at: "2026-02-01T00:00:00Z", deleted_at: null,
      })
      res.creados.push(v.id)
      return
    }
    const f = propia(v.id)!
    Object.assign(f, { grupo_id: g.id, atributos: v.atributos, deleted_at: null })
    for (const k of CLAVES) if (k in v) f[k] = v[k]
    if (clases[i] === "P" && g.renombrar !== false) f.nombre = nombreVariante(g.nombre, v.atributos)
    res[({ A: "actualizados", P: "promovidos", R: "restaurados" } as const)[clases[i] as "A" | "P" | "R"]].push(v.id)
  })
  for (const f of filas.filter((x) => x.organization_id === org && x.grupo_id === g.id)) Object.assign(f, a.p_compartidos)
  return { data: res, error: null }
}

function instalarBase(falla: Record<string, ErrorDb> = {}, opciones: OpcionesBase = {}) {
  const tablas = datos()
  const consultas: Consulta[] = []
  const log: Evento[] = []
  const rpcCalls: { nombre: string; args: any }[] = []
  const rpcErrores = [...(opciones.rpcErrores ?? [])]

  vi.mocked(supabaseAdmin.rpc).mockImplementation((async (nombre: string, args: any) => {
    rpcCalls.push({ nombre, args: structuredClone(args) })
    log.push({ tipo: "rpc", nombre })
    const inyectado = rpcErrores.shift()
    if (inyectado) return falloRpc(inyectado.code, inyectado.message)
    if ("rpcDatos" in opciones) return { data: opciones.rpcDatos, error: null }
    return guardarGrupoFalso(tablas as unknown as Record<string, Fila[]>, args)
  }) as any)

  vi.mocked(supabaseAdmin.from).mockImplementation(((tabla: string) => {
    const c: Consulta = { tabla, op: "select", filtros: [] }
    let columnas = "*"
    let conSelect = false
    let en: [string, unknown[]][] | undefined
    const orden: string[] = []
    const ejecutar = (unica: "single" | "maybe" | null) => {
      consultas.push(c)
      log.push({ tipo: "consulta", tabla, op: c.op, columnas, filtros: c.filtros, en: en ?? [] })
      if (falla[tabla]) return { data: null, error: falla[tabla] }
      if (opciones.lecturaTrasRpc && tabla === "inventario" && log.some((e) => e.tipo === "rpc")) {
        return { data: null, error: opciones.lecturaTrasRpc }
      }
      const todas = (tablas as Record<string, Fila[]>)[tabla]
      const filas = todas
        .filter((f) => c.filtros.every(([col, val]) => (f[col] ?? null) === val))
        .filter((f) => (en ?? []).every(([col, vals]) => vals.includes(f[col])))
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
      in: (col: string, vals: unknown[]) => ((en = [...(en ?? []), [col, vals]]), api),
      order: (col: string) => (orden.push(col), api),
      maybeSingle: async () => ejecutar("maybe"),
      single: async () => ejecutar("single"),
      then: (resolve: any, reject?: any) => Promise.resolve(ejecutar(null)).then(resolve, reject),
    }
    return api
  }) as any)

  return { tablas, consultas, log, rpcCalls }
}

const params = (id: string) => ({ params: Promise.resolve({ id }) })
const url = (id: string) => `http://localhost:3000/api/inventario/grupos/${id}`
const get = (id: string) => GET(new Request(url(id)), params(id))
const del = (id: string) => DELETE(new Request(url(id), { method: "DELETE" }), params(id))

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, "error").mockImplementation(() => {})
  auditoria.create.mockResolvedValue(undefined)
  auditoria.update.mockResolvedValue(undefined)
  auditoria.delete.mockResolvedValue(undefined)
  vi.mocked(emitWebhookEvent).mockResolvedValue(undefined)
  vi.mocked(depositoPermitido).mockResolvedValue(true)
  vi.mocked(depositoPorDefecto).mockResolvedValue(null)
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

// ---- PUT -----------------------------------------------------------------------------------

const putReq = (id: string, body: unknown) =>
  PUT(
    new Request(url(id), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    params(id)
  )

const ATR = (valor: string) => [{ opcion: "Color", valor }]
const OPCIONES_G1 = [{ nombre: "Color", valores: ["Rojo", "Azul", "Verde"] }]

/** The full state of g-1: its two ACTIVE members (the archived Verde need not be listed). */
function cuerpoG1(cambios: { rojo?: Fila; azul?: Fila; extra?: Fila } = {}) {
  return {
    grupo: { nombre: "Funda X", opciones: OPCIONES_G1 },
    variantes: [
      { id: "r1", atributos: ATR("Rojo"), codigo: "FX-Rojo", ...cambios.rojo },
      { id: "a1", atributos: ATR("Azul"), codigo: "FX-Azul", ...cambios.azul },
    ],
    ...cambios.extra,
  }
}

/** A brand new group with two new rows (client-generated ids). */
const cuerpoNuevo = (extra: Fila = {}) => ({
  grupo: { nombre: "Nueva", opciones: [{ nombre: "Color", valores: ["Rojo", "Azul"] }] },
  compartidos: { categoria: "Fundas" },
  variantes: [
    { id: cid(101), atributos: ATR("Rojo"), codigo: "NX-RO", precioVenta: 1000, precioCompra: 400, stockInicial: 5 },
    { id: cid(102), atributos: ATR("Azul"), codigo: "NX-AZ", precioVenta: 1100 },
  ],
  ...extra,
})

const eventos = () => vi.mocked(emitWebhookEvent).mock.calls.map(([, evento, payload]) => [evento, (payload as Fila).id])

describe("PUT /api/inventario/grupos/[id]: access and validation", () => {
  it("answers 401 without a session and touches nothing", async () => {
    mockAuthError()
    const { consultas, rpcCalls } = instalarBase()
    expect((await putReq("g-1", cuerpoG1())).status).toBe(401)
    expect(consultas).toEqual([])
    expect(rpcCalls).toEqual([])
  })

  it.each([
    ["TECNICO", false],
    ["VENDEDOR", false],
  ])("%s without inventory access gets 403 and nothing runs", async (role, optIn) => {
    mockAuthSuccess({ role, organizationId: "org-1" })
    const { tablas, consultas, rpcCalls } = instalarBase()
    tablas.organizations[0].vendedores_administran_inventario = optIn
    const antes = structuredClone(tablas)

    expect((await putReq("g-1", cuerpoG1({ rojo: { precioVenta: 1 } }))).status).toBe(403)
    expect(rpcCalls).toEqual([])
    expect(consultas.filter((c) => c.tabla === "inventario")).toEqual([])
    expect(tablas).toEqual(antes)
    expect(revalidateTag).not.toHaveBeenCalled()
  })

  it("a VENDEDOR whose organization opted in can save and sees the cost", async () => {
    mockAuthSuccess({ role: "VENDEDOR", organizationId: "org-1" })
    const { tablas, rpcCalls } = instalarBase()
    tablas.organizations[0].vendedores_administran_inventario = true

    const { status, body } = await parseResponse(await putReq("g-1", cuerpoG1({ rojo: { precioCompra: 350 } })))

    expect(status).toBe(200)
    expect(rpcCalls[0].args.p_variantes[0]).toHaveProperty("precio_compra", 350)
    expect(body.variantes[0].precioCompra).toBe(350)
  })

  it("a body that is not JSON is a 400 and nothing is read", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const { consultas, rpcCalls } = instalarBase()

    const { status, body } = await parseResponse(await putReq("g-1", "{not json"))

    expect(status).toBe(400)
    expect(body.code).toBe("PAYLOAD_INVALIDO")
    expect(consultas).toEqual([])
    expect(rpcCalls).toEqual([])
  })

  it.each([
    ["an image key in compartidos", () => cuerpoG1({ extra: { compartidos: { categoria: "Fundas", imagenUrl: "x.jpg" } } }), "compartidos.imagenUrl"],
    ["an image key in a row", () => cuerpoG1({ rojo: { imagenUrl: "x.jpg" } }), "variantes.0.imagenUrl"],
    ["an image key at the root", () => cuerpoG1({ extra: { imagenUrl: "x.jpg" } }), "imagenUrl"],
    ["the organization in the body", () => cuerpoG1({ extra: { organizationId: "org-2" } }), "organizationId"],
    ["a name for a row (it is derived)", () => cuerpoG1({ azul: { nombre: "Otro" } }), "variantes.1.nombre"],
    ["the same barcode on two rows", () => cuerpoG1({ rojo: { barcode: "7790001" }, azul: { barcode: "7790001" } }), "variantes.1.barcode"],
    ["a value over 100 characters", () => cuerpoG1({ azul: { atributos: ATR("a".repeat(101)) } }), "variantes.1.atributos.0.valor"],
    ["a negative price", () => cuerpoG1({ rojo: { precioVenta: -1 } }), "variantes.0.precioVenta"],
    ["a row that is saved and archived", () => cuerpoG1({ extra: { archivar: ["r1"] } }), "archivar.0"],
  ])("%s is a 400, with no read, no write and no RPC", async (_t, construir, campo) => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const { tablas, consultas, rpcCalls } = instalarBase()
    const antes = structuredClone(tablas)

    const { status, body } = await parseResponse(await putReq("g-1", construir()))

    expect(status).toBe(400)
    expect(body).toMatchObject({ code: "PAYLOAD_INVALIDO", campo })
    expect(typeof body.error).toBe("string")
    expect(rpcCalls).toEqual([])
    expect(consultas).toEqual([])
    expect(tablas).toEqual(antes)
    expect(eventos()).toEqual([])
    expect(revalidateTag).not.toHaveBeenCalled()
  })
})

describe("PUT /api/inventario/grupos/[id]: RPC arguments (G2)", () => {
  it("sends exactly these arguments, with the organization and user of the session", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1", userId: "user-7" })
    const { rpcCalls } = instalarBase()

    await putReq("g-1", cuerpoG1({ rojo: { precioVenta: 1200 }, extra: { compartidos: { categoria: "Fundas" } } }))

    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0]).toStrictEqual({
      nombre: "guardar_grupo_variantes",
      args: {
        p_org: "org-1",
        p_user: "user-7",
        p_grupo: { id: "g-1", nombre: "Funda X", opciones: OPCIONES_G1 },
        p_compartidos: { categoria: "Fundas" },
        p_variantes: [
          { id: "r1", atributos: ATR("Rojo"), codigo: "FX-Rojo", precio_venta: 1200 },
          { id: "a1", atributos: ATR("Azul"), codigo: "FX-Azul" },
        ],
        p_archivar: [],
        p_deposito_inicial: null,
      },
    })
  })

  it("keeps absent apart from null, and rounds prices", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const { rpcCalls } = instalarBase()

    await putReq("g-1", cuerpoG1({ rojo: { barcode: null, ubicacion: null, stockMinimo: null, precioVenta: 12.345 }, azul: { ubicacion: "B2" } }))

    const [rojo, azul] = rpcCalls[0].args.p_variantes
    expect(rojo).toStrictEqual({
      id: "r1", atributos: ATR("Rojo"), codigo: "FX-Rojo", barcode: null, ubicacion: null, stock_minimo: null, precio_venta: 12.35,
    })
    expect(azul).toStrictEqual({ id: "a1", atributos: ATR("Azul"), codigo: "FX-Azul", ubicacion: "B2" })
  })

  it("renombrar false travels as false; when it is not sent the key is absent", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const { rpcCalls } = instalarBase()

    await putReq("g-1", { ...cuerpoG1(), grupo: { nombre: "Funda X", opciones: OPCIONES_G1, renombrar: false } })
    await putReq("g-1", cuerpoG1())

    expect(rpcCalls[0].args.p_grupo).toStrictEqual({ id: "g-1", nombre: "Funda X", opciones: OPCIONES_G1, renombrar: false })
    expect(rpcCalls[1].args.p_grupo).toStrictEqual({ id: "g-1", nombre: "Funda X", opciones: OPCIONES_G1 })
  })

  it("passes the archive list through", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const { rpcCalls } = instalarBase()
    const cuerpo = cuerpoG1()

    await putReq("g-1", { ...cuerpo, variantes: [cuerpo.variantes[0]], archivar: ["a1"] })

    expect(rpcCalls[0].args.p_archivar).toEqual(["a1"])
    expect(rpcCalls[0].args.p_variantes.map((v: Fila) => v.id)).toEqual(["r1"])
  })

  it("the organization is the session's even when the URL names another organization's group", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const { tablas, rpcCalls } = instalarBase()
    const delOrg2 = () => [tablas.inventario_grupos, tablas.inventario].map((t) => structuredClone(t.filter((f) => f.organization_id === "org-2")))
    const antes = delOrg2()

    const { status, body } = await parseResponse(await putReq("g-2", cuerpoG1()))

    expect(rpcCalls[0].args.p_org).toBe("org-1")
    expect(rpcCalls[0].args.p_grupo.id).toBe("g-2")
    expect(status).toBe(404)
    expect(body.code).toBe("NO_ENCONTRADO")
    expect(delOrg2()).toEqual(antes)
    expect(eventos()).toEqual([])
    expect(revalidateTag).not.toHaveBeenCalled()
  })

  it("a row id that belongs to another organization is a 404 and that row is untouched", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const { tablas, log } = instalarBase()
    const ajeno = structuredClone(tablas.inventario.find((f) => f.id === "n1"))
    const cuerpo = cuerpoNuevo()
    cuerpo.variantes[1] = { ...cuerpo.variantes[1], id: "n1" }

    const { status } = await parseResponse(await putReq(cid(100), cuerpo))

    expect(status).toBe(404)
    expect(tablas.inventario.find((f) => f.id === "n1")).toEqual(ajeno)
    expect(tablas.inventario_grupos.some((g) => g.id === cid(100))).toBe(false)
    // The snapshot is org-scoped, so the other organization's row never reaches the events.
    const instantanea = log.find((e) => e.tipo === "consulta" && e.columnas === "*")
    expect(instantanea).toMatchObject({ filtros: [["organization_id", "org-1"]] })
    expect(eventos()).toEqual([])
  })
})

describe("PUT /api/inventario/grupos/[id]: initial deposit", () => {
  it("an explicit depositoId is validated for the caller and wins over the default", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1", sucursalId: "suc-1" })
    vi.mocked(depositoPorDefecto).mockResolvedValue("dep-default")
    const { rpcCalls } = instalarBase()

    await putReq(cid(100), cuerpoNuevo({ depositoId: "dep-norte" }))

    expect(depositoPermitido).toHaveBeenCalledWith({ depositoId: "dep-norte", organizationId: "org-1", role: "ADMIN", userSucursalId: "suc-1" })
    expect(depositoPorDefecto).not.toHaveBeenCalled()
    expect(rpcCalls[0].args.p_deposito_inicial).toBe("dep-norte")
  })

  it("without a depositoId the default depot of the caller is used", async () => {
    mockAuthSuccess({ role: "VENDEDOR", organizationId: "org-1", sucursalId: "suc-2" })
    vi.mocked(depositoPorDefecto).mockResolvedValue("dep-sucursal-2")
    const { tablas, rpcCalls } = instalarBase()
    tablas.organizations[0].vendedores_administran_inventario = true

    await putReq(cid(100), cuerpoNuevo())

    expect(depositoPorDefecto).toHaveBeenCalledWith({ organizationId: "org-1", role: "VENDEDOR", userSucursalId: "suc-2" })
    expect(depositoPermitido).not.toHaveBeenCalled()
    expect(rpcCalls[0].args.p_deposito_inicial).toBe("dep-sucursal-2")
  })

  it("a depot the caller may not use is a 400 and nothing runs", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    vi.mocked(depositoPermitido).mockResolvedValue(false)
    const { consultas, rpcCalls } = instalarBase()

    const { status, body } = await parseResponse(await putReq(cid(100), cuerpoNuevo({ depositoId: "dep-ajeno" })))

    expect(status).toBe(400)
    expect(body.code).toBe("DEPOSITO_INVALIDO")
    expect(rpcCalls).toEqual([])
    expect(consultas).toEqual([])
  })
})

describe("PUT /api/inventario/grupos/[id]: purchase cost", () => {
  it("a role without cost access never sends precio_compra and a sent precioCompra is dropped", async () => {
    // The guard is swapped for one that lets a TECNICO through: the route must not lean on the guard for the cost gate.
    vi.mocked(requireInventarioAccess).mockResolvedValueOnce({
      error: null,
      session: { user: { sucursalId: null } },
      organizationId: "org-1",
      userId: "user-9",
      role: "TECNICO",
    } as any)
    const { tablas, rpcCalls } = instalarBase()

    const { status, body } = await parseResponse(
      await putReq("g-1", cuerpoG1({ rojo: { precioCompra: 1, precioVenta: 1200 }, azul: { precioCompra: 2 } }))
    )

    expect(status).toBe(200)
    expect(JSON.stringify(rpcCalls[0].args)).not.toMatch(/precio_compra/)
    expect(rpcCalls[0].args.p_variantes[0]).toHaveProperty("precio_venta", 1200)
    expect(tablas.inventario.find((f) => f.id === "r1")!.precio_compra).toBe(300)
    expect(tablas.inventario.find((f) => f.id === "a1")!.precio_compra).toBe(300)
    expect(JSON.stringify(body)).not.toMatch(/precioCompra|precio_compra/)
    expect(body.variantes[0].precioVenta).toBe(1200)
  })

  it("an ADMIN sends the cost, it is stored and it comes back", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const { tablas, rpcCalls } = instalarBase()

    const { body } = await parseResponse(await putReq("g-1", cuerpoG1({ rojo: { precioCompra: 410.5 } })))

    expect(rpcCalls[0].args.p_variantes[0]).toHaveProperty("precio_compra", 410.5)
    expect(rpcCalls[0].args.p_variantes[1]).not.toHaveProperty("precio_compra")
    expect(tablas.inventario.find((f) => f.id === "r1")!.precio_compra).toBe(410.5)
    expect(body.variantes[0].precioCompra).toBe(410.5)
  })
})

describe("PUT /api/inventario/grupos/[id]: snapshot, events and response", () => {
  it("reads the before-snapshot of the payload rows, scoped by organization, BEFORE the RPC", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const { log } = instalarBase()
    const cuerpo = cuerpoG1()

    await putReq("g-1", { ...cuerpo, variantes: [cuerpo.variantes[0]], archivar: ["a1"] })

    const instantanea = log.findIndex((e) => e.tipo === "consulta" && e.tabla === "inventario" && e.columnas === "*")
    const rpc = log.findIndex((e) => e.tipo === "rpc")
    expect(instantanea).toBeGreaterThanOrEqual(0)
    expect(instantanea).toBeLessThan(rpc)
    expect(log[instantanea]).toMatchObject({ filtros: [["organization_id", "org-1"]], en: [["id", ["r1", "a1"]]] })
    // After the RPC the group is read once, exactly like GET does.
    expect(log.slice(rpc + 1).map((e) => e.tipo === "consulta" && [e.tabla, e.filtros])).toEqual([
      ["inventario_grupos", [["id", "g-1"], ["organization_id", "org-1"]]],
      ["inventario", [["grupo_id", "g-1"], ["organization_id", "org-1"]]],
    ])
  })

  it("a save with no rows at all reads no snapshot", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const { log } = instalarBase()

    const { status, body } = await parseResponse(
      await putReq("g-vacio", { grupo: { nombre: "Sin hijos", opciones: [{ nombre: "Color", valores: ["Rojo"] }] }, variantes: [] })
    )

    expect(status).toBe(200)
    expect(body).toMatchObject({ grupo: { id: "g-vacio" }, variantes: [], archivadas: [] })
    expect(log.find((e) => e.tipo === "consulta" && e.columnas === "*")).toBeUndefined()
  })

  it("creating a group of N rows emits N created events, N audit entries and one cache revalidation", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1", userId: "user-7" })
    instalarBase()

    const { status, body } = await parseResponse(await putReq(cid(100), cuerpoNuevo()))

    expect(status).toBe(200)
    expect(eventos()).toEqual([["inventario.created", cid(101)], ["inventario.created", cid(102)]])
    expect(vi.mocked(emitWebhookEvent).mock.calls[0]).toEqual([
      "org-1",
      "inventario.created",
      {
        id: cid(101), codigo: "NX-RO", nombre: "Nueva - Rojo", categoria: "Fundas", tipoDispositivo: undefined, stock: 5,
        precioVenta: 1000, precioCompra: 400, proveedorId: undefined, barcode: null,
      },
    ])
    expect(auditoria.create.mock.calls.map((c) => [c[0], c[1]])).toEqual([["inventario", cid(101)], ["inventario", cid(102)]])
    expect(createAuditLogger).toHaveBeenCalledWith("org-1", "user-7", expect.any(Request))
    expect(auditoria.update).not.toHaveBeenCalled()
    expect(revalidateTag).toHaveBeenCalledTimes(1)
    expect(revalidateTag).toHaveBeenCalledWith("catalogo", "max")
    expect(body.variantes.map((v: Fila) => v.id)).toEqual([cid(101), cid(102)])
  })

  it("sending the same payload again converges: no new rows and no new events", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const { tablas, rpcCalls } = instalarBase()

    const primera = await parseResponse(await putReq(cid(100), cuerpoNuevo()))
    const trasLaPrimera = structuredClone(tablas)
    const segunda = await parseResponse(await putReq(cid(100), cuerpoNuevo()))

    expect(rpcCalls[1].args).toStrictEqual(rpcCalls[0].args)
    expect(tablas).toEqual(trasLaPrimera)
    expect(tablas.inventario.filter((f) => f.grupo_id === cid(100))).toHaveLength(2)
    expect(segunda.body).toEqual(primera.body)
    expect(eventos()).toEqual([["inventario.created", cid(101)], ["inventario.created", cid(102)]])
    expect(auditoria.create).toHaveBeenCalledTimes(2)
    expect(auditoria.update).not.toHaveBeenCalled()
  })

  it("a price edit on one row is exactly one updated event (and one audit entry) with only the diff", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1", userId: "user-7" })
    instalarBase()

    await putReq("g-1", cuerpoG1({ rojo: { precioVenta: 1200 } }))

    expect(vi.mocked(emitWebhookEvent).mock.calls).toEqual([
      [
        "org-1",
        "inventario.updated",
        { id: "r1", codigo: "FX-Rojo", nombre: "Funda - Rojo", changes: { precio_venta: { before: 900, after: 1200 } } },
      ],
    ])
    expect(auditoria.update).toHaveBeenCalledTimes(1)
    const [entidad, id, antes, despues] = auditoria.update.mock.calls[0]
    expect([entidad, id, antes.precio_venta, despues.precio_venta]).toEqual(["inventario", "r1", 900, 1200])
    expect(auditoria.create).not.toHaveBeenCalled()
    expect(auditoria.delete).not.toHaveBeenCalled()
  })

  it("a save that changes nothing emits nothing, even though the RPC lists every row it touched", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const { rpcCalls } = instalarBase()

    const { status } = await parseResponse(await putReq("g-1", cuerpoG1()))

    expect(status).toBe(200)
    expect(rpcCalls).toHaveLength(1)
    expect(eventos()).toEqual([])
    expect(auditoria.update).not.toHaveBeenCalled()
  })

  it("archiving a row is one archived event and one DELETE audit entry marked ARCHIVADO", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1", userId: "user-7" })
    const { tablas } = instalarBase()
    const cuerpo = cuerpoG1()

    const { body } = await parseResponse(await putReq("g-1", { ...cuerpo, variantes: [cuerpo.variantes[0]], archivar: ["a1"] }))

    expect(vi.mocked(emitWebhookEvent).mock.calls).toEqual([
      ["org-1", "inventario.archived", { id: "a1", codigo: "FX-Azul", nombre: "Funda - Azul", archivedBy: "user-7" }],
    ])
    expect(auditoria.delete).toHaveBeenCalledTimes(1)
    expect(auditoria.delete.mock.calls[0][0]).toBe("inventario")
    expect(auditoria.delete.mock.calls[0][1]).toBe("a1")
    expect(auditoria.delete.mock.calls[0][2]).toMatchObject({ accion: "ARCHIVADO", codigo: "FX-Azul" })
    expect(tablas.inventario.find((f) => f.id === "a1")!.deleted_at).not.toBeNull()
    expect(body.variantes.map((v: Fila) => v.id)).toEqual(["r1"])
    expect(body.archivadas.map((v: Fila) => v.id).sort()).toEqual(["a1", "v1"])
  })

  it("a shared-field change reaches the row archived in the same save, which still gets only the archived event", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const { tablas } = instalarBase()
    const cuerpo = cuerpoG1()

    await putReq("g-1", { ...cuerpo, variantes: [cuerpo.variantes[0]], archivar: ["a1"], compartidos: { categoria: "Fundas" } })

    expect(tablas.inventario.find((f) => f.id === "a1")!.categoria).toBe("Fundas")
    expect(eventos()).toEqual([["inventario.updated", "r1"], ["inventario.archived", "a1"]])
  })

  it("promoting a standalone product emits one updated event for the rename and one created for the new row", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const { tablas } = instalarBase()

    await putReq(cid(200), {
      grupo: { nombre: "Funda Nueva", opciones: [{ nombre: "Color", valores: ["Rojo", "Azul"] }] },
      compartidos: { categoria: "Fundas" },
      variantes: [
        { id: "s1", atributos: ATR("Rojo") },
        { id: cid(201), atributos: ATR("Azul"), codigo: "N2" },
      ],
    })

    expect(tablas.inventario.find((f) => f.id === "s1")).toMatchObject({ grupo_id: cid(200), nombre: "Funda Nueva - Rojo" })
    expect(eventos()).toEqual([["inventario.created", cid(201)], ["inventario.updated", "s1"]])
    expect(vi.mocked(emitWebhookEvent).mock.calls[1][2]).toMatchObject({
      changes: { nombre: { before: "Suelto", after: "Funda Nueva - Rojo" }, categoria: { before: undefined, after: "Fundas" } },
    })
  })

  it("promoting without renaming keeps the name, so the name is not in the updated event", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const { tablas } = instalarBase()

    await putReq(cid(200), {
      grupo: { nombre: "Funda Nueva", opciones: [{ nombre: "Color", valores: ["Rojo", "Azul"] }], renombrar: false },
      variantes: [
        { id: "s1", atributos: ATR("Rojo") },
        { id: cid(201), atributos: ATR("Azul"), codigo: "N2" },
      ],
      compartidos: { categoria: "Fundas" },
    })

    expect(tablas.inventario.find((f) => f.id === "s1")!.nombre).toBe("Suelto")
    const actualizado = vi.mocked(emitWebhookEvent).mock.calls.find(([, evento]) => evento === "inventario.updated")!
    expect((actualizado[2] as Fila).id).toBe("s1")
    expect((actualizado[2] as Fila).changes).toEqual({ categoria: { before: undefined, after: "Fundas" } })
  })

  it("restoring an archived row with a new price emits one updated event", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const { tablas } = instalarBase()
    const cuerpo = cuerpoG1()

    await putReq("g-1", { ...cuerpo, variantes: [...cuerpo.variantes, { id: "v1", atributos: ATR("Verde"), codigo: "FX-Verde", precioVenta: 777 }] })

    expect(tablas.inventario.find((f) => f.id === "v1")!.deleted_at).toBeNull()
    expect(eventos()).toEqual([["inventario.updated", "v1"]])
    expect(vi.mocked(emitWebhookEvent).mock.calls[0][2]).toMatchObject({ changes: { precio_venta: { before: 900, after: 777 } } })
  })

  it("answers with the same shape and content GET gives afterwards", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    instalarBase()

    const guardado = await parseResponse(await putReq("g-1", cuerpoG1({ rojo: { precioVenta: 1200 } })))
    const leido = await parseResponse(await get("g-1"))

    expect(guardado.status).toBe(200)
    expect(Object.keys(guardado.body).sort()).toEqual(["archivadas", "grupo", "variantes"])
    expect(guardado.body).toEqual(leido.body)
    expect(guardado.body.variantes[0]).toMatchObject({ id: "r1", precioVenta: 1200, grupoId: "g-1", etiqueta: "Rojo" })
    expect(guardado.body.archivadas).toEqual([{ id: "v1", atributos: ATR("Verde"), stock: 4 }])
  })
})

describe("PUT /api/inventario/grupos/[id]: errors", () => {
  const ERRORES: [string, ErrorDb, number, string][] = [
    ["22023", { code: "22023", message: "PAYLOAD_INVALIDO: p_user is not a known user" }, 400, "PAYLOAD_INVALIDO"],
    ["P0002", { code: "P0002", message: "NO_ENCONTRADO: item cdead" }, 404, "NO_ENCONTRADO"],
    ["P0030", { code: "P0030", message: "COMBINACION_DUPLICADA" }, 409, "COMBINACION_DUPLICADA"],
    ["P0031", { code: "P0031", message: "ITEM_EN_OTRO_GRUPO: s1" }, 409, "ITEM_EN_OTRO_GRUPO"],
    ["P0032", { code: "P0032", message: "KIT_NO_PERMITIDO: s1" }, 422, "KIT_NO_PERMITIDO"],
    ["P0033", { code: "P0033", message: "STOCK_RESERVADO:a1:2" }, 409, "STOCK_RESERVADO"],
    ["P0034", { code: "P0034", message: "LIMITE_EXCEDIDO: at most 100 combinations" }, 422, "LIMITE_EXCEDIDO"],
    ["P0035", { code: "P0035", message: "CODIGO_DUPLICADO:FX-Rojo" }, 409, "CODIGO_DUPLICADO"],
    ["23505", { code: "23505", message: 'duplicate key value violates unique constraint "inventario_org_codigo_active_uniq"' }, 409, "CONFLICTO"],
    ["23514", { code: "23514", message: 'new row for relation "inventario" violates check constraint "inventario_grupo_atributos"' }, 400, "DATOS_INVALIDOS"],
    ["23503", { code: "23503", message: 'violates foreign key constraint "inventario_grupo_id_fkey"' }, 404, "NO_ENCONTRADO"],
    ["P0011", { code: "P0011", message: "La organizacion no tiene deposito principal" }, 400, "DEPOSITO_INVALIDO"],
    ["42883", { code: "42883", message: "function guardar_grupo_variantes(text, text, jsonb, jsonb, jsonb, jsonb, text) does not exist" }, 503, "MIGRACION_PENDIENTE"],
    ["PGRST202", { code: "PGRST202", message: "Could not find the function public.guardar_grupo_variantes(p_archivar, p_compartidos) in the schema cache" }, 503, "MIGRACION_PENDIENTE"],
    ["42P01", { code: "42P01", message: 'relation "inventario_grupos" does not exist' }, 503, "MIGRACION_PENDIENTE"],
    ["P0002 whose message says 'does not exist' (known codes first)", { code: "P0002", message: "NO_ENCONTRADO: group x does not exist" }, 404, "NO_ENCONTRADO"],
  ]

  it.each(ERRORES)("%s -> %s", async (_t, error, status, code) => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const { tablas, consultas } = instalarBase({}, { rpcErrores: [error] })
    const antes = structuredClone(tablas)

    const respuesta = await parseResponse(await putReq("g-1", cuerpoG1({ rojo: { precioVenta: 1200 } })))

    expect(respuesta.status).toBe(status)
    expect(respuesta.body.code).toBe(code)
    expect(typeof respuesta.body.error).toBe("string")
    expect(JSON.stringify(respuesta.body)).not.toMatch(/inventario_|PAYLOAD_INVALIDO:|violates/)
    // Nothing downstream of a failed save: no events, no audit, no cache bump, no re-read of the group.
    expect(tablas).toEqual(antes)
    expect(eventos()).toEqual([])
    expect(auditoria.update).not.toHaveBeenCalled()
    expect(revalidateTag).not.toHaveBeenCalled()
    expect(consultas).toHaveLength(1)
  })

  it("P0035 tells which codes collide and P0033 which row holds the reservation", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    instalarBase({}, { rpcErrores: [{ code: "P0035", message: "CODIGO_DUPLICADO:FX-1,FX-2" }, { code: "P0033", message: "STOCK_RESERVADO:a1:2" }] })

    const duplicado = await parseResponse(await putReq("g-1", cuerpoG1()))
    const reservado = await parseResponse(await putReq("g-1", cuerpoG1()))

    expect(duplicado.body.codigos).toEqual(["FX-1", "FX-2"])
    expect(reservado.body).toMatchObject({ variante: "a1", unidades: 2 })
  })

  it("a code already used by another active product is a real 409 with the offending code, and nothing is written", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const { tablas } = instalarBase()
    const antes = structuredClone(tablas)
    const cuerpo = cuerpoNuevo()
    cuerpo.variantes[1] = { ...cuerpo.variantes[1], codigo: "FX-Rojo" }

    const { status, body } = await parseResponse(await putReq(cid(100), cuerpo))

    expect(status).toBe(409)
    expect(body).toMatchObject({ code: "CODIGO_DUPLICADO", codigos: ["FX-Rojo"] })
    expect(tablas).toEqual(antes)
    expect(eventos()).toEqual([])
  })

  it("leaving an active member out of the payload is a 409 that tells the form to reload", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const { tablas } = instalarBase()
    const antes = structuredClone(tablas)
    const cuerpo = cuerpoG1()

    const { status, body } = await parseResponse(await putReq("g-1", { ...cuerpo, variantes: [cuerpo.variantes[0]] }))

    expect(status).toBe(409)
    expect(body).toMatchObject({ code: "MIEMBROS_FALTANTES", faltantes: ["a1"], recargar: true })
    expect(tablas).toEqual(antes)
    expect(revalidateTag).not.toHaveBeenCalled()
  })

  it("any other database error is a 500 that does not leak the database message", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    instalarBase({}, { rpcErrores: [{ code: "57014", message: "canceling statement due to statement timeout" }] })

    const { status, body } = await parseResponse(await putReq("g-1", cuerpoG1()))

    expect(status).toBe(500)
    expect(body).toEqual({ error: "Error al guardar las variantes" })
    expect(console.error).toHaveBeenCalled()
    expect(revalidateTag).not.toHaveBeenCalled()
  })

  it("an RPC that answers no data still gets the group read back, with no events", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    instalarBase({}, { rpcDatos: null })

    const { status, body } = await parseResponse(await putReq("g-1", cuerpoG1()))

    expect(status).toBe(200)
    expect(body.variantes.map((v: Fila) => v.id)).toEqual(["r1", "a1"])
    expect(eventos()).toEqual([])
    expect(revalidateTag).toHaveBeenCalledTimes(1)
  })

  it("a failure reading the snapshot is a 500 before the RPC runs", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const { rpcCalls } = instalarBase({ inventario: { code: "57014", message: "canceling statement due to statement timeout" } })

    expect((await putReq("g-1", cuerpoG1())).status).toBe(500)
    expect(rpcCalls).toEqual([])
  })

  it("a save that committed but cannot be read back is a 500, yet the catalog cache is still invalidated", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const { tablas } = instalarBase({}, { lecturaTrasRpc: { code: "57014", message: "canceling statement due to statement timeout" } })

    const { status } = await parseResponse(await putReq(cid(100), cuerpoNuevo()))

    expect(status).toBe(500)
    expect(tablas.inventario.filter((f) => f.grupo_id === cid(100))).toHaveLength(2)
    expect(revalidateTag).toHaveBeenCalledTimes(1)
    // Known limit: the created events are lost for this save (a retry sees the rows as existing).
    expect(eventos()).toEqual([])
  })
})

describe("PUT /api/inventario/grupos/[id]: deadlocks (40P01)", () => {
  it.each(["40P01", "40001"])("%s is retried once with the same arguments and the second answer is used", async (code) => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const { tablas, rpcCalls } = instalarBase({}, { rpcErrores: [{ code, message: "deadlock detected" }] })

    const { status, body } = await parseResponse(await putReq(cid(100), cuerpoNuevo()))

    expect(status).toBe(200)
    expect(rpcCalls).toHaveLength(2)
    expect(rpcCalls[1].args).toStrictEqual(rpcCalls[0].args)
    expect(tablas.inventario.filter((f) => f.grupo_id === cid(100))).toHaveLength(2)
    expect(body.variantes).toHaveLength(2)
    // The failed attempt emitted nothing: the events are those of the successful one only.
    expect(eventos()).toEqual([["inventario.created", cid(101)], ["inventario.created", cid(102)]])
    expect(revalidateTag).toHaveBeenCalledTimes(1)
  })

  it("two deadlocks in a row are a retryable 409 after exactly two attempts, with nothing written or emitted", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const interbloqueo = { code: "40P01", message: "deadlock detected" }
    const { tablas, rpcCalls } = instalarBase({}, { rpcErrores: [interbloqueo, interbloqueo] })
    const antes = structuredClone(tablas)

    const { status, body } = await parseResponse(await putReq(cid(100), cuerpoNuevo()))

    expect(status).toBe(409)
    expect(body).toMatchObject({ code: "REINTENTAR", reintentable: true })
    expect(rpcCalls).toHaveLength(2)
    expect(tablas).toEqual(antes)
    expect(eventos()).toEqual([])
    expect(revalidateTag).not.toHaveBeenCalled()
  })

  it("an error that is not a deadlock is not retried", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const { rpcCalls } = instalarBase({}, { rpcErrores: [{ code: "P0030", message: "COMBINACION_DUPLICADA" }] })

    expect((await putReq("g-1", cuerpoG1())).status).toBe(409)
    expect(rpcCalls).toHaveLength(1)
  })
})
