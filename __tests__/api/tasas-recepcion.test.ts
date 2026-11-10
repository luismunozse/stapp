// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createPostRequest,
  createGetRequest,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/sucursal", () => ({
  sucursalParaEscritura: vi.fn().mockResolvedValue("suc-A"),
  assertSucursalEnOrg: vi.fn().mockResolvedValue(true),
}))

vi.mock("@/lib/sucursal-personal", () => ({
  sucursalParaListaPersonal: vi.fn().mockResolvedValue(null),
}))

vi.mock("@/lib/plan-limits", () => ({
  enforcePlanLimit: vi.fn().mockResolvedValue(null),
  isPlanLimitError: vi.fn().mockReturnValue(false),
  planLimitErrorResponse: vi.fn(),
}))

vi.mock("@/lib/commissions/rows", () => ({
  readCommissionRows: vi.fn().mockResolvedValue([]),
}))

vi.mock("@/lib/audit", () => ({
  createAuditLogger: vi.fn(() => ({ create: vi.fn().mockResolvedValue(undefined) })),
}))

vi.mock("@/lib/counters", () => ({
  getNextOrderNumberByType: vi.fn().mockResolvedValue({ codigo: "CEL-001", numero: 1 }),
}))

import { supabaseAdmin } from "@/lib/supabase"
import { POST as postVendedor, GET as getVendedores } from "@/app/api/vendedores/route"
import { PUT as putVendedorRoute, GET as getVendedor } from "@/app/api/vendedores/[id]/route"
import { POST as postTecnico, GET as getTecnicos } from "@/app/api/tecnicos/route"
import { PUT as putTecnicoRoute, GET as getTecnico } from "@/app/api/tecnicos/[id]/route"
import { POST as convertirOrden } from "@/app/api/cotizaciones/[id]/convertir-orden/route"

const MENSAJE = "El porcentaje de recepción debe estar entre 0 y 100"
const idParams = (id: string) => ({ params: Promise.resolve({ id }) })

const putVendedor = (body: Record<string, unknown>) => ({
  chain: createChainMock({ id: "v1", email: "v@t.com" }),
  run: (chain: ReturnType<typeof createChainMock>) => {
    mockSupabaseFrom({ users: chain })
    return putVendedorRoute(createPostRequest(body), idParams("v1"))
  },
})
const putTecnico = (body: Record<string, unknown>) => ({
  chain: createChainMock({ id: "t1", email: "t@t.com" }),
  run: (chain: ReturnType<typeof createChainMock>) => {
    mockSupabaseFrom({ users: chain })
    return putTecnicoRoute(createPostRequest(body), idParams("t1"))
  },
})

/** Payload the route handed to `users.update(...)`. */
async function updateOf(call: ReturnType<typeof putVendedor>) {
  const res = await call.run(call.chain)
  expect(res.status).toBe(200)
  return call.chain.update.mock.calls[0][0] as Record<string, unknown>
}

describe("reception rate per person", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ userId: "u-admin" })
  })

  it.each([
    ["PUT /api/vendedores/[id]", putVendedor],
    ["PUT /api/tecnicos/[id]", putTecnico],
  ])("%s writes null, a number, or nothing", async (_name, put) => {
    expect(await updateOf(put({ porcentajeComisionRecepcion: null }))).toMatchObject({
      porcentaje_comision_recepcion: null,
    })
    expect(await updateOf(put({ porcentajeComisionRecepcion: 5 }))).toMatchObject({
      porcentaje_comision_recepcion: 5,
    })
    expect(await updateOf(put({ nombre: "X" }))).not.toHaveProperty("porcentaje_comision_recepcion")
  })

  it.each([
    ["PUT /api/vendedores/[id]", putVendedor],
    ["PUT /api/tecnicos/[id]", putTecnico],
  ])("%s keeps the organization filter on the write", async (_name, put) => {
    const call = put({ porcentajeComisionRecepcion: 3 })
    await updateOf(call)
    expect(call.chain.eq).toHaveBeenCalledWith("organization_id", "org-1")
  })

  it("101 is a 400 with the reception message on all four writers", async () => {
    mockSupabaseFrom({ users: createChainMock({ id: "x", email: "x@t.com" }) })
    const novo = { nombre: "N", email: "n@t.com", password: "secret1", porcentajeComisionRecepcion: 101 }

    const responses = [
      await postVendedor(createPostRequest(novo)),
      await postTecnico(createPostRequest(novo)),
      await putVendedorRoute(createPostRequest({ porcentajeComisionRecepcion: 101 }), idParams("v1")),
      await putTecnicoRoute(createPostRequest({ porcentajeComisionRecepcion: 101 }), idParams("t1")),
    ]
    for (const res of responses) {
      const { status, body } = await parseResponse(res)
      expect(status).toBe(400)
      expect(body.error).toBe(MENSAJE)
    }
  })

  it("a negative or non numeric rate is also rejected", async () => {
    mockSupabaseFrom({ users: createChainMock({ id: "x", email: "x@t.com" }) })
    for (const value of [-1, "abc", true]) {
      const res = await putTecnicoRoute(
        createPostRequest({ porcentajeComisionRecepcion: value }),
        idParams("t1")
      )
      expect((await parseResponse(res)).body.error).toBe(MENSAJE)
      const res2 = await putVendedorRoute(
        createPostRequest({ porcentajeComisionRecepcion: value }),
        idParams("v1")
      )
      expect((await parseResponse(res2)).body.error).toBe(MENSAJE)
    }
  })

  it("POST stores NULL when the rate is absent and the number when given", async () => {
    for (const [post, extra] of [
      [postVendedor, {}],
      [postTecnico, {}],
    ] as const) {
      const chain = createChainMock(null)
      chain.single = vi.fn().mockResolvedValueOnce({ data: null, error: null }).mockResolvedValue({
        data: { id: "new" },
        error: null,
      })
      mockSupabaseFrom({ users: chain })
      const base = { nombre: "N", email: "n@t.com", password: "secret1", ...extra }
      await post(createPostRequest(base))
      expect(chain.insert.mock.calls[0][0]).toMatchObject({ porcentaje_comision_recepcion: null })

      const chain2 = createChainMock(null)
      chain2.single = vi.fn().mockResolvedValueOnce({ data: null, error: null }).mockResolvedValue({
        data: { id: "new" },
        error: null,
      })
      mockSupabaseFrom({ users: chain2 })
      await post(createPostRequest({ ...base, porcentajeComisionRecepcion: 2.5 }))
      expect(chain2.insert.mock.calls[0][0]).toMatchObject({ porcentaje_comision_recepcion: 2.5 })
    }
  })

  it("GET vendedores (list and [id]) and GET tecnicos/[id] return the rate, null when unset", async () => {
    const row = {
      id: "v1", nombre: "V", email: "v@t.com", telefono: null, activo: true,
      porcentaje_comision: 1, porcentaje_comision_recepcion: "4.50", created_at: "2026-01-01",
    }
    mockSupabaseFrom({ users: createChainMock([row]) })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: [], error: null } as any)
    const list = await parseResponse(await getVendedores(createGetRequest()))
    expect(list.body.data[0].porcentajeComisionRecepcion).toBe(4.5)

    mockSupabaseFrom({ users: createChainMock({ ...row, porcentaje_comision_recepcion: null }) })
    const one = await parseResponse(await getVendedor(createGetRequest(), idParams("v1")))
    expect(one.body.porcentajeComisionRecepcion).toBeNull()

    mockSupabaseFrom({
      users: createChainMock({ ...row, rol: "TECNICO", ordenes_servicio: [], porcentaje_comision_recepcion: 7 }),
    })
    const tec = await parseResponse(await getTecnico(createGetRequest(), idParams("v1")))
    expect(tec.body.porcentajeComisionRecepcion).toBe(7)
  })

  it("GET /api/tecnicos returns the reception rate to ADMIN only", async () => {
    const row = {
      id: "t1", nombre: "T", email: "t@t.com", telefono: null, activo: true,
      especialidades: [], porcentaje_comision: 10, porcentaje_comision_recepcion: 3,
      sucursal_id: "suc-A", ordenes_servicio: [],
    }
    mockSupabaseFrom({ users: createChainMock([row]) })

    mockAuthSuccess({ role: "ADMIN" })
    const admin = await parseResponse(await getTecnicos(createGetRequest()))
    expect(admin.body[0].porcentajeComisionRecepcion).toBe(3)

    mockAuthSuccess({ role: "TECNICO" })
    const tecnico = await parseResponse(await getTecnicos(createGetRequest()))
    expect(tecnico.status).toBe(200)
    expect(tecnico.body[0]).not.toHaveProperty("porcentajeComisionRecepcion")
  })

  it("GET /api/tecnicos returns the hourly cost to ADMIN only, so editing cannot zero it", async () => {
    const row = {
      id: "t1", nombre: "T", email: "t@t.com", telefono: null, activo: true,
      especialidades: [], porcentaje_comision: 10, porcentaje_comision_recepcion: null,
      costo_hora: 12.5, sucursal_id: "suc-A", ordenes_servicio: [],
    }
    mockSupabaseFrom({ users: createChainMock([row]) })

    mockAuthSuccess({ role: "ADMIN" })
    const admin = await parseResponse(await getTecnicos(createGetRequest()))
    expect(admin.body[0].costoHora).toBe(12.5)

    mockAuthSuccess({ role: "TECNICO" })
    const tecnico = await parseResponse(await getTecnicos(createGetRequest()))
    expect(tecnico.body[0]).not.toHaveProperty("costoHora")
  })

  it("a converted quote records who converted it as the receiver", async () => {
    let inserted: any = null
    const cotizacion = {
      id: "cot-1", numero_cotizacion: "PRES-001", tipo: "PRESUPUESTO", convertida_a_orden_id: null,
      cliente_id: "c1", total: 1000, sector_id: null,
      equipo_snapshot: {
        dispositivo: "iPhone", problemaReportado: "Pantalla", tipoDispositivo: "CELULAR", condiciones: {},
      },
      checklist_snapshot: null,
    }
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ordenes_servicio") {
        return {
          insert: vi.fn().mockImplementation((payload: any) => {
            inserted = payload
            return {
              select: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({ data: { id: "ord-1" }, error: null }),
            }
          }),
        } as any
      }
      return createChainMock(cotizacion) as any
    })

    const res = await convertirOrden(createPostRequest({}), idParams("cot-1"))
    expect(res.status).toBe(201)
    expect(inserted.recibido_por).toBe("u-admin")
  })
})
