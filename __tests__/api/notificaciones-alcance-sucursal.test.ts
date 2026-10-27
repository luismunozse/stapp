/**
 * Notification history follows the branch scope of the order each row belongs to.
 * Rows with no order keep their behavior.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import {
  createChainMock,
  mockSupabaseFrom,
  mockAuthSuccess,
  createGetRequest,
  parseResponse,
} from "./helpers"

import { GET } from "@/app/api/notificaciones/route"

const S1 = "sucursal-1"
const S2 = "sucursal-2"
const U1 = "user-1"
const REF = { referencedTable: "ordenes_servicio" }
const URL_BASE = "http://localhost:3000/api/notificaciones"

describe("GET /api/notificaciones with ordenId", () => {
  it("out-of-scope order answers 404", async () => {
    const logs = createChainMock([{ id: "l1" }])
    mockSupabaseFrom({
      notification_logs: logs,
      ordenes_servicio: createChainMock({ sucursal_id: S2, tecnico_id: null }),
    })
    mockAuthSuccess({ role: "VENDEDOR", userId: U1, sucursalId: S1 })
    const { status, body } = await parseResponse(await GET(createGetRequest(`${URL_BASE}?ordenId=o1`)))
    expect(status).toBe(404)
    expect(body.error).toBe("Orden no encontrada")
    expect(logs.select).not.toHaveBeenCalled()
  })

  it("a missing order is indistinguishable from an out-of-scope one", async () => {
    mockSupabaseFrom({
      notification_logs: createChainMock([]),
      ordenes_servicio: createChainMock(null, { message: "no rows" }),
    })
    mockAuthSuccess({ role: "VENDEDOR", userId: U1, sucursalId: S1 })
    const { status } = await parseResponse(await GET(createGetRequest(`${URL_BASE}?ordenId=nope`)))
    expect(status).toBe(404)
  })

  it("in-scope order returns its history", async () => {
    const logs = createChainMock([{ id: "l1" }])
    mockSupabaseFrom({
      notification_logs: logs,
      ordenes_servicio: createChainMock({ sucursal_id: S1, tecnico_id: null }),
    })
    mockAuthSuccess({ role: "VENDEDOR", userId: U1, sucursalId: S1 })
    const { status, body } = await parseResponse(await GET(createGetRequest(`${URL_BASE}?ordenId=o1`)))
    expect(status).toBe(200)
    expect(body).toEqual([{ id: "l1" }])
  })

  it("TECNICO assigned to an order elsewhere can read its history", async () => {
    mockSupabaseFrom({
      notification_logs: createChainMock([{ id: "l1" }]),
      ordenes_servicio: createChainMock({ sucursal_id: S2, tecnico_id: U1 }),
    })
    mockAuthSuccess({ role: "TECNICO", userId: U1, sucursalId: S1 })
    const { status } = await parseResponse(await GET(createGetRequest(`${URL_BASE}?ordenId=o1`)))
    expect(status).toBe(200)
  })

  it("ADMIN: no order lookup, behavior unchanged", async () => {
    const ordenes = createChainMock({ sucursal_id: S2, tecnico_id: null })
    mockSupabaseFrom({ notification_logs: createChainMock([{ id: "l1" }]), ordenes_servicio: ordenes })
    mockAuthSuccess({ role: "ADMIN" })
    const { status } = await parseResponse(await GET(createGetRequest(`${URL_BASE}?ordenId=o1`)))
    expect(status).toBe(200)
    expect(ordenes.select).not.toHaveBeenCalled()
  })
})

describe("GET /api/notificaciones without ordenId", () => {
  function colas(sinOrden: any[], conOrden: any[]) {
    const a = createChainMock(sinOrden)
    const b = createChainMock(conOrden)
    const queue = [a, b]
    vi.mocked(supabaseAdmin.from).mockImplementation(((t: string) =>
      t === "notification_logs" ? queue.shift() ?? createChainMock([]) : createChainMock([])) as any)
    return { a, b }
  }

  it("ADMIN: a single unfiltered query", async () => {
    const logs = createChainMock([{ id: "l1" }])
    mockSupabaseFrom({ notification_logs: logs })
    mockAuthSuccess({ role: "ADMIN" })
    await GET(createGetRequest(URL_BASE))
    expect(logs.is).not.toHaveBeenCalled()
    expect(logs.or).not.toHaveBeenCalled()
  })

  it("VENDEDOR: rows without an order plus rows of in-scope orders, newest first", async () => {
    const { a, b } = colas(
      [{ id: "sin", created_at: "2026-01-02T00:00:00Z" }],
      [
        { id: "con-1", created_at: "2026-01-03T00:00:00Z" },
        { id: "con-2", created_at: "2026-01-01T00:00:00Z" },
      ]
    )
    mockAuthSuccess({ role: "VENDEDOR", userId: U1, sucursalId: S1 })
    const { body } = await parseResponse(await GET(createGetRequest(URL_BASE)))
    expect(a.is).toHaveBeenCalledWith("orden_id", null)
    expect(b.eq).toHaveBeenCalledWith("ordenes_servicio.sucursal_id", S1)
    expect(body.map((r: any) => r.id)).toEqual(["con-1", "sin", "con-2"])
  })

  it("respects the limit over the merged rows", async () => {
    colas(
      [{ id: "sin", created_at: "2026-01-02T00:00:00Z" }],
      [{ id: "con", created_at: "2026-01-03T00:00:00Z" }]
    )
    mockAuthSuccess({ role: "VENDEDOR", userId: U1, sucursalId: S1 })
    const { body } = await parseResponse(await GET(createGetRequest(`${URL_BASE}?limit=1`)))
    expect(body.map((r: any) => r.id)).toEqual(["con"])
  })

  it("TECNICO: linked rows scoped to branch or assigned", async () => {
    const { b } = colas([], [])
    mockAuthSuccess({ role: "TECNICO", userId: U1, sucursalId: S1 })
    await GET(createGetRequest(URL_BASE))
    expect(b.or).toHaveBeenCalledWith(`sucursal_id.eq.${S1},tecnico_id.eq.${U1}`, REF)
  })
})
