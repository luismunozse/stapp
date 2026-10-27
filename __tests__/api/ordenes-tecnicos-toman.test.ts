// @vitest-environment node
/**
 * Opt-in permission `tecnicos_toman_ordenes` (migration 374).
 *
 * With the flag ON a TECNICO also sees orders without a technician (list and
 * detail) and can "take" one: assign himself, nobody else, only while it is
 * still unassigned. With the flag OFF (or unreadable: fail-closed) everything
 * behaves exactly as before. The generic PUT guard is NOT loosened.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  mockSupabaseFrom,
  createChainMock,
  createGetRequest,
  createPostRequest,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/audit", () => ({
  createAuditLogger: vi.fn(() => ({ update: vi.fn().mockResolvedValue(undefined) })),
  diffObjects: vi.fn().mockReturnValue({ before: {}, after: {} }),
}))
vi.mock("@/lib/notifications/queue", () => ({
  queueNotification: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/webhooks/dispatcher", () => ({
  emitWebhookEvent: vi.fn().mockResolvedValue(undefined),
}))

function ctx(id = "o1") {
  return { params: Promise.resolve({ id }) }
}

function listChain() {
  const chain = createChainMock([], null, 0)
  chain.range = vi.fn().mockReturnValue(chain)
  chain.then = (resolve: any) =>
    resolve({
      data: [
        { id: "o-libre", tecnico_id: null, estado: "RECIBIDO", clientes: null, users: null },
        { id: "o-propia", tecnico_id: "tec-1", estado: "EN_REPARACION", clientes: null, users: null },
        { id: "o-cerrada", tecnico_id: null, estado: "CANCELADO", clientes: null, users: null },
      ],
      error: null,
      count: 3,
    })
  return chain
}

const flag = (v: boolean | null) =>
  createChainMock(v === null ? null : { tecnicos_toman_ordenes: v }, v === null ? { code: "42703", message: "column does not exist" } : null)

describe("GET /api/ordenes - TECNICO and unassigned orders", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "TECNICO", userId: "tec-1", sucursalId: "suc-A" })
  })

  it("flag off: only his own orders (eq tecnico_id), no OR with null", async () => {
    const chain = listChain()
    mockSupabaseFrom({ organizations: flag(false), clientes: createChainMock([]), ordenes_servicio: chain })
    const { GET } = await import("@/app/api/ordenes/route")

    await GET(createGetRequest("http://localhost:3000/api/ordenes"))

    expect(chain.eq).toHaveBeenCalledWith("tecnico_id", "tec-1")
    expect(chain.or).not.toHaveBeenCalled()
  })

  it("flag unreadable (column missing): fail-closed, same as off", async () => {
    const chain = listChain()
    mockSupabaseFrom({ organizations: flag(null), clientes: createChainMock([]), ordenes_servicio: chain })
    const { GET } = await import("@/app/api/ordenes/route")

    await GET(createGetRequest("http://localhost:3000/api/ordenes"))

    expect(chain.eq).toHaveBeenCalledWith("tecnico_id", "tec-1")
    expect(chain.or).not.toHaveBeenCalled()
  })

  // The unassigned half is limited to his own branch (OI-3); the full row-level
  // behavior is in ordenes-lista-tecnico.test.ts.
  it("flag on: own OR unassigned in his branch, and no plain eq on tecnico_id", async () => {
    const chain = listChain()
    mockSupabaseFrom({ organizations: flag(true), clientes: createChainMock([]), ordenes_servicio: chain })
    const { GET } = await import("@/app/api/ordenes/route")

    await GET(createGetRequest("http://localhost:3000/api/ordenes"))

    expect(chain.or).toHaveBeenCalledWith("tecnico_id.eq.tec-1,and(tecnico_id.is.null,sucursal_id.eq.suc-A)")
    expect(chain.eq).not.toHaveBeenCalledWith("tecnico_id", expect.anything())
  })

  it("flag on: marks only open unassigned orders as puedeTomar", async () => {
    mockSupabaseFrom({ organizations: flag(true), clientes: createChainMock([]), ordenes_servicio: listChain() })
    const { GET } = await import("@/app/api/ordenes/route")

    const { body } = await parseResponse(await GET(createGetRequest("http://localhost:3000/api/ordenes")))

    const byId = Object.fromEntries(body.data.map((o: any) => [o.id, o.puedeTomar]))
    expect(byId).toEqual({ "o-libre": true, "o-propia": false, "o-cerrada": false })
  })

  it("flag off: puedeTomar is never true", async () => {
    mockSupabaseFrom({ organizations: flag(false), clientes: createChainMock([]), ordenes_servicio: listChain() })
    const { GET } = await import("@/app/api/ordenes/route")

    const { body } = await parseResponse(await GET(createGetRequest("http://localhost:3000/api/ordenes")))

    expect(body.data.every((o: any) => o.puedeTomar !== true)).toBe(true)
  })

  it.each(["ADMIN", "VENDEDOR"])("%s is unaffected: no flag lookup, no puedeTomar", async (role) => {
    mockAuthSuccess({ role, userId: "u-9" })
    const orgs = flag(true)
    mockSupabaseFrom({ organizations: orgs, clientes: createChainMock([]), ordenes_servicio: listChain() })
    const { GET } = await import("@/app/api/ordenes/route")

    const { body } = await parseResponse(await GET(createGetRequest("http://localhost:3000/api/ordenes")))

    expect(orgs.select).not.toHaveBeenCalledWith("tecnicos_toman_ordenes")
    expect(body.data.every((o: any) => !("puedeTomar" in o))).toBe(true)
  })
})

describe("GET /api/ordenes/[id] - TECNICO and unassigned orders", () => {
  function orden(overrides: Record<string, any> = {}) {
    return {
      id: "o1",
      organization_id: "org-1",
      tecnico_id: null,
      estado: "RECIBIDO",
      sucursal_id: "suc-A",
      clientes: null,
      users: null,
      recibido: null,
      repuestos_orden: [],
      cotizaciones: [],
      garantias: [],
      organizations: { nombre: "Org" },
      ...overrides,
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "TECNICO", userId: "tec-1", sucursalId: "suc-A" })
  })

  // An order of another branch is out of the technician's scope: the same "not found" a missing id
  // gets (it used to be 403, which told him the order exists). The in-scope refusals below stay 403.
  it("flag on: an unassigned order from ANOTHER sucursal is not found", async () => {
    mockSupabaseFrom({
      organizations: flag(true),
      ordenes_servicio: createChainMock(orden({ sucursal_id: "suc-B" })),
      orden_eventos: createChainMock(null),
    })
    const { GET } = await import("@/app/api/ordenes/[id]/route")

    const { status, body } = await parseResponse(await GET(createGetRequest(), ctx()))

    expect(status).toBe(404)
    expect(body).toEqual({ error: "Orden no encontrada" })
  })

  it("flag off: 403 on an unassigned order", async () => {
    mockSupabaseFrom({
      organizations: flag(false),
      ordenes_servicio: createChainMock(orden()),
      orden_eventos: createChainMock(null),
    })
    const { GET } = await import("@/app/api/ordenes/[id]/route")

    const res = await GET(createGetRequest(), ctx())

    expect(res.status).toBe(403)
  })

  it("flag on: opens an unassigned order and says it can be taken", async () => {
    mockSupabaseFrom({
      organizations: flag(true),
      ordenes_servicio: createChainMock(orden()),
      orden_eventos: createChainMock(null),
    })
    const { GET } = await import("@/app/api/ordenes/[id]/route")

    const { status, body } = await parseResponse(await GET(createGetRequest(), ctx()))

    expect(status).toBe(200)
    expect(body.puedeTomar).toBe(true)
  })

  it("flag on: another technician's order is still 403", async () => {
    const orgs = flag(true)
    mockSupabaseFrom({
      organizations: orgs,
      ordenes_servicio: createChainMock(orden({ tecnico_id: "tec-2" })),
      orden_eventos: createChainMock(null),
    })
    const { GET } = await import("@/app/api/ordenes/[id]/route")

    const res = await GET(createGetRequest(), ctx())

    expect(res.status).toBe(403)
  })

  it("his own order: 200 without puedeTomar", async () => {
    mockSupabaseFrom({
      organizations: flag(true),
      ordenes_servicio: createChainMock(orden({ tecnico_id: "tec-1" })),
      orden_eventos: createChainMock(null),
    })
    const { GET } = await import("@/app/api/ordenes/[id]/route")

    const { status, body } = await parseResponse(await GET(createGetRequest(), ctx()))

    expect(status).toBe(200)
    expect(body.puedeTomar).toBe(false)
  })
})

describe("PUT /api/ordenes/[id] - the generic guard stays closed", () => {
  it("flag on: a TECNICO still cannot update an unassigned order through PUT", async () => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "TECNICO", userId: "tec-1", sucursalId: "suc-A" })
    mockSupabaseFrom({
      organizations: flag(true),
      ordenes_servicio: createChainMock({
        id: "o1",
        organization_id: "org-1",
        sucursal_id: "suc-A",
        tecnico_id: null,
        estado: "RECIBIDO",
        clientes: null,
        organizations: {},
      }),
    })
    const { PUT } = await import("@/app/api/ordenes/[id]/route")

    const res = await PUT(
      new Request("http://localhost:3000/api/ordenes/o1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tecnicoId: "tec-1" }),
      }),
      ctx(),
    )

    expect(res.status).toBe(403)
  })
})

describe("POST /api/ordenes/[id]/tomar", () => {
  function setup(opts: {
    role?: string
    flagValue?: boolean | null
    orden?: Record<string, any> | null
    updateResult?: { data: any; error: any }
    usuario?: Record<string, any> | null
  } = {}) {
    vi.clearAllMocks()
    mockAuthSuccess({ role: opts.role ?? "TECNICO", userId: "tec-1", sucursalId: "suc-A" })
    const ordenes = createChainMock(
      opts.orden === null
        ? null
        : { id: "o1", tecnico_id: null, estado: "RECIBIDO", sucursal_id: "suc-A", ...(opts.orden ?? {}) },
      opts.orden === null ? { code: "PGRST116", message: "no rows" } : null,
    )
    ordenes.maybeSingle = vi.fn().mockResolvedValue(opts.updateResult ?? { data: { id: "o1" }, error: null })
    const users = createChainMock(
      opts.usuario === undefined ? { id: "tec-1", rol: "TECNICO", porcentaje_comision: "15", costo_hora: "2000" } : opts.usuario,
    )
    const orgs = flag(opts.flagValue === undefined ? true : opts.flagValue)
    mockSupabaseFrom({ organizations: orgs, ordenes_servicio: ordenes, users })
    return { ordenes, users, orgs }
  }

  async function call(body: any = {}) {
    const { POST } = await import("@/app/api/ordenes/[id]/tomar/route")
    return POST(createPostRequest(body), ctx())
  }

  it("takes an unassigned order: conditional update on tecnico_id IS NULL with his commission and labor snapshot", async () => {
    const { ordenes } = setup()

    const { status, body } = await parseResponse(await call())

    expect(status).toBe(200)
    expect(body.tecnicoId).toBe("tec-1")
    expect(ordenes.update).toHaveBeenCalledWith({
      tecnico_id: "tec-1",
      porcentaje_comision: 15,
      costo_hora_snapshot: 2000,
    })
    expect(ordenes.is).toHaveBeenCalledWith("tecnico_id", null)
    expect(ordenes.eq).toHaveBeenCalledWith("organization_id", "org-1")
  })

  it("concurrent take: the conditional update matched no row -> 409", async () => {
    setup({ updateResult: { data: null, error: null } })

    const res = await call()

    expect(res.status).toBe(409)
  })

  it("order already assigned to someone else -> 409 and nothing is written", async () => {
    const { ordenes } = setup({ orden: { tecnico_id: "tec-2" } })

    const res = await call()

    expect(res.status).toBe(409)
    expect(ordenes.update).not.toHaveBeenCalled()
  })

  it("flag off -> 403, nothing written", async () => {
    const { ordenes } = setup({ flagValue: false })

    const res = await call()

    expect(res.status).toBe(403)
    expect(ordenes.update).not.toHaveBeenCalled()
  })

  it("flag unreadable -> 403 (fail-closed)", async () => {
    const { ordenes } = setup({ flagValue: null })

    const res = await call()

    expect(res.status).toBe(403)
    expect(ordenes.update).not.toHaveBeenCalled()
  })

  it("trying to assign ANOTHER user -> 403, nothing written", async () => {
    const { ordenes } = setup()

    const res = await call({ tecnicoId: "tec-2" })

    expect(res.status).toBe(403)
    expect(ordenes.update).not.toHaveBeenCalled()
  })

  it("trying to unassign (tecnicoId null) is not a way to take either -> 403", async () => {
    const { ordenes } = setup()

    const res = await call({ tecnicoId: null })

    expect(res.status).toBe(403)
    expect(ordenes.update).not.toHaveBeenCalled()
  })

  it.each(["ADMIN", "VENDEDOR"])("%s -> 403 (ADMIN assigns through PUT)", async (role) => {
    const { ordenes } = setup({ role })

    const res = await call()

    expect(res.status).toBe(403)
    expect(ordenes.update).not.toHaveBeenCalled()
  })

  it("order from another organization / unknown -> 404", async () => {
    setup({ orden: null })

    const res = await call()

    expect(res.status).toBe(404)
  })

  it.each(["CANCELADO", "ENTREGADO", "ENTREGADO_SIN_REPARACION", "ENTREGADO_SIN_COBRO", "SIN_REPARACION", "SIN_FALLA_DETECTADA"])(
    "closed order (%s) cannot be taken -> 409",
    async (estado) => {
      const { ordenes } = setup({ orden: { estado } })

      const res = await call()

      expect(res.status).toBe(409)
      expect(ordenes.update).not.toHaveBeenCalled()
    },
  )

  it("a different sucursal than the technician's -> 404", async () => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "TECNICO", userId: "tec-1", sucursalId: "suc-A" })
    const ordenes = createChainMock({ id: "o1", tecnico_id: null, estado: "RECIBIDO", sucursal_id: "suc-B" })
    ordenes.maybeSingle = vi.fn().mockResolvedValue({ data: { id: "o1" }, error: null })
    mockSupabaseFrom({
      organizations: flag(true),
      ordenes_servicio: ordenes,
      users: createChainMock({ id: "tec-1", rol: "TECNICO", porcentaje_comision: 0, costo_hora: 0 }),
    })

    const res = await call()

    expect(res.status).toBe(404)
    expect(ordenes.update).not.toHaveBeenCalled()
  })
})
