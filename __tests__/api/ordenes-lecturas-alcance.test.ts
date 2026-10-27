// @vitest-environment node
/**
 * The read surfaces of orders under branch isolation (change sucursales-aislamiento, PR5; OI-1, SC-2,
 * SC-3, SC-6, BM-6, XC-1, XC-2, XC-3): compromisos, the global search, the export and the notification
 * history. One world, two branches (A, B) and the same viewers on every surface:
 *
 *  - a VENDEDOR of A reads A, a VENDEDOR of B reads B, an ADMIN on Todas reads both, an ADMIN with a
 *    branch selected reads exactly what that branch's staff reads;
 *  - a TECNICO keeps what is assigned to him from ANY branch (the jed-electronics case);
 *  - an order outside the scope answers like one that does not exist, and costs no lookup.
 *
 * The tables are in-memory and honor every filter; the `search_all` function is emulated with the
 * branch argument it receives (the SQL honors `p_sucursal_id`), so a route that passes the wrong branch
 * returns the wrong rows.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { cookies } from "next/headers"
import { supabaseAdmin } from "@/lib/supabase"
import { SUCURSAL_COOKIE, SUCURSAL_NINGUNA } from "@/lib/sucursal"
import { mockAuthSuccess, parseResponse } from "./helpers"
import { montarSupabaseEnMemoria } from "../helpers/supabase-memoria"
import { GET as listar } from "@/app/api/ordenes/route"
import { GET as compromisos } from "@/app/api/ordenes/compromisos/route"
import { GET as buscar } from "@/app/api/search/route"
import { GET as exportar } from "@/app/api/export/[entity]/route"
import { GET as notificaciones } from "@/app/api/notificaciones/route"

vi.mock("@/lib/notifications/queue", () => ({ queueNotification: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/subscriptions", () => ({ hasPlanFeature: vi.fn().mockResolvedValue(true) }))

const A = "suc-A"
const B = "suc-B"
// Order numbers have at least two digits: the search ignores a term shorter than that.
const PRIMER_NUMERO = 100
let numero = PRIMER_NUMERO

function orden(id: string, sucursal: string, tecnico: string | null, extra: Record<string, unknown> = {}) {
  numero++
  return {
    id,
    organization_id: "org-1",
    sucursal_id: sucursal,
    tecnico_id: tecnico,
    numero_orden: numero,
    codigo_orden: `CEL-${numero}`,
    dispositivo: `Galaxy ${id}`,
    tipo_dispositivo: "CELULAR",
    marca: "Samsung",
    imei: null,
    problema_reportado: "No enciende",
    estado: "EN_REPARACION",
    fecha_prometida: "2026-10-20T12:00:00Z",
    fecha_ingreso: `2026-10-${String(numero - PRIMER_NUMERO).padStart(2, "0")}T10:00:00Z`,
    presupuesto: 1000,
    sena: 0,
    costo_final: null,
    cliente_id: null,
    clientes: { id: "cl-1", nombre: "Cliente", telefono: "1" },
    users: tecnico ? { id: tecnico, nombre: `Tec ${tecnico}` } : null,
    ...extra,
  }
}

// A: a1 (free), a2 (t-a), a3 (t-b). B: b1 (free), b2 (t-a: a technician of A holds an order of B), b3 (t-b).
const ORDENES = () => {
  numero = PRIMER_NUMERO
  return [
    orden("a1", A, null),
    orden("a2", A, "t-a"),
    orden("a3", A, "t-b"),
    orden("b1", B, null),
    orden("b2", B, "t-a"),
    orden("b3", B, "t-b"),
  ]
}
const NUM = { a1: 101, a2: 102, a3: 103, b1: 104, b2: 105, b3: 106 } as Record<string, number>

interface Espectador {
  nombre: string
  role: "ADMIN" | "VENDEDOR" | "TECNICO"
  userId: string
  sucursalId: string | null
  cookie?: string
}
const ADMIN_TODAS: Espectador = { nombre: "ADMIN Todas", role: "ADMIN", userId: "u-admin", sucursalId: null }
const ADMIN_A: Espectador = { nombre: "ADMIN selected A", role: "ADMIN", userId: "u-admin", sucursalId: null, cookie: A }
const ADMIN_B: Espectador = { nombre: "ADMIN selected B", role: "ADMIN", userId: "u-admin", sucursalId: null, cookie: B }
const VENDEDOR_A: Espectador = { nombre: "VENDEDOR of A", role: "VENDEDOR", userId: "v-a", sucursalId: A }
const VENDEDOR_B: Espectador = { nombre: "VENDEDOR of B", role: "VENDEDOR", userId: "v-b", sucursalId: B }
const TECNICO_A: Espectador = { nombre: "TECNICO t-a of A", role: "TECNICO", userId: "t-a", sucursalId: A }
const TECNICO_B: Espectador = { nombre: "TECNICO t-b of B", role: "TECNICO", userId: "t-b", sucursalId: B }
const TECNICO_SIN_SUCURSAL: Espectador = { nombre: "TECNICO t-a without a branch", role: "TECNICO", userId: "t-a", sucursalId: null }
const VENDEDOR_SIN_SUCURSAL: Espectador = { nombre: "VENDEDOR without a branch", role: "VENDEDOR", userId: "v-x", sucursalId: null }

/** it.each rows with the viewer's name first, so the name of each test says who is looking. */
const conNombre = <R extends unknown[]>(filas: Array<[Espectador, ...R]>) =>
  filas.map(([e, ...resto]) => {
    const primero = resto[0]
    const detalle = typeof primero === "boolean" ? ` (opt-in ${primero ? "on" : "off"})` : typeof primero === "string" ? ` -> ${primero}` : ""
    return [`${e.nombre}${detalle}`, e, ...resto] as [string, Espectador, ...R]
  })

function entrar(e: Espectador) {
  mockAuthSuccess({ role: e.role, userId: e.userId, sucursalId: e.sucursalId })
  vi.mocked(cookies).mockResolvedValue({
    get: (nombre: string) => (nombre === SUCURSAL_COOKIE && e.cookie ? { value: e.cookie } : undefined),
    set: vi.fn(),
  } as any)
}

/** What `search_all` answers for a term and a branch, as the SQL of migration 239 does. */
function emularSearchAll(filas: ReturnType<typeof ORDENES>) {
  return (_nombre: string, args: any) => {
    const q = String(args.search_query)
    const sucursal = args.p_sucursal_id as string | null
    return {
      clientes: [],
      ordenes: filas
        .filter((o) => sucursal === null || o.sucursal_id === sucursal)
        .filter((o) => o.dispositivo.toLowerCase().includes(q.toLowerCase()) || String(o.numero_orden) === q)
        .slice(0, Number(args.max_results))
        .map((o) => ({ id: o.id, numero_orden: o.numero_orden, dispositivo: o.dispositivo, estado: o.estado, cliente_nombre: "Cliente", relevance: 1 })),
    }
  }
}

function montar(opts: { toma?: boolean; extra?: Record<string, any[]>; filas?: ReturnType<typeof ORDENES>; conRpc?: boolean } = {}) {
  const filas = opts.filas ?? ORDENES()
  return montarSupabaseEnMemoria(
    {
      ordenes_servicio: filas,
      organizations: [{ id: "org-1", tecnicos_toman_ordenes: opts.toma ?? false, vendedores_administran_inventario: false, zona_horaria: "America/Argentina/Buenos_Aires" }],
      clientes: [{ id: "cl-1", organization_id: "org-1", nombre: "Cliente", telefono: "1", email: "c@x.com", dni: "1" }],
      ...opts.extra,
    },
    { resultadoRpc: opts.conRpc === false ? undefined : emularSearchAll(filas) },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  numero = PRIMER_NUMERO
})

// ---------------------------------------------------------------------------------------------
describe("GET /api/ordenes/compromisos", () => {
  async function ids(e: Espectador) {
    entrar(e)
    montar()
    const { status, body } = await parseResponse(await compromisos(new Request("http://localhost:3000/api/ordenes/compromisos")))
    expect(status).toBe(200)
    return (body.ordenes as Array<{ id: string }>).map((o) => o.id).sort()
  }

  it.each(
    conNombre([
      [ADMIN_TODAS, ["a1", "a2", "a3", "b1", "b2", "b3"]],
      [VENDEDOR_A, ["a1", "a2", "a3"]],
      [VENDEDOR_B, ["b1", "b2", "b3"]],
      [ADMIN_A, ["a1", "a2", "a3"]],
      [ADMIN_B, ["b1", "b2", "b3"]],
      [VENDEDOR_SIN_SUCURSAL, []],
    ]),
  )("%s sees the expected orders", async (_nombre, espectador, esperado) => {
    expect(await ids(espectador)).toEqual(esperado)
  })

  it("an ADMIN with a branch selected sees exactly what that branch's seller sees (SC-3)", async () => {
    expect(await ids(ADMIN_B)).toEqual(await ids(VENDEDOR_B))
  })

  it("a seller ignores the stored choice of another branch", async () => {
    expect(await ids({ ...VENDEDOR_A, cookie: B })).toEqual(["a1", "a2", "a3"])
  })

  it.each(
    conNombre([
      [TECNICO_A, ["a2", "b2"]],
      [TECNICO_B, ["a3", "b3"]],
      [TECNICO_SIN_SUCURSAL, ["a2", "b2"]],
    ]),
  )("%s keeps his assigned orders from any branch and nothing else", async (_nombre, espectador, esperado) => {
    expect(await ids(espectador)).toEqual(esperado)
  })

  it("the date window still applies inside the scope", async () => {
    entrar(VENDEDOR_A)
    const filas = ORDENES()
    filas[0].fecha_prometida = "2026-11-30T12:00:00Z"
    montar({ filas })
    const { body } = await parseResponse(
      await compromisos(new Request("http://localhost:3000/api/ordenes/compromisos?desde=2026-10-01&hasta=2026-10-31")),
    )
    expect((body.ordenes as Array<{ id: string }>).map((o) => o.id).sort()).toEqual(["a2", "a3"])
  })
})

// ---------------------------------------------------------------------------------------------
describe("GET /api/search", () => {
  const url = (q: string, extra = "") => new Request(`http://localhost:3000/api/search?q=${encodeURIComponent(q)}${extra}`)

  async function ordenesDe(e: Espectador, q: string, extra = "") {
    entrar(e)
    const memoria = montar()
    const { status, body } = await parseResponse(await buscar(url(q, extra)))
    expect(status).toBe(200)
    return { ids: (body.ordenes as Array<{ id: string }>).map((o) => o.id).sort(), memoria }
  }

  it.each(
    conNombre([
      [VENDEDOR_A, ["a1", "a2", "a3"]],
      [VENDEDOR_B, ["b1", "b2", "b3"]],
      [ADMIN_TODAS, ["a1", "a2", "a3", "b1", "b2", "b3"]],
      [ADMIN_B, ["b1", "b2", "b3"]],
      [{ ...VENDEDOR_A, nombre: "VENDEDOR of A with the cookie of B", cookie: B }, ["a1", "a2", "a3"]],
      [VENDEDOR_SIN_SUCURSAL, []],
    ]),
  )("%s finds the expected orders", async (_nombre, espectador, esperado) => {
    expect((await ordenesDe(espectador, "Galaxy")).ids).toEqual(esperado)
  })

  it("passes the branch the SQL scopes on: the branch id, null for every branch, the sentinel for nobody", async () => {
    const rpc = async (e: Espectador) => {
      const { memoria } = await ordenesDe(e, "Galaxy")
      return memoria.escrituras.find((x) => x.tabla === "search_all")?.carga as any
    }
    expect((await rpc(VENDEDOR_A)).p_sucursal_id).toBe(A)
    expect((await rpc(ADMIN_B)).p_sucursal_id).toBe(B)
    expect((await rpc(ADMIN_TODAS)).p_sucursal_id).toBeNull()
    expect((await rpc(VENDEDOR_SIN_SUCURSAL)).p_sucursal_id).toBe(SUCURSAL_NINGUNA)
  })

  it("a seller of A searching the number of an order of B finds nothing: the same as a number that does not exist", async () => {
    const deB = (await ordenesDe(VENDEDOR_A, String(NUM.b1))).ids
    const inexistente = (await ordenesDe(VENDEDOR_A, "999")).ids
    expect(deB).toEqual([])
    expect(inexistente).toEqual(deB)
    expect((await ordenesDe(VENDEDOR_B, String(NUM.b1))).ids).toEqual(["b1"])
  })

  describe("a technician finds what is assigned to him in any branch (BM-6)", () => {
    it("the orders of his branch plus the one he holds in the other", async () => {
      expect((await ordenesDe(TECNICO_A, "Galaxy")).ids).toEqual(["a1", "a2", "a3", "b2"])
    })

    it("searching by the number of the order he holds in the other branch", async () => {
      expect((await ordenesDe(TECNICO_A, String(NUM.b2))).ids).toEqual(["b2"])
    })

    it("but not an unassigned order of the other branch", async () => {
      expect((await ordenesDe(TECNICO_A, String(NUM.b1))).ids).toEqual([])
    })

    it("an order that the SQL already returned is not repeated", async () => {
      const { ids } = await ordenesDe(TECNICO_A, "Galaxy a2")
      expect(ids).toEqual(["a2"])
    })

    it("the limit is kept", async () => {
      expect((await ordenesDe(TECNICO_A, "Galaxy", "&limit=2")).ids).toHaveLength(2)
    })

    it("without a branch: only what is assigned to him", async () => {
      expect((await ordenesDe(TECNICO_SIN_SUCURSAL, "Galaxy")).ids).toEqual(["a2", "b2"])
    })

    it("a search for clients only does not look at orders", async () => {
      entrar(TECNICO_A)
      const memoria = montar()
      await buscar(url("Cliente", "&type=clientes"))
      expect(memoria.lecturas).not.toContain("ordenes_servicio")
    })
  })

  describe("when the search function is unavailable, the fallback applies the same scope", () => {
    async function ordenesDeFallback(e: Espectador, q: string) {
      entrar(e)
      montar()
      vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: null, error: { message: "function search_all does not exist" } } as any)
      const { status, body } = await parseResponse(await buscar(url(q)))
      expect(status).toBe(200)
      return (body.ordenes as Array<{ id: string }>).map((o) => o.id).sort()
    }

    it.each(
      conNombre([
        [VENDEDOR_A, ["a1", "a2", "a3"]],
        [VENDEDOR_B, ["b1", "b2", "b3"]],
        [ADMIN_TODAS, ["a1", "a2", "a3", "b1", "b2", "b3"]],
        [ADMIN_B, ["b1", "b2", "b3"]],
        [VENDEDOR_SIN_SUCURSAL, []],
        [TECNICO_A, ["a1", "a2", "a3", "b2"]],
      ]),
    )("%s finds the expected orders", async (_nombre, espectador, esperado) => {
      expect(await ordenesDeFallback(espectador, "Galaxy")).toEqual(esperado)
    })

    it("finds by the number of the order, like the function does", async () => {
      expect(await ordenesDeFallback(VENDEDOR_B, String(NUM.b3))).toEqual(["b3"])
      expect(await ordenesDeFallback(VENDEDOR_A, String(NUM.b3))).toEqual([])
    })

    it("a term built to close the filter cannot widen the scope or break the query", async () => {
      expect(await ordenesDeFallback(VENDEDOR_A, "x),sucursal_id.neq.zzz,dispositivo.ilike.(Galaxy")).toEqual([])
      expect(await ordenesDeFallback(VENDEDOR_A, "Galaxy a1),id.neq.zz")).toEqual([])
    })
  })
})

// ---------------------------------------------------------------------------------------------
describe("GET /api/export/ordenes: the rows of the screen (SC-6)", () => {
  const pedir = () => exportar(new NextRequest("http://localhost:3000/api/export/ordenes"), { params: Promise.resolve({ entity: "ordenes" }) })

  /** The order numbers of the CSV (first column). */
  async function filasExportadas(e: Espectador, toma = false): Promise<number[]> {
    entrar(e)
    montar({ toma })
    const res = await pedir()
    expect(res.status).toBe(200)
    const [, ...filas] = (await res.text()).split("\n")
    return filas.filter((f) => f !== "").map((f) => Number(f.split(",")[0])).sort((x, y) => x - y)
  }

  async function filasDelListado(e: Espectador, toma = false): Promise<number[]> {
    entrar(e)
    montar({ toma })
    const { body } = await parseResponse(await listar(new Request("http://localhost:3000/api/ordenes?limit=100")))
    return (body.data as Array<{ numeroOrden: number }>).map((o) => o.numeroOrden).sort((x, y) => x - y)
  }

  const num = (...ids: string[]) => ids.map((id) => NUM[id]).sort((x, y) => x - y)

  it.each(
    conNombre([
      [ADMIN_TODAS, false, num("a1", "a2", "a3", "b1", "b2", "b3")],
      [VENDEDOR_A, false, num("a1", "a2", "a3")],
      [VENDEDOR_B, false, num("b1", "b2", "b3")],
      [ADMIN_B, false, num("b1", "b2", "b3")],
      [VENDEDOR_SIN_SUCURSAL, false, []],
      [TECNICO_A, false, num("a2", "b2")],
      [TECNICO_A, true, num("a1", "a2", "b2")],
      [TECNICO_B, true, num("a3", "b1", "b3")],
      [TECNICO_SIN_SUCURSAL, true, num("a2", "b2")],
    ]),
  )("%s exports the expected rows", async (_nombre, espectador, toma, esperado) => {
    expect(await filasExportadas(espectador, toma)).toEqual(esperado)
  })

  it.each(
    conNombre([
      [ADMIN_TODAS, false],
      [ADMIN_A, false],
      [ADMIN_B, false],
      [VENDEDOR_A, false],
      [VENDEDOR_B, false],
      [VENDEDOR_SIN_SUCURSAL, false],
      [TECNICO_A, false],
      [TECNICO_A, true],
      [TECNICO_B, true],
      [TECNICO_SIN_SUCURSAL, true],
    ]),
  )("%s: the export has exactly the rows the list shows", async (_nombre, espectador, toma) => {
    const lista = await filasDelListado(espectador, toma)
    expect(await filasExportadas(espectador, toma)).toEqual(lista)
  })

  it("an ADMIN with a branch selected exports what that branch's seller exports (SC-3)", async () => {
    expect(await filasExportadas(ADMIN_B)).toEqual(await filasExportadas(VENDEDOR_B))
  })

  it("a seller ignores the stored choice of another branch", async () => {
    expect(await filasExportadas({ ...VENDEDOR_A, cookie: B })).toEqual(num("a1", "a2", "a3"))
  })

  it("the date filters still narrow inside the scope", async () => {
    entrar(VENDEDOR_A)
    montar()
    const res = await exportar(
      new NextRequest("http://localhost:3000/api/export/ordenes?desde=2026-10-02T00:00:00Z&hasta=2026-10-02T23:59:59Z"),
      { params: Promise.resolve({ entity: "ordenes" }) },
    )
    const [, ...filas] = (await res.text()).split("\n")
    expect(filas.map((f) => Number(f.split(",")[0]))).toEqual([NUM.a2])
  })
})

// ---------------------------------------------------------------------------------------------
describe("GET /api/notificaciones", () => {
  const log = (id: string, ordenId: string | null, sucursal: string | null, tecnico: string | null = null) => ({
    id,
    organization_id: "org-1",
    orden_id: ordenId,
    tipo: "CAMBIO_ESTADO",
    canal: "WHATSAPP",
    estado: "ENVIADO",
    destinatario: "+5491100000000",
    asunto: "Tu equipo",
    error_message: null,
    created_at: "2026-10-14T10:00:00Z",
    estado_entrega: null,
    delivered_at: null,
    bounced_at: null,
    bounce_tipo: null,
    proveedor: null,
    ordenes_servicio: ordenId ? { numero_orden: NUM[ordenId], sucursal_id: sucursal, tecnico_id: tecnico } : null,
    clientes: { nombre: "Cliente" },
  })

  const LOGS = [
    log("n-a1", "a1", A),
    log("n-a2", "a2", A, "t-a"),
    log("n-b1", "b1", B),
    log("n-b2", "b2", B, "t-a"),
    log("n-b3", "b3", B, "t-b"),
    log("n-sin", null, null),
  ]

  async function historial(e: Espectador, query = "", toma = false) {
    entrar(e)
    const memoria = montar({ toma, extra: { notification_logs: LOGS } })
    const { status, body } = await parseResponse(await notificaciones(new Request(`http://localhost:3000/api/notificaciones${query}`)))
    expect(status).toBe(200)
    return { ids: (body as Array<{ id: string }>).map((n) => n.id).sort(), memoria }
  }

  describe("of one order (what the order timeline asks)", () => {
    it.each(
      conNombre([
        [VENDEDOR_A, "a1", ["n-a1"]],
        [VENDEDOR_A, "b1", []],
        [VENDEDOR_B, "b1", ["n-b1"]],
        [ADMIN_TODAS, "b1", ["n-b1"]],
        [ADMIN_B, "a1", ["n-a1"]],
        [TECNICO_A, "b2", ["n-b2"]],
        [TECNICO_A, "a2", ["n-a2"]],
      ]),
    )("%s: the history of that order is the expected one", async (_nombre, espectador, ordenId, esperado) => {
      expect((await historial(espectador, `?ordenId=${ordenId}`)).ids).toEqual(esperado)
    })

    it("an order outside the scope answers like one that does not exist, and the history is never read", async () => {
      const fuera = await historial(VENDEDOR_A, "?ordenId=b1")
      const inexistente = await historial(VENDEDOR_A, "?ordenId=no-existe")
      expect(fuera.ids).toEqual([])
      expect(inexistente.ids).toEqual(fuera.ids)
      expect(fuera.memoria.lecturas).not.toContain("notification_logs")
    })

    it("a technician cannot read the history of an unassigned order of his own branch unless he may open it", async () => {
      expect((await historial(TECNICO_A, "?ordenId=a1")).ids).toEqual([])
      expect((await historial(TECNICO_A, "?ordenId=a1", true)).ids).toEqual(["n-a1"])
      expect((await historial(TECNICO_A, "?ordenId=b1", true)).ids).toEqual([])
    })
  })

  describe("of the whole organization (no order)", () => {
    it.each(
      conNombre([
        [ADMIN_TODAS, ["n-a1", "n-a2", "n-b1", "n-b2", "n-b3", "n-sin"]],
        [VENDEDOR_A, ["n-a1", "n-a2"]],
        [VENDEDOR_B, ["n-b1", "n-b2", "n-b3"]],
        [ADMIN_B, ["n-b1", "n-b2", "n-b3"]],
        [VENDEDOR_SIN_SUCURSAL, []],
        [TECNICO_A, ["n-a1", "n-a2", "n-b2"]],
        [TECNICO_SIN_SUCURSAL, ["n-a2", "n-b2"]],
      ]),
    )("%s gets the expected history", async (_nombre, espectador, esperado) => {
      expect((await historial(espectador)).ids).toEqual(esperado)
    })

    it("an ADMIN with a branch selected gets what that branch's seller gets (SC-3)", async () => {
      expect((await historial(ADMIN_B)).ids).toEqual((await historial(VENDEDOR_B)).ids)
    })

    it("a seller ignores the stored choice of another branch", async () => {
      expect((await historial({ ...VENDEDOR_A, cookie: B })).ids).toEqual(["n-a1", "n-a2"])
    })
  })
})
