// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, createPostRequest, createGetRequest, parseResponse } from "./helpers"
import { GET, POST } from "@/app/api/ordenes/[id]/danos/route"
import { DELETE } from "@/app/api/ordenes/[id]/danos/[danoId]/route"

const forzarReparar = vi.hoisted(() => ({ valor: null as boolean | null }))
vi.mock("@/lib/ordenes/alcance", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ordenes/alcance")>()
  return {
    ...real,
    cargarOrdenEnAlcance: async (...args: Parameters<typeof real.cargarOrdenEnAlcance>) => {
      const r = await real.cargarOrdenEnAlcance(...args)
      if ("error" in r || forzarReparar.valor === null) return r
      return { ...r, permisos: { ...r.permisos, reparar: forzarReparar.valor } }
    },
  }
})

const ctx = { params: Promise.resolve({ id: "o1" }) }
const ctxDel = (danoId = "d1") => ({ params: Promise.resolve({ id: "o1", danoId }) })

const ORDEN = { id: "o1", tipo_dispositivo: "CELULAR", recepcion_sin_danos: false, sucursal_id: null, tecnico_id: null }
const BODY = { diagrama: "celular@1", vista: "frente", x: 0.5, y: 0.4, tipo: "rayon", nota: "marca" }
const FILA = { id: "d1", numero: 2, diagrama: "celular@1", vista: "frente", x: 0.5, y: 0.4, tipo: "rayon", nota: "marca", momento: "diagnostico", created_at: "2026-11-12T10:00:00Z", created_by: "user-1" }

beforeEach(() => {
  vi.clearAllMocks()
  forzarReparar.valor = null
  mockAuthSuccess()
})

describe("GET /api/ordenes/[id]/danos", () => {
  it("404 si la orden está fuera de alcance", async () => {
    mockSupabaseFrom({ ordenes_servicio: createChainMock(null, { code: "PGRST116", message: "no rows" }), orden_danos: createChainMock([]) })
    const { status } = await parseResponse(await GET(createGetRequest(), ctx))
    expect(status).toBe(404)
  })

  it("ordena por numero y mapea el autor", async () => {
    const danos = createChainMock([{ ...FILA, users: { nombre: "Ana" } }])
    mockSupabaseFrom({ ordenes_servicio: createChainMock(ORDEN), orden_danos: danos })
    const { status, body } = await parseResponse(await GET(createGetRequest(), ctx))
    expect(status).toBe(200)
    expect(danos.order).toHaveBeenCalledWith("numero", { ascending: true })
    expect(body.danos[0]).toMatchObject({ id: "d1", numero: 2, createdByNombre: "Ana", createdAt: FILA.created_at })
    expect(body.sinDanos).toBe(false)
    expect(body.diagrama).toBe("celular@1")
  })

  it("usa el diagrama de los pins de recepción aunque cambió el tipo de equipo", async () => {
    mockSupabaseFrom({
      ordenes_servicio: createChainMock({ ...ORDEN, tipo_dispositivo: "COMPUTADORA" }),
      orden_danos: createChainMock([{ ...FILA, momento: "recepcion", diagrama: "celular@1", users: null }]),
    })
    const { body } = await parseResponse(await GET(createGetRequest(), ctx))
    expect(body.diagrama).toBe("celular@1")
  })
})

describe("GET /api/ordenes/[id]/danos: puedeAgregar", () => {
  const get = async (orden: object) => {
    mockSupabaseFrom({ ordenes_servicio: createChainMock(orden), orden_danos: createChainMock([]) })
    return (await parseResponse(await GET(createGetRequest(), ctx))).body
  }

  it("true para quien puede reparar una orden abierta", async () => {
    expect((await get({ ...ORDEN, estado: "EN_REPARACION" })).puedeAgregar).toBe(true)
  })

  it("false si el actor no tiene el permiso reparar", async () => {
    forzarReparar.valor = false
    expect((await get({ ...ORDEN, estado: "EN_REPARACION" })).puedeAgregar).toBe(false)
  })

  it("false si la orden ya fue entregada", async () => {
    expect((await get({ ...ORDEN, estado: "ENTREGADO" })).puedeAgregar).toBe(false)
  })
})

describe("POST /api/ordenes/[id]/danos", () => {
  it("404 para un TECNICO no asignado", async () => {
    mockAuthSuccess({ role: "TECNICO", userId: "tec-1", sucursalId: "suc-1" })
    mockSupabaseFrom({
      ordenes_servicio: createChainMock({ ...ORDEN, tecnico_id: "otro", sucursal_id: "suc-2" }),
      orden_danos: createChainMock(FILA),
    })
    const { status } = await parseResponse(await POST(createPostRequest(BODY), ctx))
    expect(status).toBe(404)
  })

  it("400 si el diagrama no es el de la orden", async () => {
    const danos = createChainMock([])
    mockSupabaseFrom({ ordenes_servicio: createChainMock(ORDEN), orden_danos: danos })
    const { status } = await parseResponse(await POST(createPostRequest({ ...BODY, diagrama: "notebook@1" }), ctx))
    expect(status).toBe(400)
    expect(danos.insert).not.toHaveBeenCalled()
  })

  it("409 cuando la orden está cerrada", async () => {
    const danos = createChainMock([])
    danos.single.mockResolvedValue({ data: null, error: { message: "DANOS_ORDEN_CERRADA" } })
    mockSupabaseFrom({ ordenes_servicio: createChainMock(ORDEN), orden_danos: danos })
    const { status, body } = await parseResponse(await POST(createPostRequest(BODY), ctx))
    expect(status).toBe(409)
    expect(body.error).toBe("La orden ya está cerrada")
  })

  it("inserta con momento diagnostico, organización y autor; responde 201", async () => {
    const danos = createChainMock([])
    danos.single.mockResolvedValue({ data: FILA, error: null })
    mockSupabaseFrom({ ordenes_servicio: createChainMock(ORDEN), orden_danos: danos })
    const { status, body } = await parseResponse(await POST(createPostRequest(BODY), ctx))
    expect(status).toBe(201)
    expect(danos.insert).toHaveBeenCalledWith(
      expect.objectContaining({ momento: "diagnostico", organization_id: "org-1", orden_id: "o1", created_by: "user-1" }),
    )
    expect(danos.insert.mock.calls[0][0]).not.toHaveProperty("numero")
    expect(body).toMatchObject({ id: "d1", numero: 2, momento: "diagnostico" })
  })
})

describe("DELETE /api/ordenes/[id]/danos/[danoId]", () => {
  it("404 si el pin es de otra orden (filtra por orden_id y organization_id)", async () => {
    const danos = createChainMock([])
    mockSupabaseFrom({ ordenes_servicio: createChainMock(ORDEN), orden_danos: danos })
    const { status } = await parseResponse(await DELETE(createGetRequest(), ctxDel("ajeno")))
    expect(status).toBe(404)
    expect(danos.eq).toHaveBeenCalledWith("orden_id", "o1")
    expect(danos.eq).toHaveBeenCalledWith("organization_id", "org-1")
    expect(danos.eq).toHaveBeenCalledWith("momento", "diagnostico")
  })

  it("409 fuera de la ventana de 10 minutos", async () => {
    const danos = createChainMock(null, { message: "DANOS_DIAGNOSTICO_FUERA_DE_VENTANA" })
    mockSupabaseFrom({ ordenes_servicio: createChainMock(ORDEN), orden_danos: danos })
    const { status, body } = await parseResponse(await DELETE(createGetRequest(), ctxDel()))
    expect(status).toBe(409)
    expect(body.error).toBe("Pasaron más de 10 minutos; el daño ya no se puede borrar")
  })

  it("204 al borrar", async () => {
    mockSupabaseFrom({ ordenes_servicio: createChainMock(ORDEN), orden_danos: createChainMock([{ id: "d1" }]) })
    const res = await DELETE(createGetRequest(), ctxDel())
    expect(res.status).toBe(204)
  })
})
