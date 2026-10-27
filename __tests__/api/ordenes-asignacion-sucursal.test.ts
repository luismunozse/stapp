// @vitest-environment node
/**
 * BM-5: the server rejects assigning a technician who is not in the branch that handles
 * the order and is not an ADMIN, but accepts an assignment that is already there, so a
 * legacy cross-branch technician (jed-electronics: 3 San Justo technicians on Tablada
 * orders) survives the edit of any other field.
 *
 * The `users` table is in-memory and honours its filters: the technician the route
 * looks up is the one the test defined, with the branch it defined.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { cookies } from "next/headers"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, createPostRequest, parseResponse } from "./helpers"
import { tablaPostgrest } from "../helpers/postgrest-memoria"

vi.mock("@/lib/plan-limits", () => ({ enforcePlanLimit: vi.fn().mockResolvedValue(null) }))
vi.mock("@/lib/counters", () => ({
  getNextOrderNumberByType: vi.fn().mockResolvedValue({ codigo: "CEL-001", numero: 1 }),
}))
vi.mock("@/lib/audit", () => ({
  createAuditLogger: vi.fn(() => ({
    create: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
  })),
  diffObjects: vi.fn().mockReturnValue({ before: {}, after: {} }),
}))
vi.mock("@/lib/storage", () => ({
  uploadOrderPhoto: vi.fn(),
  base64ToBuffer: vi.fn(),
}))
vi.mock("@/lib/notifications/queue", () => ({ queueNotification: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/webhooks/dispatcher", () => ({ emitWebhookEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/tipos-dispositivo-config", () => ({ tipoValidaImei: vi.fn() }))

import { POST } from "@/app/api/ordenes/route"
import { GET as GET_TECNICOS } from "@/app/api/tecnicos/route"
import { PUT } from "@/app/api/ordenes/[id]/route"
import { queueNotification } from "@/lib/notifications/queue"
import { getNextOrderNumberByType } from "@/lib/counters"

const MENSAJE = "Ese técnico no pertenece a la sucursal de esta orden"

const PERSONAL = [
  { id: "t-a", nombre: "Ana", rol: "TECNICO", sucursal_id: "suc-A", organization_id: "org-1", email: null, telefono: null, activo: true, especialidades: [], avatar_url: null, fecha_ingreso_tecnico: null, porcentaje_comision: 10, costo_hora: 100, deleted_at: null },
  { id: "t-a2", nombre: "Beto", rol: "TECNICO", sucursal_id: "suc-A", organization_id: "org-1", email: null, telefono: null, activo: true, especialidades: [], avatar_url: null, fecha_ingreso_tecnico: null, porcentaje_comision: 10, costo_hora: 100, deleted_at: null },
  { id: "t-b", nombre: "Carla", rol: "TECNICO", sucursal_id: "suc-B", organization_id: "org-1", email: null, telefono: null, activo: true, especialidades: [], avatar_url: null, fecha_ingreso_tecnico: null, porcentaje_comision: 20, costo_hora: 200, deleted_at: null },
  { id: "t-b2", nombre: "Dario", rol: "TECNICO", sucursal_id: "suc-B", organization_id: "org-1", email: null, telefono: null, activo: true, especialidades: [], avatar_url: null, fecha_ingreso_tecnico: null, porcentaje_comision: 20, costo_hora: 200, deleted_at: null },
  { id: "adm", nombre: "Fede", rol: "ADMIN", sucursal_id: null, organization_id: "org-1", email: null, telefono: null, activo: true, especialidades: [], avatar_url: null, fecha_ingreso_tecnico: null, porcentaje_comision: 0, costo_hora: 0, deleted_at: null },
  { id: "t-otra-org", nombre: "Eva", rol: "TECNICO", sucursal_id: "suc-A", organization_id: "org-2", email: null, telefono: null, activo: true, especialidades: [], avatar_url: null, fecha_ingreso_tecnico: null, porcentaje_comision: 0, costo_hora: 0, deleted_at: null },
]

describe("POST /api/ordenes - assigning a technician", () => {
  const cuerpo = (extra: Record<string, unknown> = {}) =>
    createPostRequest({
      clienteId: "c1",
      dispositivo: "iPhone 14",
      tipoDispositivo: "CELULAR",
      problemaReportado: "No enciende",
      ...extra,
    })

  function montar(role: string, sucursalId: string | null) {
    vi.clearAllMocks()
    mockAuthSuccess({ role, userId: "u-9", sucursalId })
    const insert = vi.fn().mockReturnValue(createChainMock({ id: "o-new", sucursal_id: sucursalId, clientes: { id: "c1" } }))
    const ordenes = { ...createChainMock(null), insert } as any
    mockSupabaseFrom({
      users: tablaPostgrest(PERSONAL),
      ordenes_servicio: ordenes,
      sucursales: createChainMock({ id: "suc-A" }),
      organizations: createChainMock({ nombre: "Taller" }),
      orden_eventos: createChainMock(null),
    } as any)
    return { insert }
  }

  it("rejects a technician of another branch and writes nothing", async () => {
    const { insert } = montar("VENDEDOR", "suc-A")

    const { status, body } = await parseResponse(await POST(cuerpo({ tecnicoId: "t-b" })))

    expect(status).toBe(400)
    expect(body.error).toBe(MENSAJE)
    expect(insert).not.toHaveBeenCalled()
    expect(queueNotification).not.toHaveBeenCalled()
    // The number counter is incremented by the RPC: a rejected request must not burn one.
    expect(getNextOrderNumberByType).not.toHaveBeenCalled()
  })

  it("accepts a technician of the branch the order is created in", async () => {
    const { insert } = montar("VENDEDOR", "suc-A")

    const { status } = await parseResponse(await POST(cuerpo({ tecnicoId: "t-a" })))

    expect(status).toBe(201)
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ sucursal_id: "suc-A", tecnico_id: "t-a" }))
    expect(getNextOrderNumberByType).toHaveBeenCalledTimes(1)
  })

  it("the branch the order is created in decides: a VENDEDOR of B takes B's technicians, not A's", async () => {
    const { insert } = montar("VENDEDOR", "suc-B")

    const rechazado = await parseResponse(await POST(cuerpo({ tecnicoId: "t-a" })))
    expect(rechazado.status).toBe(400)
    expect(rechazado.body.error).toBe(MENSAJE)
    expect(insert).not.toHaveBeenCalled()
    expect(getNextOrderNumberByType).not.toHaveBeenCalled()

    const aceptado = await parseResponse(await POST(cuerpo({ tecnicoId: "t-b" })))
    expect(aceptado.status).toBe(201)
    // Only the accepted request took a number.
    expect(getNextOrderNumberByType).toHaveBeenCalledTimes(1)
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ sucursal_id: "suc-B", tecnico_id: "t-b" }))
  })

  it("an ADMIN is not exempt either: the principal branch's technicians only", async () => {
    const { insert } = montar("ADMIN", null)

    const rechazado = await parseResponse(await POST(cuerpo({ tecnicoId: "t-b" })))
    expect(rechazado.status).toBe(400)
    expect(rechazado.body.error).toBe(MENSAJE)
    expect(insert).not.toHaveBeenCalled()

    const aceptado = await parseResponse(await POST(cuerpo({ tecnicoId: "t-a2" })))
    expect(aceptado.status).toBe(201)
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ sucursal_id: "suc-A", tecnico_id: "t-a2" }))
  })

  it("a technician of another organization is still just an invalid technician", async () => {
    const { insert } = montar("VENDEDOR", "suc-A")

    const { status, body } = await parseResponse(await POST(cuerpo({ tecnicoId: "t-otra-org" })))

    expect(status).toBe(400)
    expect(body.error).toBe("Técnico inválido")
    expect(insert).not.toHaveBeenCalled()
    expect(getNextOrderNumberByType).not.toHaveBeenCalled()
  })
})

// The list the order form offers and the validation of POST must agree BY CONSTRUCTION: both
// resolve the branch with sucursalParaEscritura. Whoever the form offers is accepted, and whoever
// it does not offer is rejected for the branch reason.
describe("the technicians offered when creating an order are exactly the ones POST accepts", () => {
  const TECNICOS = ["t-a", "t-a2", "t-b", "t-b2"]

  function montar(role: string, sucursalId: string | null, cookie: string | null) {
    vi.clearAllMocks()
    mockAuthSuccess({ role, userId: "u-9", sucursalId })
    vi.mocked(cookies).mockResolvedValue({
      get: vi.fn((name: string) => (name === "stapp-sucursal-activa" && cookie ? { value: cookie } : undefined)),
      set: vi.fn(),
    } as any)
    const insert = vi.fn().mockReturnValue(createChainMock({ id: "o-new", clientes: { id: "c1" } }))
    mockSupabaseFrom({
      users: tablaPostgrest(PERSONAL),
      ordenes_servicio: { ...createChainMock(null), insert } as any,
      // The principal branch of the org is suc-A.
      sucursales: createChainMock({ id: "suc-A" }),
      organizations: createChainMock({ nombre: "Taller" }),
      orden_eventos: createChainMock(null),
    } as any)
  }

  const ofrecidos = async () =>
    (await parseResponse(await GET_TECNICOS(new Request("http://localhost:3000/api/tecnicos?alcance=escritura")))).body.map(
      (t: any) => t.id as string,
    )

  const crear = async (tecnicoId: string) =>
    parseResponse(
      await POST(
        createPostRequest({ clienteId: "c1", dispositivo: "iPhone", tipoDispositivo: "CELULAR", problemaReportado: "x", tecnicoId }),
      ),
    )

  it.each([
    ["an ADMIN on Todas", "ADMIN", null, null, ["t-a", "t-a2"]],
    ["an ADMIN with suc-B selected", "ADMIN", null, "suc-B", ["t-b", "t-b2"]],
    ["a VENDEDOR of suc-A", "VENDEDOR", "suc-A", null, ["t-a", "t-a2"]],
  ])("%s", async (_caso, role, sucursalId, cookie, esperados) => {
    montar(role, sucursalId, cookie)

    const lista = await ofrecidos()
    expect(lista.sort()).toEqual(esperados)

    for (const id of TECNICOS) {
      const { status, body } = await crear(id)
      if (lista.includes(id)) expect(status, `${id} is offered`).toBe(201)
      else {
        expect(status, `${id} is not offered`).toBe(400)
        expect(body.error).toBe(MENSAJE)
      }
    }
  })
})

describe("PUT /api/ordenes/[id] - assigning a technician", () => {
  function montar(opts: { orden?: Record<string, unknown>; role?: string; userId?: string } = {}) {
    vi.clearAllMocks()
    mockAuthSuccess({ role: opts.role ?? "VENDEDOR", userId: opts.userId ?? "u-9", sucursalId: "suc-A" })
    const orden = {
      id: "o1",
      numero_orden: 1,
      cliente_id: "c1",
      organization_id: "org-1",
      sucursal_id: "suc-A",
      tecnico_id: "t-a",
      estado: "RECIBIDO",
      presupuesto: null,
      costo_final: null,
      diagnostico: null,
      clientes: { id: "c1", nombre: "Juan", email: null, telefono: null },
      organizations: { id: "org-1", nombre: "Taller", moneda: "ARS", zona_horaria: "America/Argentina/Buenos_Aires" },
      ...opts.orden,
    }
    const ordenes = createChainMock(null)
    ordenes.single = vi.fn().mockResolvedValue({ data: orden, error: null })
    mockSupabaseFrom({
      ordenes_servicio: ordenes,
      users: tablaPostgrest(PERSONAL),
      orden_eventos: createChainMock(null),
    } as any)
    return { ordenes }
  }

  const put = (body: Record<string, unknown>) =>
    PUT(
      new Request("http://localhost:3000/api/ordenes/o1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id: "o1" }) },
    )

  it("rejects a technician of another branch than the one handling the order, with no update", async () => {
    const { ordenes } = montar()

    const { status, body } = await parseResponse(await put({ tecnicoId: "t-b" }))

    expect(status).toBe(400)
    expect(body.error).toBe(MENSAJE)
    expect(ordenes.update).not.toHaveBeenCalled()
  })

  it.each([
    ["a technician of the handling branch", "t-a2"],
    ["an ADMIN, who belongs to no branch", "adm"],
  ])("accepts %s", async (_caso, tecnicoId) => {
    const { ordenes } = montar()

    const { status } = await parseResponse(await put({ tecnicoId }))

    expect(status).toBe(200)
    expect(ordenes.update).toHaveBeenCalledWith(expect.objectContaining({ tecnico_id: tecnicoId }))
  })

  it("the branch is the order's, not the editor's: an order handled by B takes B's technicians", async () => {
    const { ordenes } = montar({ orden: { sucursal_id: "suc-B", tecnico_id: null } })

    expect((await parseResponse(await put({ tecnicoId: "t-a" }))).status).toBe(400)
    expect(ordenes.update).not.toHaveBeenCalled()

    expect((await parseResponse(await put({ tecnicoId: "t-b" }))).status).toBe(200)
    expect(ordenes.update).toHaveBeenCalledWith(expect.objectContaining({ tecnico_id: "t-b" }))
  })

  describe("legacy cross-branch assignee (BM-5)", () => {
    const legacy = { orden: { sucursal_id: "suc-A", tecnico_id: "t-b" } }

    it("editing another field with the technician unchanged succeeds", async () => {
      const { ordenes } = montar(legacy)

      const { status } = await parseResponse(await put({ observaciones: "Llamar al cliente", tecnicoId: "t-b" }))

      expect(status).toBe(200)
      expect(ordenes.update).toHaveBeenCalledWith(
        expect.objectContaining({ observaciones: "Llamar al cliente", tecnico_id: "t-b" }),
      )
    })

    it("editing another field without sending the technician succeeds", async () => {
      const { ordenes } = montar(legacy)

      const { status } = await parseResponse(await put({ observaciones: "Llamar al cliente" }))

      expect(status).toBe(200)
      expect(ordenes.update).toHaveBeenCalledTimes(1)
    })

    it("moving the order to ANOTHER cross-branch technician is rejected", async () => {
      const { ordenes } = montar(legacy)

      const { status, body } = await parseResponse(await put({ tecnicoId: "t-b2" }))

      expect(status).toBe(400)
      expect(body.error).toBe(MENSAJE)
      expect(ordenes.update).not.toHaveBeenCalled()
    })

    it("moving it back to the handling branch's technician succeeds", async () => {
      const { ordenes } = montar(legacy)

      const { status } = await parseResponse(await put({ tecnicoId: "t-a" }))

      expect(status).toBe(200)
      expect(ordenes.update).toHaveBeenCalledWith(expect.objectContaining({ tecnico_id: "t-a" }))
    })

    it("un-assigning is not an assignment: it succeeds", async () => {
      const { ordenes } = montar(legacy)

      const { status } = await parseResponse(await put({ tecnicoId: null }))

      expect(status).toBe(200)
      expect(ordenes.update).toHaveBeenCalledWith(expect.objectContaining({ tecnico_id: null }))
    })
  })

  it("a TECNICO reassigning his own order to a cross-branch colleague is rejected too", async () => {
    const { ordenes } = montar({ role: "TECNICO", userId: "t-a" })

    const { status, body } = await parseResponse(await put({ tecnicoId: "t-b" }))

    expect(status).toBe(400)
    expect(body.error).toBe(MENSAJE)
    expect(ordenes.update).not.toHaveBeenCalled()
  })
})

describe("removed staff stay out of branch-scoped lists and assignment", () => {
  // A technician of suc-A who was removed (soft delete) must neither be offered nor accepted.
  const BAJA = { ...PERSONAL[0], id: "t-baja", nombre: "Gus", deleted_at: "2026-10-01T00:00:00Z" }
  const CON_BAJA = [...PERSONAL, BAJA]

  function montar(role: string, sucursalId: string | null) {
    vi.clearAllMocks()
    mockAuthSuccess({ role, userId: "u-9", sucursalId })
    const insert = vi.fn().mockReturnValue(createChainMock({ id: "o-new", sucursal_id: sucursalId, clientes: { id: "c1" } }))
    const ordenes = createChainMock(null) as any
    ordenes.insert = insert
    ordenes.single = vi.fn().mockResolvedValue({
      data: {
        id: "o1",
        numero_orden: 1,
        cliente_id: "c1",
        organization_id: "org-1",
        sucursal_id: "suc-A",
        tecnico_id: null,
        estado: "RECIBIDO",
        presupuesto: null,
        costo_final: null,
        diagnostico: null,
        clientes: { id: "c1", nombre: "Juan", email: null, telefono: null },
        organizations: { id: "org-1", nombre: "Taller", moneda: "ARS", zona_horaria: "America/Argentina/Buenos_Aires" },
      },
      error: null,
    })
    mockSupabaseFrom({
      users: tablaPostgrest(CON_BAJA),
      ordenes_servicio: ordenes,
      sucursales: createChainMock({ id: "suc-A" }),
      organizations: createChainMock({ nombre: "Taller" }),
      orden_eventos: createChainMock(null),
    } as any)
    return { insert, ordenes }
  }

  it("the technician list of a branch does not offer a removed technician", async () => {
    montar("ADMIN", null)

    const { body } = await parseResponse(
      await GET_TECNICOS(new Request("http://localhost:3000/api/tecnicos?sucursalId=suc-A")),
    )

    expect(body.map((t: any) => t.id).sort()).toEqual(["t-a", "t-a2"])
  })

  it("creating an order rejects a removed technician of the branch and writes nothing", async () => {
    const { insert } = montar("VENDEDOR", "suc-A")

    const { status, body } = await parseResponse(
      await POST(
        createPostRequest({ clienteId: "c1", dispositivo: "iPhone", tipoDispositivo: "CELULAR", problemaReportado: "x", tecnicoId: "t-baja" }),
      ),
    )

    expect(status).toBe(400)
    expect(body.error).toBe("Técnico inválido")
    expect(insert).not.toHaveBeenCalled()
  })

  it("reassigning an order rejects a removed technician of the handling branch", async () => {
    const { ordenes } = montar("VENDEDOR", "suc-A")

    const { status } = await parseResponse(
      await PUT(
        new Request("http://localhost:3000/api/ordenes/o1", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tecnicoId: "t-baja" }),
        }),
        { params: Promise.resolve({ id: "o1" }) },
      ),
    )

    expect(status).toBe(400)
    expect(ordenes.update).not.toHaveBeenCalled()
  })
})
