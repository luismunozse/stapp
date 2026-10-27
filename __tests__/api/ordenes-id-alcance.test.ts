// @vitest-environment node
/**
 * The order detail routes answer within the caller's scope (change sucursales-aislamiento, PR3;
 * XC-1, XC-2, OI-1, OI-2, BM-6). GET, PUT and DELETE of /api/ordenes/[id]:
 *
 *  - an order of another branch answers EXACTLY what a nonexistent id answers (404, same body) to a
 *    VENDEDOR or a TECNICO, and the request writes, notifies and reads nothing else;
 *  - an order of the caller's branch that the role may not touch stays 403, as it was;
 *  - an ADMIN reaches every order of the organization, whatever branch the screen has selected;
 *  - a TECNICO keeps the orders assigned to him whatever their branch (jed-electronics);
 *  - in an org with one branch nothing changes.
 *
 * The tables are in-memory and honour their filters: a route that scopes wrongly returns the wrong
 * rows. Every write is recorded, so "nothing happened" is asserted, not assumed.
 */
import { describe, it, expect, vi } from "vitest"
import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { mockAuthSuccess, parseResponse } from "./helpers"
import { montarSupabaseEnMemoria } from "../helpers/supabase-memoria"
import { conSucursalVigente } from "@/lib/sesion-sucursal"

const auditoria = vi.hoisted(() => ({
  update: vi.fn().mockResolvedValue(undefined),
  delete: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/audit", () => ({
  createAuditLogger: vi.fn(() => auditoria),
  diffObjects: vi.fn().mockReturnValue({ before: {}, after: {} }),
}))
vi.mock("@/lib/notifications/queue", () => ({ queueNotification: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/webhooks/dispatcher", () => ({ emitWebhookEvent: vi.fn().mockResolvedValue(undefined) }))

import { GET, PUT, DELETE } from "@/app/api/ordenes/[id]/route"
import { createAuditLogger } from "@/lib/audit"
import { queueNotification } from "@/lib/notifications/queue"
import { emitWebhookEvent } from "@/lib/webhooks/dispatcher"
import { rejectIfPractica } from "@/lib/onboarding/practica"
import { ORDEN_PRACTICA_ERROR } from "@/lib/onboarding/practica-shared"

const A = "suc-A"
const B = "suc-B"

function orden(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    organization_id: "org-1",
    numero_orden: 11,
    sucursal_id: A,
    tecnico_id: null,
    estado: "RECIBIDO",
    presupuesto: null,
    costo_final: null,
    total_cobrado: 0,
    descuento_cobro: 0,
    diagnostico: null,
    public_token: "tok",
    dispositivo: "iPhone",
    fecha_completado: null,
    clientes: { id: "c-1", nombre: "Juan", email: null, telefono: null },
    users: null,
    recibido: null,
    repuestos_orden: [],
    servicios_orden: [],
    notas_credito: [],
    cotizaciones: [],
    garantias: [],
    recepciones: null,
    organizations: { id: "org-1", nombre: "Taller", slug: "taller", moneda: "ARS", zona_horaria: "America/Argentina/Buenos_Aires" },
    ...extra,
  }
}

const ORDENES = [
  orden("o-a-libre"),
  orden("o-a-t1", { tecnico_id: "t-1" }),
  orden("o-a-t2", { tecnico_id: "t-2" }),
  orden("o-b-libre", { sucursal_id: B }),
  orden("o-b-t1", { sucursal_id: B, tecnico_id: "t-1" }),
  orden("o-b-t2", { sucursal_id: B, tecnico_id: "t-2" }),
]

const USUARIOS = [
  { id: "t-1", rol: "TECNICO", sucursal_id: A, organization_id: "org-1", porcentaje_comision: 10, costo_hora: 100 },
  { id: "t-b", rol: "TECNICO", sucursal_id: B, organization_id: "org-1", porcentaje_comision: 10, costo_hora: 100 },
]

interface Montaje {
  role: string
  userId?: string
  sucursalId?: string | null
  toma?: boolean
  /** The branch an ADMIN has selected in the screen (the cookie). */
  cookie?: string | null
  ordenes?: Array<Record<string, unknown>>
}

function montar({ role, userId = "u-1", sucursalId = null, toma = false, cookie = null, ordenes = ORDENES }: Montaje) {
  vi.clearAllMocks()
  mockAuthSuccess({ role, userId, sucursalId })
  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn((nombre: string) => (nombre === "stapp-sucursal-activa" && cookie ? { value: cookie } : undefined)),
    set: vi.fn(),
  } as any)
  return montarSupabaseEnMemoria(
    {
      ordenes_servicio: ordenes,
      users: USUARIOS,
      organizations: [{ id: "org-1", tecnicos_toman_ordenes: toma, vendedores_administran_inventario: false }],
      orden_eventos: [],
    },
    {
      // What an update answers: the order with the change applied.
      resultadoEscritura: ({ tabla, operacion, carga }) =>
        tabla === "ordenes_servicio" && operacion === "update" ? { ...orden("o-a-libre"), ...(carga as object) } : carga,
    },
  )
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const get = (id: string) => GET(new Request(`http://localhost:3000/api/ordenes/${id}`), ctx(id))
const put = (id: string, cuerpo: Record<string, unknown>) =>
  PUT(
    new Request(`http://localhost:3000/api/ordenes/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    }),
    ctx(id),
  )
const borrar = (id: string) => DELETE(new Request(`http://localhost:3000/api/ordenes/${id}`, { method: "DELETE" }), ctx(id))

const NO_ENCONTRADA = { status: 404, body: { error: "Orden no encontrada" } }

/** Nothing was told to anybody: no audit entry, no client notification, no webhook. */
function nadieSeEntero() {
  expect(createAuditLogger).not.toHaveBeenCalled()
  expect(queueNotification).not.toHaveBeenCalled()
  expect(emitWebhookEvent).not.toHaveBeenCalled()
}

// Who must not reach an order of another branch, and the order each one asks for.
const FUERA_DE_ALCANCE: Array<[string, Montaje, string]> = [
  ["a VENDEDOR of A, an order of B", { role: "VENDEDOR", userId: "v-a", sucursalId: A }, "o-b-libre"],
  ["a VENDEDOR of A, an order of B assigned to a technician", { role: "VENDEDOR", userId: "v-a", sucursalId: A }, "o-b-t2"],
  ["a TECNICO of A, an unassigned order of B (toma ON)", { role: "TECNICO", userId: "t-1", sucursalId: A, toma: true }, "o-b-libre"],
  ["a TECNICO of A, an order of B assigned to a colleague", { role: "TECNICO", userId: "t-1", sucursalId: A }, "o-b-t2"],
  ["a VENDEDOR with no branch", { role: "VENDEDOR", userId: "v-0", sucursalId: null }, "o-a-libre"],
  ["a TECNICO with no branch, an order he does not have", { role: "TECNICO", userId: "t-1", sucursalId: null, toma: true }, "o-a-libre"],
]

describe("GET /api/ordenes/[id]", () => {
  describe.each(FUERA_DE_ALCANCE)("%s", (_quien, montaje, id) => {
    it("answers what a nonexistent id answers, and reads nothing else", async () => {
      const mem = montar(montaje)

      const inexistente = await parseResponse(await get("no-existe"))
      const fuera = await parseResponse(await get(id))

      expect(inexistente).toEqual(NO_ENCONTRADA)
      expect(fuera).toEqual(inexistente)
      expect(mem.escrituras).toEqual([])
      expect(mem.lecturas).not.toContain("orden_eventos")
    })
  })

  it("an ADMIN reaches an order of any branch, whatever branch the screen has selected", async () => {
    montar({ role: "ADMIN", userId: "adm", cookie: A })

    const { status, body } = await parseResponse(await get("o-b-libre"))

    expect(status).toBe(200)
    expect(body.id).toBe("o-b-libre")
    expect(body.sucursalAtiendeId).toBe(B)
  })

  it("a VENDEDOR reads the orders of his branch, assigned or not", async () => {
    montar({ role: "VENDEDOR", userId: "v-a", sucursalId: A })

    for (const id of ["o-a-libre", "o-a-t1", "o-a-t2"]) {
      const { status, body } = await parseResponse(await get(id))
      expect(status, id).toBe(200)
      expect(body.id).toBe(id)
    }
  })

  it("a TECNICO reads the orders assigned to him whatever their branch (BM-6, jed-electronics)", async () => {
    montar({ role: "TECNICO", userId: "t-1", sucursalId: "suc-SJ" })

    const { status, body } = await parseResponse(await get("o-b-t1"))

    expect(status).toBe(200)
    expect(body.id).toBe("o-b-t1")
    expect(body.sucursalAtiendeId).toBe(B)
  })

  it("a TECNICO of the branch opening a colleague's order stays 403, as before", async () => {
    montar({ role: "TECNICO", userId: "t-1", sucursalId: A })

    const { status, body } = await parseResponse(await get("o-a-t2"))

    expect(status).toBe(403)
    expect(body).toEqual({ error: "No autorizado" })
  })

  it.each([
    [true, 200, true],
    [false, 403, undefined],
  ])("a TECNICO opening an unassigned order of his branch, toma %s, is %s", async (toma, esperado, puedeTomar) => {
    montar({ role: "TECNICO", userId: "t-1", sucursalId: A, toma })

    const { status, body } = await parseResponse(await get("o-a-libre"))

    expect(status).toBe(esperado)
    if (puedeTomar !== undefined) expect(body.puedeTomar).toBe(puedeTomar)
  })

  it("keeps what the detail says about the handling branch and the technician picker", async () => {
    montar({ role: "VENDEDOR", userId: "v-a", sucursalId: A })

    const { body } = await parseResponse(await get("o-a-t1"))

    expect(body.sucursalAtiendeId).toBe(A)
    expect(body.puedeAsignarTecnico).toBe(true)
  })

  it("scopes by the branch requireAuth just re-read, not the one in the JWT", async () => {
    montar({ role: "VENDEDOR", userId: "v-a", sucursalId: A })
    // The user was moved to B after the JWT was issued: the fresh session says B.
    const movido = async (sesion: any) => ({ ...sesion, user: { ...sesion.user, sucursalId: B } })

    vi.mocked(conSucursalVigente).mockImplementationOnce(movido)
    expect(await parseResponse(await get("o-a-libre"))).toEqual(NO_ENCONTRADA)

    vi.mocked(conSucursalVigente).mockImplementationOnce(movido)
    const { status, body } = await parseResponse(await get("o-b-libre"))
    expect(status).toBe(200)
    expect(body.id).toBe("o-b-libre")
  })

  it("an org with one branch: every role gets what it always got", async () => {
    const unaSucursal = ORDENES.filter((o) => o.sucursal_id === A)

    montar({ role: "VENDEDOR", userId: "v-a", sucursalId: A, ordenes: unaSucursal })
    expect((await parseResponse(await get("o-a-t2"))).status).toBe(200)

    montar({ role: "TECNICO", userId: "t-1", sucursalId: A, ordenes: unaSucursal })
    expect((await parseResponse(await get("o-a-t1"))).status).toBe(200)
    expect((await parseResponse(await get("o-a-t2"))).status).toBe(403)
    expect((await parseResponse(await get("no-existe"))).status).toBe(404)

    montar({ role: "ADMIN", userId: "adm", ordenes: unaSucursal })
    expect((await parseResponse(await get("o-a-t2"))).status).toBe(200)
  })
})

describe("PUT /api/ordenes/[id]", () => {
  describe.each(FUERA_DE_ALCANCE)("%s", (_quien, montaje, id) => {
    it.each([
      ["a plain field", { observaciones: "Llamar al cliente" }],
      ["a status change", { estado: "EN_DIAGNOSTICO" }],
      ["an assignment", { tecnicoId: "t-b" }],
    ])("%s answers what a nonexistent id answers; nothing is written or sent", async (_cambio, cuerpo) => {
      const mem = montar(montaje)

      const inexistente = await parseResponse(await put("no-existe", cuerpo))
      const fuera = await parseResponse(await put(id, cuerpo))

      expect(inexistente).toEqual(NO_ENCONTRADA)
      expect(fuera).toEqual(inexistente)
      expect(mem.escrituras).toEqual([])
      // The assignment lookup would be the next read: it must not happen for an order out of scope.
      expect(mem.lecturas).not.toContain("users")
      nadieSeEntero()
    })
  })

  // The practice order check also looks the order up by id: it must not answer before the scope does.
  it("the practice order guard does not tell an order of another branch apart from a missing one", async () => {
    const mem = montar({ role: "VENDEDOR", userId: "v-a", sucursalId: A })
    // Every order is a practice order here.
    vi.mocked(rejectIfPractica).mockImplementation(async () => NextResponse.json(ORDEN_PRACTICA_ERROR, { status: 409 }))

    try {
      expect(await parseResponse(await put("o-b-libre", { observaciones: "x" }))).toEqual(NO_ENCONTRADA)

      const propia = await parseResponse(await put("o-a-libre", { observaciones: "x" }))
      expect(propia.status).toBe(409)
      expect(propia.body).toEqual(ORDEN_PRACTICA_ERROR)
      expect(mem.escrituras).toEqual([])
    } finally {
      vi.mocked(rejectIfPractica).mockImplementation(async () => null)
    }
  })

  it("a TECNICO of the branch changing a colleague's order stays 403 and writes nothing", async () => {
    const mem = montar({ role: "TECNICO", userId: "t-1", sucursalId: A })

    const { status, body } = await parseResponse(await put("o-a-t2", { observaciones: "x" }))

    expect(status).toBe(403)
    expect(body).toEqual({ error: "No autorizado" })
    expect(mem.escrituras).toEqual([])
    nadieSeEntero()
  })

  it("a TECNICO cannot change an unassigned order through PUT even with toma ON", async () => {
    const mem = montar({ role: "TECNICO", userId: "t-1", sucursalId: A, toma: true })

    const { status } = await parseResponse(await put("o-a-libre", { tecnicoId: "t-1" }))

    expect(status).toBe(403)
    expect(mem.escrituras).toEqual([])
  })

  it.each([
    ["an ADMIN, an order of B", { role: "ADMIN", userId: "adm", cookie: A }, "o-b-libre"],
    ["a VENDEDOR of A, an order of A", { role: "VENDEDOR", userId: "v-a", sucursalId: A }, "o-a-libre"],
    ["a TECNICO of A, his own order", { role: "TECNICO", userId: "t-1", sucursalId: A }, "o-a-t1"],
    ["a TECNICO of SJ, his own order of B (BM-6)", { role: "TECNICO", userId: "t-1", sucursalId: "suc-SJ" }, "o-b-t1"],
  ] as Array<[string, Montaje, string]>)("%s is updated", async (_quien, montaje, id) => {
    const mem = montar(montaje)

    const { status } = await parseResponse(await put(id, { observaciones: "Llamar al cliente" }))

    expect(status).toBe(200)
    expect(mem.escrituras).toContainEqual({
      tabla: "ordenes_servicio",
      operacion: "update",
      carga: { observaciones: "Llamar al cliente" },
    })
  })

  it("an org with one branch: a VENDEDOR edits any order of it, a TECNICO only his", async () => {
    const unaSucursal = ORDENES.filter((o) => o.sucursal_id === A)

    montar({ role: "VENDEDOR", userId: "v-a", sucursalId: A, ordenes: unaSucursal })
    expect((await parseResponse(await put("o-a-t2", { observaciones: "x" }))).status).toBe(200)

    montar({ role: "TECNICO", userId: "t-1", sucursalId: A, ordenes: unaSucursal })
    expect((await parseResponse(await put("o-a-t1", { observaciones: "x" }))).status).toBe(200)
    expect((await parseResponse(await put("o-a-t2", { observaciones: "x" }))).status).toBe(403)
  })
})

describe("DELETE /api/ordenes/[id]", () => {
  it.each(FUERA_DE_ALCANCE)("%s answers what a nonexistent id answers; nothing is deleted", async (_quien, montaje, id) => {
    const mem = montar(montaje)

    const inexistente = await parseResponse(await borrar("no-existe"))
    const fuera = await parseResponse(await borrar(id))

    expect(inexistente).toEqual(NO_ENCONTRADA)
    expect(fuera).toEqual(inexistente)
    expect(mem.escrituras).toEqual([])
    nadieSeEntero()
  })

  it.each([
    ["a VENDEDOR", { role: "VENDEDOR", userId: "v-a", sucursalId: A }],
    ["a TECNICO", { role: "TECNICO", userId: "t-1", sucursalId: A }],
  ] as Array<[string, Montaje]>)("%s deleting an order of his branch is still told only administrators can", async (_quien, montaje) => {
    const mem = montar(montaje)

    const { status, body } = await parseResponse(await borrar("o-a-t1"))

    expect(status).toBe(403)
    expect(body).toEqual({ error: "Solo administradores pueden eliminar órdenes" })
    expect(mem.escrituras).toEqual([])
  })

  it("an ADMIN deletes an order of any branch", async () => {
    const mem = montar({ role: "ADMIN", userId: "adm", cookie: A })

    const { status, body } = await parseResponse(await borrar("o-b-libre"))

    expect(status).toBe(200)
    expect(body.message).toContain("eliminada")
    expect(mem.escrituras).toContainEqual({ tabla: "ordenes_servicio", operacion: "delete", carga: undefined })
  })

  it("an ADMIN deleting a nonexistent id still gets 404", async () => {
    const mem = montar({ role: "ADMIN", userId: "adm" })

    expect(await parseResponse(await borrar("no-existe"))).toEqual(NO_ENCONTRADA)
    expect(mem.escrituras).toEqual([])
  })
})
