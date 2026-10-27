/**
 * Quotes linked to an order follow that order's branch scope. Quotes without an
 * order are unchanged (cotizaciones has no sucursal_id column).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createGetRequest,
  createPostRequest,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn().mockResolvedValue(true),
}))

import { GET as listCotizaciones } from "@/app/api/cotizaciones/route"
import { GET as getCotizacion } from "@/app/api/cotizaciones/[id]/route"
import { GET as pdfCotizacion } from "@/app/api/cotizaciones/[id]/pdf/route"
import { POST as enviarCotizacion } from "@/app/api/cotizaciones/[id]/enviar/route"
import { POST as aprobarCotizacion } from "@/app/api/cotizaciones/[id]/aprobar/route"

const S1 = "sucursal-1"
const S2 = "sucursal-2"
const U1 = "user-1"
const REF = { referencedTable: "ordenes_servicio" }
const ctx = { params: Promise.resolve({ id: "cot-1" }) }

function cot(over: Record<string, unknown> = {}) {
  return {
    id: "cot-1",
    organization_id: "org-1",
    orden_id: "orden-1",
    estado: "ENVIADA",
    created_by: U1,
    created_at: "2026-01-01T00:00:00Z",
    ordenes_servicio: { id: "orden-1", sucursal_id: S2, tecnico_id: null, clientes: { email: "a@b.c" } },
    items_cotizacion: [],
    ...over,
  }
}

describe("GET /api/cotizaciones — ordenId mode", () => {
  let chain: ReturnType<typeof createChainMock>
  beforeEach(() => {
    chain = createChainMock([])
    mockSupabaseFrom({ cotizaciones: chain })
  })

  it("VENDEDOR: the inner-joined order is limited to the branch", async () => {
    mockAuthSuccess({ role: "VENDEDOR", userId: U1, sucursalId: S1 })
    await listCotizaciones(createGetRequest("http://localhost/api/cotizaciones?ordenId=orden-1"))
    expect(chain.eq).toHaveBeenCalledWith("ordenes_servicio.sucursal_id", S1)
  })

  it("TECNICO keeps created_by and gets branch-or-assigned", async () => {
    mockAuthSuccess({ role: "TECNICO", userId: U1, sucursalId: S1 })
    await listCotizaciones(createGetRequest("http://localhost/api/cotizaciones?ordenId=orden-1"))
    expect(chain.eq).toHaveBeenCalledWith("created_by", U1)
    expect(chain.or).toHaveBeenCalledWith(`sucursal_id.eq.${S1},tecnico_id.eq.${U1}`, REF)
  })

  it("ADMIN: unchanged", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    await listCotizaciones(createGetRequest("http://localhost/api/cotizaciones?ordenId=orden-1"))
    expect(chain.or).not.toHaveBeenCalled()
    expect(chain.eq).not.toHaveBeenCalledWith("ordenes_servicio.sucursal_id", expect.anything())
  })
})

describe("GET /api/cotizaciones — standalone list", () => {
  function colas(sinOrden: { data: any[]; count: number }, conOrden: { data: any[]; count: number }) {
    const a = createChainMock(sinOrden.data, null, sinOrden.count)
    const b = createChainMock(conOrden.data, null, conOrden.count)
    const queue = [a, b]
    vi.mocked(supabaseAdmin.from).mockImplementation(((t: string) =>
      t === "cotizaciones" ? queue.shift() ?? createChainMock([]) : createChainMock([])) as any)
    return { a, b }
  }

  it("ADMIN: a single unfiltered query", async () => {
    const single = createChainMock([cot({ orden_id: null, ordenes_servicio: null })], null, 1)
    mockSupabaseFrom({ cotizaciones: single })
    mockAuthSuccess({ role: "ADMIN" })
    const { body } = await parseResponse(await listCotizaciones(createGetRequest()))
    expect(single.is).not.toHaveBeenCalledWith("orden_id", null)
    expect(single.or).not.toHaveBeenCalled()
    expect(body.total).toBe(1)
  })

  it("VENDEDOR: unlinked quotes plus quotes of in-scope orders, merged newest first", async () => {
    const { a, b } = colas(
      { data: [cot({ id: "sin-1", orden_id: null, ordenes_servicio: null, created_at: "2026-01-03T00:00:00Z" })], count: 1 },
      {
        data: [
          cot({ id: "con-1", created_at: "2026-01-04T00:00:00Z", ordenes_servicio: { id: "o", sucursal_id: S1, tecnico_id: null, clientes: null } }),
          cot({ id: "con-2", created_at: "2026-01-02T00:00:00Z", ordenes_servicio: { id: "o", sucursal_id: S1, tecnico_id: null, clientes: null } }),
        ],
        count: 2,
      }
    )
    mockAuthSuccess({ role: "VENDEDOR", userId: U1, sucursalId: S1 })
    const { body } = await parseResponse(await listCotizaciones(createGetRequest()))
    expect(a.is).toHaveBeenCalledWith("orden_id", null)
    expect(b.eq).toHaveBeenCalledWith("ordenes_servicio.sucursal_id", S1)
    expect(body.data.map((c: any) => c.id)).toEqual(["con-1", "sin-1", "con-2"])
    expect(body.total).toBe(3)
  })

  it("paginates over the merged result", async () => {
    colas(
      { data: [cot({ id: "s1", orden_id: null, ordenes_servicio: null, created_at: "2026-01-03T00:00:00Z" })], count: 1 },
      { data: [cot({ id: "c1", created_at: "2026-01-04T00:00:00Z", ordenes_servicio: { id: "o", sucursal_id: S1, tecnico_id: null, clientes: null } })], count: 1 }
    )
    mockAuthSuccess({ role: "VENDEDOR", userId: U1, sucursalId: S1 })
    const { body } = await parseResponse(
      await listCotizaciones(createGetRequest("http://localhost/api/cotizaciones?page=2&limit=1"))
    )
    expect(body.data.map((c: any) => c.id)).toEqual(["s1"])
    expect(body.total).toBe(2)
    expect(body.totalPages).toBe(2)
  })

  it("TECNICO: keeps created_by on both queries and scopes the linked one", async () => {
    const { a, b } = colas({ data: [], count: 0 }, { data: [], count: 0 })
    mockAuthSuccess({ role: "TECNICO", userId: U1, sucursalId: S1 })
    await listCotizaciones(createGetRequest())
    expect(a.eq).toHaveBeenCalledWith("created_by", U1)
    expect(b.eq).toHaveBeenCalledWith("created_by", U1)
    expect(b.or).toHaveBeenCalledWith(`sucursal_id.eq.${S1},tecnico_id.eq.${U1}`, REF)
  })
})

describe("GET /api/cotizaciones/[id]", () => {
  it("out-of-scope linked order answers like not found", async () => {
    mockSupabaseFrom({ cotizaciones: createChainMock(cot()) })
    mockAuthSuccess({ role: "VENDEDOR", userId: U1, sucursalId: S1 })
    const { status, body } = await parseResponse(await getCotizacion(createGetRequest(), ctx))
    expect(status).toBe(404)
    expect(body.error).toBe("Cotización no encontrada")
  })

  it("in-scope order is returned", async () => {
    mockSupabaseFrom({
      cotizaciones: createChainMock(cot({ ordenes_servicio: { id: "o", sucursal_id: S1, tecnico_id: null, clientes: null } })),
    })
    mockAuthSuccess({ role: "VENDEDOR", userId: U1, sucursalId: S1 })
    const { status } = await parseResponse(await getCotizacion(createGetRequest(), ctx))
    expect(status).toBe(200)
  })

  it("TECNICO assigned to the order in another branch can read it", async () => {
    mockSupabaseFrom({
      cotizaciones: createChainMock(cot({ ordenes_servicio: { id: "o", sucursal_id: S2, tecnico_id: U1, clientes: null } })),
    })
    mockAuthSuccess({ role: "TECNICO", userId: U1, sucursalId: S1 })
    const { status } = await parseResponse(await getCotizacion(createGetRequest(), ctx))
    expect(status).toBe(200)
  })

  it("unlinked quote stays readable for a branch-scoped user", async () => {
    mockSupabaseFrom({ cotizaciones: createChainMock(cot({ orden_id: null, ordenes_servicio: null })) })
    mockAuthSuccess({ role: "VENDEDOR", userId: U1, sucursalId: S1 })
    const { status } = await parseResponse(await getCotizacion(createGetRequest(), ctx))
    expect(status).toBe(200)
  })

  it("ADMIN reads any branch", async () => {
    mockSupabaseFrom({ cotizaciones: createChainMock(cot()) })
    mockAuthSuccess({ role: "ADMIN" })
    const { status } = await parseResponse(await getCotizacion(createGetRequest(), ctx))
    expect(status).toBe(200)
  })
})

describe("GET /api/cotizaciones/[id]/pdf", () => {
  it("out-of-scope answers 404", async () => {
    mockSupabaseFrom({ cotizaciones: createChainMock(cot()) })
    mockAuthSuccess({ role: "VENDEDOR", userId: U1, sucursalId: S1 })
    const { status, body } = await parseResponse(await pdfCotizacion(createGetRequest(), ctx))
    expect(status).toBe(404)
    expect(body.error).toBe("Cotizacion no encontrada")
  })
})

describe("POST /api/cotizaciones/[id]/enviar", () => {
  it("out-of-scope answers 404 before any side effect", async () => {
    const cotizaciones = createChainMock(cot())
    mockSupabaseFrom({ cotizaciones })
    mockAuthSuccess({ role: "VENDEDOR", userId: U1, sucursalId: S1 })
    const { status, body } = await parseResponse(await enviarCotizacion(createPostRequest({}), ctx))
    expect(status).toBe(404)
    expect(body.error).toBe("Cotización no encontrada")
    expect(cotizaciones.update).not.toHaveBeenCalled()
  })
})

describe("POST /api/cotizaciones/[id]/aprobar", () => {
  it("out-of-scope linked order answers 404 and approves nothing", async () => {
    const cotizaciones = createChainMock(cot({ ordenes_servicio: undefined }))
    const ordenes = createChainMock({ sucursal_id: S2, tecnico_id: null })
    mockSupabaseFrom({ cotizaciones, ordenes_servicio: ordenes })
    vi.mocked(supabaseAdmin.rpc).mockClear()
    mockAuthSuccess({ role: "VENDEDOR", userId: U1, sucursalId: S1 })
    const { status, body } = await parseResponse(await aprobarCotizacion(createPostRequest({}), ctx))
    expect(status).toBe(404)
    expect(body.error).toBe("Cotización no encontrada")
    expect(cotizaciones.update).not.toHaveBeenCalled()
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })
})
