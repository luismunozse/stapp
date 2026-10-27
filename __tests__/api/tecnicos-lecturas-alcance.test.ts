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
  ordenes_servicio: [],
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
  async function ofrecidos(e: Espectador, origen: string, ordenes = ORDENES()) {
    entrar(e)
    montarSupabaseEnMemoria({ ordenes_servicio: ordenes, users: USUARIOS, organizations: [{ id: "org-1", vendedores_administran_inventario: false }] })
    const { status, body } = await parseResponse(await listar(new Request(`http://localhost:3000/api/tecnicos?paraReasignarDe=${origen}`)))
    expect(status).toBe(200)
    return (body as Array<{ id: string }>).map((t) => t.id).sort()
  }

  it("with a branch selected: the technicians of the branch that handles the orders to move", async () => {
    expect(await ofrecidos(ADMIN_A, "t-a")).toEqual(["t-a", "t-a2", "t-inactivo"])
    expect(await ofrecidos(ADMIN_B, "t-a")).toEqual(["t-b", "t-b2"])
  })

  it("on Todas, orders of ONE branch: that branch's technicians (what the route will accept)", async () => {
    const ordenes = ORDENES()
    ordenes.push(orden("a4", A, "t-a2"))
    expect(await ofrecidos(ADMIN_TODAS, "t-a2", ordenes)).toEqual(["t-a", "t-a2", "t-inactivo"])
  })

  it("the technician of A who holds an order of B: the picker offers B's technicians, the ones the route accepts", async () => {
    const ordenes = ORDENES().filter((o) => o.id !== "a2") // t-a keeps only b2
    expect(await ofrecidos(ADMIN_TODAS, "t-a", ordenes)).toEqual(["t-b", "t-b2"])
  })

  it("on Todas, orders of SEVERAL branches: nobody can take them all, so nobody is offered", async () => {
    expect(await ofrecidos(ADMIN_TODAS, "t-a")).toEqual([])
  })

  it("a technician with no open orders: the list the request's own scope gives", async () => {
    expect(await ofrecidos(ADMIN_TODAS, "t-b2")).toEqual(["t-a", "t-a2", "t-b", "t-b2", "t-inactivo"])
    expect(await ofrecidos(ADMIN_B, "t-b2")).toEqual(["t-b", "t-b2"])
  })

  it("only an ADMIN's list changes: anyone else keeps his own branch's list and the parameter does nothing", async () => {
    expect(await ofrecidos({ ...TECNICO_A, nombre: "t-a" }, "t-b")).toEqual(["t-a", "t-a2", "t-inactivo"])
  })
})
