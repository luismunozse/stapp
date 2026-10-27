// @vitest-environment node
/**
 * The technician views under branch isolation (change sucursales-aislamiento, PR5; OI-1, SC-2, SC-3,
 * BM-5, BM-6, XC-2): the summary, the orders and the insights of a technician, and the bulk
 * reassignment. Two branches (A, B) and technicians that hold orders of both (a technician of A holds
 * an order of B, as jed-electronics does):
 *
 *  - an ADMIN on Todas reads every order, with a branch selected reads what that branch handles;
 *  - the technician himself reads everything assigned to him, from any branch;
 *  - a bulk reassignment moves only orders in the ADMIN's scope, and the destination must be able to be
 *    assigned to EACH of them (same rule as a single assignment): otherwise nothing moves.
 *
 * The tables are in-memory and honor every filter; writes are recorded with their filters.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { cookies } from "next/headers"
import { SUCURSAL_COOKIE } from "@/lib/sucursal"
import { MENSAJE_TECNICO_OTRA_SUCURSAL } from "@/lib/sucursal-ordenes"
import { mockAuthSuccess, parseResponse } from "./helpers"
import { montarSupabaseEnMemoria } from "../helpers/supabase-memoria"
import { GET as resumen } from "@/app/api/tecnicos/summary/route"
import { GET as ordenesDe } from "@/app/api/tecnicos/[id]/ordenes/route"
import { GET as insightsDe } from "@/app/api/tecnicos/[id]/insights/route"
import { POST as reasignar } from "@/app/api/tecnicos/[id]/reasignar/route"
import { GET as listar } from "@/app/api/tecnicos/route"
import { GET as detalle, DELETE as eliminar } from "@/app/api/tecnicos/[id]/route"
import { PATCH as estado } from "@/app/api/tecnicos/[id]/estado/route"

const A = "suc-A"
const B = "suc-B"
const AYER = new Date(Date.now() - 24 * 3600 * 1000).toISOString()

let numero = 0
function orden(id: string, sucursal: string, tecnico: string | null, estado = "EN_REPARACION") {
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
    estado,
    fecha_ingreso: AYER,
    fecha_completado: estado === "REPARADO" ? AYER : null,
    fecha_prometida: null,
    costo_final: 100,
    es_reingreso: false,
    comision_pagada: false,
    clientes: { nombre: "Cliente" },
    repuestos_orden: [],
  }
}

// a1 free (A). a2: t-a (A). a3: t-b (A, done): a technician of B holds an order of A.
// b1 free (B). b2: t-a (B): a technician of A holds an order of B. b3: t-b (B, done).
const ORDENES = () => {
  numero = 0
  return [
    orden("a1", A, null, "RECIBIDO"),
    orden("a2", A, "t-a"),
    orden("a3", A, "t-b", "REPARADO"),
    orden("b1", B, null, "RECIBIDO"),
    orden("b2", B, "t-a"),
    orden("b3", B, "t-b", "REPARADO"),
  ]
}

type OrdenFila = ReturnType<typeof orden>

/**
 * What the order embeds of a technician hold: the orders assigned to him, whatever their state (each route
 * filters the embed by state and, for the scoped ones, by branch). `activas_del_alcance` and
 * `completadas_del_alcance` are the ones the viewer's branch handles; `activas_totales` is the open ones of
 * every branch; `ordenes_servicio` is the embed of the delete guard. An order of ANOTHER organization under his
 * id is no row of the scoped embeds and is a row of the other two, which only the route's own filter by
 * organization (the total) keeps out.
 */
const embeber = (ordenes: OrdenFila[], id: string) => {
  const fila = (o: OrdenFila) => ({ id: o.id, estado: o.estado, sucursal_id: o.sucursal_id, organization_id: o.organization_id })
  const suyas = ordenes.filter((o) => o.tecnico_id === id)
  const deLaOrg = suyas.filter((o) => o.organization_id === "org-1").map(fila)
  return {
    activas_del_alcance: deLaOrg,
    completadas_del_alcance: deLaOrg,
    activas_totales: suyas.map(fila),
    ordenes_servicio: suyas.map(fila),
  }
}

const usuario = (id: string, rol: string, sucursal: string | null, extra: Record<string, unknown> = {}) => ({
  id,
  organization_id: "org-1",
  rol,
  nombre: `Nombre ${id}`,
  email: `${id}@x.com`,
  telefono: null,
  activo: true,
  especialidades: [],
  avatar_url: null,
  fecha_ingreso_tecnico: null,
  porcentaje_comision: 10,
  costo_hora: 5,
  sucursal_id: sucursal,
  created_at: "2026-01-01T00:00:00Z",
  horario_laboral: null,
  ...embeber(ORDENES(), id),
  ...extra,
})

const USUARIOS = [
  usuario("t-a", "TECNICO", A),
  usuario("t-a2", "TECNICO", A),
  usuario("t-b", "TECNICO", B),
  usuario("t-b2", "TECNICO", B),
  usuario("admin-1", "ADMIN", null),
  usuario("t-inactivo", "TECNICO", A, { activo: false }),
]

interface Espectador {
  nombre: string
  role: "ADMIN" | "TECNICO" | "VENDEDOR"
  userId: string
  sucursalId: string | null
  cookie?: string
}
const ADMIN_TODAS: Espectador = { nombre: "ADMIN Todas", role: "ADMIN", userId: "admin-1", sucursalId: null }
const ADMIN_A: Espectador = { ...ADMIN_TODAS, nombre: "ADMIN selected A", cookie: A }
const ADMIN_B: Espectador = { ...ADMIN_TODAS, nombre: "ADMIN selected B", cookie: B }
const TECNICO_A: Espectador = { nombre: "TECNICO t-a of A", role: "TECNICO", userId: "t-a", sucursalId: A }

const conNombre = <R extends unknown[]>(filas: Array<[Espectador, ...R]>) =>
  filas.map(([e, ...resto]) => [e.nombre, e, ...resto] as [string, Espectador, ...R])

function entrar(e: Espectador) {
  mockAuthSuccess({ role: e.role, userId: e.userId, sucursalId: e.sucursalId })
  vi.mocked(cookies).mockResolvedValue({
    get: (nombre: string) => (nombre === SUCURSAL_COOKIE && e.cookie ? { value: e.cookie } : undefined),
    set: vi.fn(),
  } as any)
}

function montar() {
  return montarSupabaseEnMemoria({
    ordenes_servicio: ORDENES(),
    users: USUARIOS,
    organizations: [{ id: "org-1", vendedores_administran_inventario: false }],
  })
}

/** The tables of a world with these orders (and these extra technicians): every user's embeds hold what the orders say. */
function mundo(ordenes: OrdenFila[], tecnicos: Array<{ id: string; sucursal: string }> = [], opciones: Parameters<typeof montarSupabaseEnMemoria>[1] = {}) {
  const usuarios = [...USUARIOS, ...tecnicos.map((t) => usuario(t.id, "TECNICO", t.sucursal))].map((u) => ({ ...u, ...embeber(ordenes, u.id) }))
  return montarSupabaseEnMemoria(
    { ordenes_servicio: ordenes, users: usuarios, organizations: [{ id: "org-1", vendedores_administran_inventario: false }] },
    opciones,
  )
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const get = (ruta: string) => new Request(`http://localhost:3000/api/tecnicos/${ruta}`)

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------------------------
describe("GET /api/tecnicos/summary (ADMIN)", () => {
  async function porTecnico(e: Espectador) {
    entrar(e)
    montar()
    const { status, body } = await parseResponse(await resumen(get("summary?dias=30")))
    expect(status).toBe(200)
    return Object.fromEntries(
      (body.tecnicos as Array<{ tecnicoId: string; ordenesPeriodo: number; completadas: number }>).map((t) => [
        t.tecnicoId,
        [t.ordenesPeriodo, t.completadas],
      ]),
    )
  }

  it.each(
    conNombre([
      [ADMIN_TODAS, { "t-a": [2, 0], "t-b": [2, 2] }],
      [ADMIN_A, { "t-a": [1, 0], "t-b": [1, 1] }],
      [ADMIN_B, { "t-a": [1, 0], "t-b": [1, 1] }],
    ]),
  )("%s sees the technicians' orders of that scope", async (_nombre, espectador, esperado) => {
    expect(await porTecnico(espectador)).toEqual(esperado)
  })

  it("the numbers of the branches add up to Todas (SC-4)", async () => {
    const [a, b, todas] = [await porTecnico(ADMIN_A), await porTecnico(ADMIN_B), await porTecnico(ADMIN_TODAS)]
    for (const id of ["t-a", "t-b"]) {
      expect(a[id][0] + b[id][0]).toBe(todas[id][0])
      expect(a[id][1] + b[id][1]).toBe(todas[id][1])
    }
  })

  it("a technician is refused, whatever the scope", async () => {
    entrar(TECNICO_A)
    montar()
    expect((await resumen(get("summary"))).status).toBe(403)
  })
})

// ---------------------------------------------------------------------------------------------
describe("GET /api/tecnicos/[id]/ordenes", () => {
  async function ids(e: Espectador, tecnico: string) {
    entrar(e)
    montar()
    const { status, body } = await parseResponse(await ordenesDe(get(`${tecnico}/ordenes`), ctx(tecnico)))
    expect(status).toBe(200)
    return { ids: (body.items as Array<{ id: string }>).map((o) => o.id).sort(), total: body.total as number }
  }

  it.each(
    conNombre([
      [ADMIN_TODAS, ["a2", "b2"]],
      [ADMIN_A, ["a2"]],
      [ADMIN_B, ["b2"]],
    ]),
  )("%s sees the orders of t-a in that scope", async (_nombre, espectador, esperado) => {
    const { ids: vistas, total } = await ids(espectador, "t-a")
    expect(vistas).toEqual(esperado)
    expect(total).toBe(esperado.length)
  })

  it("the technician himself sees all his orders, whatever the stored choice of a branch (BM-6)", async () => {
    expect((await ids(TECNICO_A, "t-a")).ids).toEqual(["a2", "b2"])
    expect((await ids({ ...TECNICO_A, cookie: B }, "t-a")).ids).toEqual(["a2", "b2"])
  })

  it("a branch where the technician holds nothing is an empty list, like any technician without orders", async () => {
    expect((await ids(ADMIN_B, "t-a2")).ids).toEqual([])
    expect((await ids(ADMIN_TODAS, "t-a2")).ids).toEqual([])
  })

  it("another technician's orders are refused to a technician", async () => {
    entrar(TECNICO_A)
    montar()
    expect((await ordenesDe(get("t-b/ordenes"), ctx("t-b"))).status).toBe(403)
  })
})

// ---------------------------------------------------------------------------------------------
describe("GET /api/tecnicos/[id]/insights", () => {
  async function totales(e: Espectador, tecnico: string) {
    entrar(e)
    montar()
    const { status, body } = await parseResponse(await insightsDe(get(`${tecnico}/insights`), ctx(tecnico)))
    expect(status).toBe(200)
    return body.totales as { totalOrdenes: number; completadas: number; activas: number }
  }

  it.each(
    conNombre([
      [ADMIN_TODAS, 2],
      [ADMIN_A, 1],
      [ADMIN_B, 1],
    ]),
  )("%s: the orders behind the numbers of t-a", async (_nombre, espectador, esperado) => {
    expect((await totales(espectador, "t-a")).totalOrdenes).toBe(esperado)
  })

  it("splits t-b's finished work by branch", async () => {
    expect((await totales(ADMIN_TODAS, "t-b")).completadas).toBe(2)
    expect((await totales(ADMIN_A, "t-b")).completadas).toBe(1)
    expect((await totales(ADMIN_B, "t-b")).completadas).toBe(1)
  })

  it("the technician himself sees the numbers of all his orders (BM-6)", async () => {
    expect((await totales(TECNICO_A, "t-a")).totalOrdenes).toBe(2)
    expect((await totales({ ...TECNICO_A, cookie: B }, "t-a")).totalOrdenes).toBe(2)
  })
})

// ---------------------------------------------------------------------------------------------
describe("POST /api/tecnicos/[id]/reasignar (BM-5 on a bulk move)", () => {
  async function mover(e: Espectador, destino: string, ordenIds?: string[]) {
    entrar(e)
    const memoria = montar()
    const res = await reasignar(
      new Request("http://localhost:3000/api/tecnicos/t-a/reasignar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tecnicoDestinoId: destino, ...(ordenIds ? { ordenIds } : {}) }),
      }),
      ctx("t-a"),
    )
    const { status, body } = await parseResponse(res)
    const tecnicos = Object.fromEntries(memoria.filas("ordenes_servicio").map((o) => [o.id, o.tecnico_id]))
    const escrituras = memoria.escrituras.filter((x) => x.tabla === "ordenes_servicio")
    return { status, body, tecnicos, escrituras }
  }

  it("an ADMIN on Todas moves every order of the technician to an ADMIN: an ADMIN belongs to no branch", async () => {
    const { status, body, tecnicos } = await mover(ADMIN_TODAS, "admin-1")
    expect(status).toBe(200)
    expect(body.reasignadas).toBe(2)
    expect(tecnicos).toMatchObject({ a2: "admin-1", b2: "admin-1" })
  })

  it("a destination that cannot take ONE of the orders moves nothing: 400 and no write", async () => {
    // t-a2 is a technician of A; b2 is handled by B.
    const { status, body, tecnicos, escrituras } = await mover(ADMIN_TODAS, "t-a2")
    expect(status).toBe(400)
    expect(body.error).toBe(MENSAJE_TECNICO_OTRA_SUCURSAL)
    expect(escrituras).toEqual([])
    expect(tecnicos).toMatchObject({ a2: "t-a", b2: "t-a" })
  })

  it("an ADMIN with a branch selected moves only the orders that branch handles", async () => {
    const { status, body, tecnicos } = await mover(ADMIN_A, "t-a2")
    expect(status).toBe(200)
    expect(body.reasignadas).toBe(1)
    expect(tecnicos).toMatchObject({ a2: "t-a2", b2: "t-a" })
  })

  it("and the destination must belong to that branch: a technician of another branch is refused", async () => {
    const { status, body, escrituras } = await mover(ADMIN_A, "t-b")
    expect(status).toBe(400)
    expect(body.error).toBe(MENSAJE_TECNICO_OTRA_SUCURSAL)
    expect(escrituras).toEqual([])
  })

  it("a chosen subset is judged on its own orders: the A order goes to a technician of A", async () => {
    const { status, body, tecnicos } = await mover(ADMIN_TODAS, "t-a2", ["a2"])
    expect(status).toBe(200)
    expect(body.reasignadas).toBe(1)
    expect(tecnicos).toMatchObject({ a2: "t-a2", b2: "t-a" })
  })

  it("a chosen subset that includes an order the destination cannot take is refused as a whole", async () => {
    const { status, escrituras, tecnicos } = await mover(ADMIN_TODAS, "t-a2", ["a2", "b2"])
    expect(status).toBe(400)
    expect(escrituras).toEqual([])
    expect(tecnicos).toMatchObject({ a2: "t-a", b2: "t-a" })
  })

  it("the commission of the unpaid orders follows the destination, as before", async () => {
    const { escrituras } = await mover(ADMIN_A, "t-a2")
    const comision = escrituras.find((x) => (x.carga as any)?.porcentaje_comision !== undefined)
    expect(comision?.carga).toMatchObject({ porcentaje_comision: 10, costo_hora_snapshot: 5 })
    expect(comision?.filtros).toContainEqual(["in", "id", ["a2"]])
  })

  it("only an ADMIN may move orders", async () => {
    const { status, escrituras } = await mover(TECNICO_A, "t-a2")
    expect(status).toBe(403)
    expect(escrituras).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------------
describe("GET /api/tecnicos?paraReasignarDe= (the destination picker of a bulk move)", () => {
  /** The ids on offer, the number of orders the move would touch, and whether they span several branches. */
  async function ofrecidos(e: Espectador, origen: string, ordenes = ORDENES()) {
    entrar(e)
    montarSupabaseEnMemoria({ ordenes_servicio: ordenes, users: USUARIOS, organizations: [{ id: "org-1", vendedores_administran_inventario: false }] })
    const { status, body } = await parseResponse(await listar(new Request(`http://localhost:3000/api/tecnicos?paraReasignarDe=${origen}`)))
    expect(status).toBe(200)
    return {
      ids: (body.tecnicos as Array<{ id: string }>).map((t) => t.id).sort(),
      ordenesAMover: body.ordenesAMover as number,
      variasSucursales: body.variasSucursales as boolean,
    }
  }

  it("with a branch selected: the technicians of the branch that handles the orders to move", async () => {
    expect((await ofrecidos(ADMIN_A, "t-a")).ids).toEqual(["t-a", "t-a2", "t-inactivo"])
    expect((await ofrecidos(ADMIN_B, "t-a")).ids).toEqual(["t-b", "t-b2"])
  })

  it("on Todas, orders of ONE branch: that branch's technicians (what the route will accept)", async () => {
    const ordenes = ORDENES()
    ordenes.push(orden("a4", A, "t-a2"))
    expect((await ofrecidos(ADMIN_TODAS, "t-a2", ordenes)).ids).toEqual(["t-a", "t-a2", "t-inactivo"])
  })

  it("the technician of A who holds an order of B: the picker offers B's technicians, the ones the route accepts", async () => {
    const ordenes = ORDENES().filter((o) => o.id !== "a2") // t-a keeps only b2
    expect((await ofrecidos(ADMIN_TODAS, "t-a", ordenes)).ids).toEqual(["t-b", "t-b2"])
  })

  it("on Todas, orders of SEVERAL branches: nobody can take them all, so nobody is offered, and the answer says why", async () => {
    const { ids, variasSucursales } = await ofrecidos(ADMIN_TODAS, "t-a")
    expect(ids).toEqual([])
    expect(variasSucursales).toBe(true)
  })

  it("a technician with no open orders: the list the request's own scope gives", async () => {
    expect((await ofrecidos(ADMIN_TODAS, "t-b2")).ids).toEqual(["t-a", "t-a2", "t-b", "t-b2", "t-inactivo"])
    expect((await ofrecidos(ADMIN_B, "t-b2")).ids).toEqual(["t-b", "t-b2"])
  })

  it("only an ADMIN's list changes: anyone else keeps his own branch's list and the parameter does nothing", async () => {
    entrar({ ...TECNICO_A, nombre: "t-a" })
    montarSupabaseEnMemoria({ ordenes_servicio: ORDENES(), users: USUARIOS, organizations: [{ id: "org-1", vendedores_administran_inventario: false }] })
    const { body } = await parseResponse(await listar(new Request("http://localhost:3000/api/tecnicos?paraReasignarDe=t-b")))
    expect((body as Array<{ id: string }>).map((t) => t.id).sort()).toEqual(["t-a", "t-a2", "t-inactivo"])
  })

  describe("it says how many orders the move touches, and that is how many it moves", () => {
    it.each(
      conNombre([
        [ADMIN_TODAS, 2, true],
        [ADMIN_A, 1, false],
        [ADMIN_B, 1, false],
      ]),
    )("%s: the orders of t-a in that scope, across branches or not", async (_nombre, espectador, cantidad, varias) => {
      const { ordenesAMover, variasSucursales } = await ofrecidos(espectador, "t-a")
      expect(ordenesAMover).toBe(cantidad)
      expect(variasSucursales).toBe(varias)
    })

    it("nothing to move: zero orders in one branch's worth of nothing", async () => {
      const { ordenesAMover, variasSucursales } = await ofrecidos(ADMIN_TODAS, "t-b2")
      expect(ordenesAMover).toBe(0)
      expect(variasSucursales).toBe(false)
    })

    it.each(conNombre([[ADMIN_TODAS], [ADMIN_A], [ADMIN_B]]))(
      "%s: the number on offer is the number the move (to an ADMIN, who can take any) reports",
      async (_nombre, espectador) => {
        const { ordenesAMover } = await ofrecidos(espectador, "t-a")
        entrar(espectador)
        montar()
        const res = await reasignar(
          new Request("http://localhost:3000/api/tecnicos/t-a/reasignar", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tecnicoDestinoId: "admin-1" }),
          }),
          ctx("t-a"),
        )
        expect((await parseResponse(res)).body.reasignadas).toBe(ordenesAMover)
      },
    )

    it("only the open orders count: a finished one does not move", async () => {
      const ordenes = ORDENES()
      ordenes.push(orden("a9", A, "t-a", "REPARADO"))
      expect((await ofrecidos(ADMIN_A, "t-a", ordenes)).ordenesAMover).toBe(1)
    })
  })

  describe("when the orders cannot be read", () => {
    it("the picker fails instead of offering a list that was not judged against the orders", async () => {
      entrar(ADMIN_A)
      montarSupabaseEnMemoria(
        { ordenes_servicio: ORDENES(), users: USUARIOS, organizations: [{ id: "org-1", vendedores_administran_inventario: false }] },
        { errorDeLectura: { ordenes_servicio: { code: "XX000", message: "connection lost" } } },
      )
      const res = await listar(new Request("http://localhost:3000/api/tecnicos?paraReasignarDe=t-a"))
      expect(res.status).toBe(500)
      const texto = await res.text()
      const body = JSON.parse(texto)
      expect(body.tecnicos).toBeUndefined()
      // The answer says what failed in the app's words and never repeats what the database said.
      expect(body.error).toBe("Error al obtener técnicos")
      expect(texto).not.toContain("connection lost")
      expect(texto).not.toContain("XX000")
    })
  })
})

// ---------------------------------------------------------------------------------------------
describe("the open-order counts of the technician screens follow the viewer's scope (OI-1, SC-3, BM-5)", () => {
  /** t-a holds a2 (A) and b2 (B), both open; t-b holds a3 (A) and b3 (B), both finished. */
  async function listaDeCuentas(e: Espectador) {
    entrar(e)
    montar()
    const { status, body } = await parseResponse(await listar(new Request("http://localhost:3000/api/tecnicos")))
    expect(status).toBe(200)
    return Object.fromEntries((body as Array<{ id: string; ordenesActivas: number; ordenesCompletadas: number }>).map((t) => [t.id, [t.ordenesActivas, t.ordenesCompletadas]]))
  }

  // The list of a branch is the list of ITS technicians; the count of each is the orders that scope handles.
  it.each(
    conNombre<[Record<string, number[]>]>([
      [ADMIN_TODAS, { "t-a": [2, 0], "t-b": [0, 2] }],
      [ADMIN_A, { "t-a": [1, 0], "t-a2": [0, 0] }],
      [ADMIN_B, { "t-b": [0, 1], "t-b2": [0, 0] }],
    ]),
  )("the list for %s counts the orders that scope handles", async (_nombre, espectador, esperado) => {
    expect(await listaDeCuentas(espectador)).toMatchObject(esperado)
  })

  it("a scope narrows the count of a technician, not who is in the list", async () => {
    expect(Object.keys(await listaDeCuentas(ADMIN_A)).sort()).toEqual(["t-a", "t-a2", "t-inactivo"])
    expect(Object.keys(await listaDeCuentas(ADMIN_TODAS)).sort()).toEqual(["t-a", "t-a2", "t-b", "t-b2", "t-inactivo"])
  })

  async function detalleDe(e: Espectador, id: string) {
    entrar(e)
    montar()
    const { status, body } = await parseResponse(await detalle(get(id), ctx(id)))
    expect(status).toBe(200)
    return [body.ordenesActivas, body.ordenesCompletadas]
  }

  it.each(
    conNombre([
      [ADMIN_TODAS, [2, 0]],
      [ADMIN_A, [1, 0]],
      [ADMIN_B, [1, 0]],
    ]),
  )("the detail of t-a for %s: the number the reassign dialog shows is the one that moves", async (_nombre, espectador, esperado) => {
    expect(await detalleDe(espectador, "t-a")).toEqual(esperado)
  })

  it("the technician himself sees all his open orders, whatever the stored choice of a branch (BM-6)", async () => {
    expect(await detalleDe(TECNICO_A, "t-a")).toEqual([2, 0])
    expect(await detalleDe({ ...TECNICO_A, cookie: B }, "t-a")).toEqual([2, 0])
  })

  it("the counts of the branches add up to Todas (SC-4)", async () => {
    for (const id of ["t-a", "t-b"]) {
      const [a, b, todas] = [await detalleDe(ADMIN_A, id), await detalleDe(ADMIN_B, id), await detalleDe(ADMIN_TODAS, id)]
      expect(Number(a[0]) + Number(b[0])).toBe(todas[0])
      expect(Number(a[1]) + Number(b[1])).toBe(todas[1])
    }
  })

  async function cambiarActivo(e: Espectador, id: string, activo: boolean) {
    entrar(e)
    montar()
    const res = await estado(
      new Request(`http://localhost:3000/api/tecnicos/${id}/estado`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activo }),
      }),
      ctx(id),
    )
    const { status, body } = await parseResponse(res)
    expect(status).toBe(200)
    return body as { ordenesActivas: number; warning: string | null }
  }

  // Deactivating a technician is a GLOBAL write: the warning counts every open order he holds, in every
  // branch, and says which part belongs to the scope the ADMIN works in (what a reassignment would move).
  it.each(
    conNombre<[string]>([
      [ADMIN_TODAS, "El técnico tiene 2 orden(es) activa(s). Considerá reasignarlas."],
      [ADMIN_A, "El técnico tiene 2 orden(es) activa(s) (1 de esta sucursal y 1 de otras). Considerá reasignarlas: las de otras sucursales se mueven eligiendo esa sucursal en el selector."],
      [ADMIN_B, "El técnico tiene 2 orden(es) activa(s) (1 de esta sucursal y 1 de otras). Considerá reasignarlas: las de otras sucursales se mueven eligiendo esa sucursal en el selector."],
    ]),
  )("deactivating t-a as %s counts all his open orders and says where they are", async (_nombre, espectador, aviso) => {
    const { ordenesActivas, warning } = await cambiarActivo(espectador, "t-a", false)
    expect(ordenesActivas).toBe(2)
    expect(warning).toBe(aviso)
  })

  it("reactivating gives no warning, whatever he holds", async () => {
    expect((await cambiarActivo(ADMIN_B, "t-a", true)).warning).toBeNull()
  })
})

// ---------------------------------------------------------------------------------------------
describe("a technician of one branch who holds the open orders of another (jed-electronics): what gates a global action is global", () => {
  // t-jed belongs to San Justo (B) and holds SEVEN open orders of Tablada (A).
  const ordenesJed = () => Array.from({ length: 7 }, (_, i) => orden(`j${i + 1}`, A, "t-jed"))

  function montarJed() {
    // ...plus an order of ANOTHER organization under the same technician id, and a finished one of his: neither counts.
    const ajena = { ...orden("x-otra-org", A, "t-jed"), organization_id: "org-2" }
    const terminada = orden("x-terminada", A, "t-jed", "REPARADO")
    return mundo([...ORDENES(), ...ordenesJed(), ajena, terminada], [{ id: "t-jed", sucursal: B }])
  }

  async function desactivar(e: Espectador) {
    entrar(e)
    const memoria = montarJed()
    const res = await estado(
      new Request("http://localhost:3000/api/tecnicos/t-jed/estado", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activo: false }),
      }),
      ctx("t-jed"),
    )
    const { status, body } = await parseResponse(res)
    expect(status).toBe(200)
    return { ...(body as { ordenesActivas: number; warning: string | null }), memoria }
  }

  async function detalleJed(e: Espectador) {
    entrar(e)
    montarJed()
    const { status, body } = await parseResponse(await detalle(get("t-jed"), ctx("t-jed")))
    expect(status).toBe(200)
    return body as { ordenesActivas: number; ordenesActivasTotal: number }
  }

  it("an ADMIN on his own branch (San Justo) is warned of the seven orders, which all belong to another branch", async () => {
    const { ordenesActivas, warning } = await desactivar(ADMIN_B)
    expect(ordenesActivas).toBe(7)
    expect(warning).toBe(
      "El técnico tiene 7 orden(es) activa(s), todas de otras sucursales. Considerá reasignarlas: las de otras sucursales se mueven eligiendo esa sucursal en el selector.",
    )
  })

  it("an ADMIN on Tablada, where they are handled, and on Todas get the plain warning", async () => {
    for (const espectador of [ADMIN_A, ADMIN_TODAS]) {
      const { ordenesActivas, warning } = await desactivar(espectador)
      expect(ordenesActivas, espectador.nombre).toBe(7)
      expect(warning, espectador.nombre).toBe("El técnico tiene 7 orden(es) activa(s). Considerá reasignarlas.")
    }
  })

  it("the detail carries what a reassignment moves (this scope) AND the total that gates deactivating and deleting him", async () => {
    expect(await detalleJed(ADMIN_B)).toMatchObject({ ordenesActivas: 0, ordenesActivasTotal: 7 })
    expect(await detalleJed(ADMIN_A)).toMatchObject({ ordenesActivas: 7, ordenesActivasTotal: 7 })
    expect(await detalleJed(ADMIN_TODAS)).toMatchObject({ ordenesActivas: 7, ordenesActivasTotal: 7 })
  })

  it("the technician himself: his count and the total are the same, everything assigned to him (BM-6)", async () => {
    expect(await detalleJed({ nombre: "t-jed himself", role: "TECNICO", userId: "t-jed", sucursalId: B })).toMatchObject({ ordenesActivas: 7, ordenesActivasTotal: 7 })
  })

  it("the list carries the total next to the scoped count, so the delete guard never lets him go with work elsewhere", async () => {
    entrar(ADMIN_B)
    montarJed()
    const { body } = await parseResponse(await listar(new Request("http://localhost:3000/api/tecnicos")))
    const jed = (body as Array<{ id: string; ordenesActivas: number; ordenesActivasTotal: number }>).find((t) => t.id === "t-jed")
    expect(jed).toMatchObject({ ordenesActivas: 0, ordenesActivasTotal: 7 })
  })

  it("only an ADMIN gets the total: anyone else sees the scoped count and nothing about the other branches", async () => {
    entrar({ nombre: "VENDEDOR of B", role: "VENDEDOR", userId: "v-b", sucursalId: B })
    montarJed()
    const { body } = await parseResponse(await listar(new Request("http://localhost:3000/api/tecnicos")))
    const jed = (body as Array<{ id: string; ordenesActivas: number; ordenesActivasTotal: number }>).find((t) => t.id === "t-jed")
    expect(jed).toMatchObject({ ordenesActivas: 0, ordenesActivasTotal: 0 })
  })

  it("an ADMIN on Todas reads the same number twice, with no extra read of the orders", async () => {
    entrar(ADMIN_TODAS)
    const memoria = montarJed()
    await parseResponse(await listar(new Request("http://localhost:3000/api/tecnicos")))
    expect(memoria.lecturas.filter((t) => t === "ordenes_servicio")).toHaveLength(0)
  })

  it("deleting him is refused for the ADMIN of any branch while he holds open orders anywhere, and nothing is deleted", async () => {
    for (const espectador of [ADMIN_B, ADMIN_A, ADMIN_TODAS]) {
      entrar(espectador)
      const memoria = montarJed()
      const res = await eliminar(new Request("http://localhost:3000/api/tecnicos/t-jed", { method: "DELETE" }), ctx("t-jed"))
      expect(res.status, espectador.nombre).toBe(400)
      expect(memoria.escrituras.filter((x) => x.tabla === "users"), espectador.nombre).toEqual([])
    }
  })

  it("a technician that cannot be read is not deactivated: the warning is never skipped because a read failed", async () => {
    entrar(ADMIN_B)
    const memoria = montarSupabaseEnMemoria(
      { ordenes_servicio: ORDENES(), users: USUARIOS, organizations: [{ id: "org-1", vendedores_administran_inventario: false }] },
      { errorDeLectura: { users: { code: "XX000", message: "connection lost" } } },
    )
    const res = await estado(
      new Request("http://localhost:3000/api/tecnicos/t-a/estado", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activo: false }) }),
      ctx("t-a"),
    )
    // The route answers a read that failed like a technician that does not exist (as it always has): 404, and no write.
    expect(res.status).toBe(404)
    expect(memoria.escrituras.filter((x) => x.tabla === "users")).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------------
describe("the total that gates a global action comes WITH the technician, not from a read of one row per open order", () => {
  // A read of rows is cut at PostgREST's max-rows (1000) without an error, and a technician whose orders come
  // after the cut would show zero (and the list would offer to delete him). An embed is cut too, but per parent
  // (see the next describe), so the total is read from an embed of the technician's own open orders.
  const MAX_FILAS = 1000
  const abiertas = (cuantas: number, sucursal: string, tecnico: string, prefijo: string) =>
    Array.from({ length: cuantas }, (_, i) => orden(`${prefijo}${i + 1}`, sucursal, tecnico))

  /** 1000 open orders of t-b2 come first in the table, then the ones of t-jed (San Justo, holding orders of Tablada). */
  function mundoGrande(deJed: number) {
    const ordenes = [...ORDENES(), ...abiertas(MAX_FILAS, B, "t-b2", "m"), ...abiertas(deJed, A, "t-jed", "j")]
    return mundo(ordenes, [{ id: "t-jed", sucursal: B }], { maxFilas: MAX_FILAS })
  }

  const totales = async (e: Espectador) => {
    entrar(e)
    mundoGrande(3)
    const { status, body } = await parseResponse(await listar(new Request("http://localhost:3000/api/tecnicos")))
    expect(status).toBe(200)
    return Object.fromEntries((body as Array<{ id: string; ordenesActivasTotal: number }>).map((t) => [t.id, t.ordenesActivasTotal]))
  }

  it("the list shows the real total of every technician, whatever comes after the first thousand open orders", async () => {
    expect(await totales(ADMIN_B)).toMatchObject({ "t-b2": MAX_FILAS, "t-jed": 3, "t-b": 0 })
    expect(await totales(ADMIN_A)).toMatchObject({ "t-a": 2, "t-a2": 0 })
  })

  it.each([
    ["the list", async () => listar(new Request("http://localhost:3000/api/tecnicos"))],
    ["the list for the order form (?alcance=escritura)", async () => listar(new Request("http://localhost:3000/api/tecnicos?alcance=escritura"))],
    ["the detail", async () => detalle(get("t-jed"), ctx("t-jed"))],
    [
      "deactivating",
      async () =>
        estado(
          new Request("http://localhost:3000/api/tecnicos/t-jed/estado", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activo: false }) }),
          ctx("t-jed"),
        ),
    ],
  ])("%s reads no row of the orders table: the counts come with the technician", async (_que, pedir) => {
    entrar(ADMIN_B)
    const memoria = mundoGrande(7)
    expect((await pedir()).status).toBe(200)
    expect(memoria.lecturas).toContain("users")
    expect(memoria.lecturas).not.toContain("ordenes_servicio")
  })

  // The counts are embeds of the technician's own row, so the orders are read by the SAME request. If they cannot
  // be read, that request fails: a count that could not be read is an error, never zero.
  it("orders that cannot be read fail the technician list and the detail: no count is made up", async () => {
    for (const pedir of [
      () => listar(new Request("http://localhost:3000/api/tecnicos")),
      () => listar(new Request("http://localhost:3000/api/tecnicos?alcance=escritura")),
      () => detalle(get("t-a"), ctx("t-a")),
    ]) {
      entrar(ADMIN_B)
      montarSupabaseEnMemoria(
        { ordenes_servicio: ORDENES(), users: USUARIOS, organizations: [{ id: "org-1", vendedores_administran_inventario: false }] },
        { errorDeLectura: { ordenes_servicio: { code: "XX000", message: "connection lost" } } },
      )
      const res = await pedir()
      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(await res.text()).not.toContain("connection lost")
    }
  })

  it("orders that cannot be read stop a deactivation, and nothing is written", async () => {
    entrar(ADMIN_B)
    const memoria = montarSupabaseEnMemoria(
      { ordenes_servicio: ORDENES(), users: USUARIOS, organizations: [{ id: "org-1", vendedores_administran_inventario: false }] },
      { errorDeLectura: { ordenes_servicio: { code: "XX000", message: "connection lost" } } },
    )
    const res = await estado(
      new Request("http://localhost:3000/api/tecnicos/t-a/estado", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activo: false }) }),
      ctx("t-a"),
    )
    expect(res.status).toBe(404)
    expect(memoria.escrituras.filter((x) => x.tabla === "users")).toEqual([])
  })

  it("orders that cannot be read stop a delete, and nothing is deleted", async () => {
    entrar(ADMIN_B)
    const memoria = montarSupabaseEnMemoria(
      { ordenes_servicio: ORDENES(), users: USUARIOS, organizations: [{ id: "org-1", vendedores_administran_inventario: false }] },
      { errorDeLectura: { ordenes_servicio: { code: "XX000", message: "connection lost" } } },
    )
    const res = await eliminar(new Request("http://localhost:3000/api/tecnicos/t-a2", { method: "DELETE" }), ctx("t-a2"))
    expect(res.status).toBe(404)
    expect(memoria.escrituras.filter((x) => x.tabla === "users")).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------------
describe("an embed is cut per parent too (db-max-rows): the counts that gate an action are filtered by state, far below the cap", () => {
  // PostgREST applies max-rows to every node of the read plan, so a to-many embed gets a LIMIT per parent. An
  // embed of ALL the orders a technician ever held (jed-electronics has old accounts) loses the open ones that
  // come after the first thousand. Every embed that counts open orders asks for open orders only.
  const MAX_FILAS = 1000

  /** t-jed (San Justo) holds 1200 old finished orders of Tablada, first in the table, and then `abiertas` open ones. */
  function mundoViejo(abiertas = 3) {
    const viejas = Array.from({ length: MAX_FILAS + 200 }, (_, i) => orden(`v${i + 1}`, A, "t-jed", "ENTREGADO"))
    const nuevas = Array.from({ length: abiertas }, (_, i) => orden(`j${i + 1}`, A, "t-jed"))
    return mundo([...ORDENES(), ...viejas, ...nuevas], [{ id: "t-jed", sucursal: B }], { maxFilas: MAX_FILAS })
  }

  const pedirEstado = (activo: boolean) =>
    estado(
      new Request("http://localhost:3000/api/tecnicos/t-jed/estado", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activo }) }),
      ctx("t-jed"),
    )

  it("the list counts the open orders of a technician with more than a thousand old ones, in every scope", async () => {
    for (const [espectador, esperado] of [
      [ADMIN_TODAS, { ordenesActivas: 3, ordenesActivasTotal: 3 }],
      [ADMIN_B, { ordenesActivas: 0, ordenesActivasTotal: 3 }],
    ] as Array<[Espectador, { ordenesActivas: number; ordenesActivasTotal: number }]>) {
      entrar(espectador)
      mundoViejo()
      const { status, body } = await parseResponse(await listar(new Request("http://localhost:3000/api/tecnicos")))
      expect(status).toBe(200)
      expect((body as Array<{ id: string }>).find((t) => t.id === "t-jed"), espectador.nombre).toMatchObject(esperado)
    }
  })

  it("the detail does too, and so does the total that an ADMIN on Todas reads", async () => {
    for (const [espectador, esperado] of [
      [ADMIN_TODAS, { ordenesActivas: 3, ordenesActivasTotal: 3 }],
      [ADMIN_A, { ordenesActivas: 3, ordenesActivasTotal: 3 }],
      [ADMIN_B, { ordenesActivas: 0, ordenesActivasTotal: 3 }],
    ] as Array<[Espectador, { ordenesActivas: number; ordenesActivasTotal: number }]>) {
      entrar(espectador)
      mundoViejo()
      const { status, body } = await parseResponse(await detalle(get("t-jed"), ctx("t-jed")))
      expect(status).toBe(200)
      expect(body, espectador.nombre).toMatchObject(esperado)
    }
  })

  it("the deactivation warns about the open orders, where they are", async () => {
    const plano = "El técnico tiene 3 orden(es) activa(s). Considerá reasignarlas."
    const otras =
      "El técnico tiene 3 orden(es) activa(s), todas de otras sucursales. Considerá reasignarlas: las de otras sucursales se mueven eligiendo esa sucursal en el selector."
    for (const [espectador, aviso] of [
      [ADMIN_TODAS, plano],
      [ADMIN_A, plano],
      [ADMIN_B, otras],
    ] as Array<[Espectador, string]>) {
      entrar(espectador)
      mundoViejo()
      const { status, body } = await parseResponse(await pedirEstado(false))
      expect(status).toBe(200)
      expect(body, espectador.nombre).toMatchObject({ ordenesActivas: 3, warning: aviso })
    }
  })

  it("deleting him is refused while he holds open orders behind a thousand old ones, and nothing is deleted", async () => {
    for (const espectador of [ADMIN_TODAS, ADMIN_A, ADMIN_B]) {
      entrar(espectador)
      const memoria = mundoViejo(2)
      const res = await eliminar(new Request("http://localhost:3000/api/tecnicos/t-jed", { method: "DELETE" }), ctx("t-jed"))
      expect(res.status, espectador.nombre).toBe(400)
      expect(memoria.escrituras.filter((x) => x.tabla === "users"), espectador.nombre).toEqual([])
    }
  })

  it("the orders he finished are no open orders: the warning splits only the open ones between this scope and the others", async () => {
    // t-m holds an open order of A, an open order of B and a finished one of A.
    const mundoMixto = () =>
      mundo([...ORDENES(), orden("m1", A, "t-m"), orden("m2", B, "t-m"), orden("m3", A, "t-m", "ENTREGADO")], [{ id: "t-m", sucursal: A }])
    entrar(ADMIN_A)
    mundoMixto()
    const res = await estado(
      new Request("http://localhost:3000/api/tecnicos/t-m/estado", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activo: false }) }),
      ctx("t-m"),
    )
    expect((await parseResponse(res)).body).toMatchObject({
      ordenesActivas: 2,
      warning:
        "El técnico tiene 2 orden(es) activa(s) (1 de esta sucursal y 1 de otras). Considerá reasignarlas: las de otras sucursales se mueven eligiendo esa sucursal en el selector.",
    })

    mundoMixto()
    const lista = await parseResponse(await listar(new Request("http://localhost:3000/api/tecnicos")))
    expect((lista.body as Array<{ id: string }>).find((t) => t.id === "t-m")).toMatchObject({ ordenesActivas: 1, ordenesActivasTotal: 2, ordenesCompletadas: 1 })
  })

  it("a technician who only holds finished orders can be deleted: the guard counts open orders, not every order", async () => {
    entrar(ADMIN_TODAS)
    const memoria = montar()
    // t-b holds a3 and b3, both finished.
    const res = await eliminar(new Request("http://localhost:3000/api/tecnicos/t-b", { method: "DELETE" }), ctx("t-b"))
    expect(res.status).toBe(200)
    expect(memoria.escrituras.filter((x) => x.tabla === "users" && x.operacion === "delete")).toHaveLength(1)
  })

  it("the finished-orders count of a card is a display figure: it stops at the cap, and never hides an open order", async () => {
    entrar(ADMIN_TODAS)
    mundoViejo()
    const { body } = await parseResponse(await listar(new Request("http://localhost:3000/api/tecnicos")))
    const jed = (body as Array<{ id: string; ordenesCompletadas: number; ordenesActivas: number }>).find((t) => t.id === "t-jed")!
    expect(jed.ordenesCompletadas).toBe(MAX_FILAS)
    expect(jed.ordenesActivas).toBe(3)
  })

  // The total is read only by the screens that need it (an ADMIN's): the pickers and everyone else carry less.
  function montarParaSelect() {
    return mundo([...ORDENES(), ...Array.from({ length: 2 }, (_, i) => orden(`j${i + 1}`, A, "t-jed"))], [{ id: "t-jed", sucursal: B }])
  }
  const llevaElTotal = (memoria: ReturnType<typeof montarParaSelect>) => memoria.consultas("users").join(" ").includes("activas_totales:")
  const VENDEDOR_B: Espectador = { nombre: "VENDEDOR of B", role: "VENDEDOR", userId: "v-b", sucursalId: B }
  const TECNICO_B: Espectador = { nombre: "TECNICO of B", role: "TECNICO", userId: "t-b", sucursalId: B }

  it.each([
    ["an ADMIN's list", true, ADMIN_B, "http://localhost:3000/api/tecnicos"],
    ["an ADMIN's list on Todas", true, ADMIN_TODAS, "http://localhost:3000/api/tecnicos"],
    ["the order form's picker of an ADMIN", true, ADMIN_B, "http://localhost:3000/api/tecnicos?alcance=escritura"],
    ["the destination picker of a bulk move (?paraReasignarDe)", false, ADMIN_B, "http://localhost:3000/api/tecnicos?paraReasignarDe=t-jed"],
    ["a seller's list", false, VENDEDOR_B, "http://localhost:3000/api/tecnicos"],
    ["the list of a technician", false, TECNICO_B, "http://localhost:3000/api/tecnicos"],
  ])("%s: the select carries the embed of the total = %s", async (_que, lleva, espectador, url) => {
    entrar(espectador)
    const memoria = montarParaSelect()
    expect((await listar(new Request(url))).status).toBe(200)
    expect(llevaElTotal(memoria)).toBe(lleva)
  })

  it("the detail of the technician himself does not carry it either, the one of an ADMIN does", async () => {
    entrar({ nombre: "t-jed himself", role: "TECNICO", userId: "t-jed", sucursalId: B })
    const propio = montarParaSelect()
    expect((await detalle(get("t-jed"), ctx("t-jed"))).status).toBe(200)
    expect(llevaElTotal(propio)).toBe(false)

    entrar(ADMIN_B)
    const deAdmin = montarParaSelect()
    expect((await detalle(get("t-jed"), ctx("t-jed"))).status).toBe(200)
    expect(llevaElTotal(deAdmin)).toBe(true)
  })

  it("the deactivation, an ADMIN's only action, always reads it", async () => {
    entrar(ADMIN_B)
    const memoria = montarParaSelect()
    expect((await pedirEstado(false)).status).toBe(200)
    expect(llevaElTotal(memoria)).toBe(true)
  })
})
