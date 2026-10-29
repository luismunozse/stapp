// @vitest-environment node
/**
 * Routes that act on ONE quote follow the branch scope of the order the quote is linked to,
 * the same rule the read routes already apply (cotizaciones-alcance-sucursal.test.ts):
 *
 *  - VENDEDOR: only orders of their current branch.
 *  - TECNICO: their current branch plus orders assigned to them in any branch.
 *  - ADMIN: every branch; the branch switcher is ignored for a record opened by id.
 *  - A quote with no linked order keeps its current behavior.
 *
 * Out of scope answers the same 404 as a missing quote, before any write, RPC or counter.
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

vi.mock("@/lib/counters", () => ({
  getNextQuoteNumber: vi.fn().mockResolvedValue("COT-999"),
}))

vi.mock("@/lib/audit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/audit")>()),
  getAuditLogs: vi.fn().mockResolvedValue([{ id: "log-1" }]),
}))

vi.mock("@/lib/sucursal", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sucursal")>()),
  sucursalParaEscritura: vi.fn().mockResolvedValue("sucursal-1"),
}))

import { getAuditLogs } from "@/lib/audit"
import { PUT as putCotizacion } from "@/app/api/cotizaciones/[id]/route"
import { POST as duplicarCotizacion } from "@/app/api/cotizaciones/[id]/duplicar/route"
import { GET as historialCotizacion } from "@/app/api/cotizaciones/[id]/historial/route"
import { POST as convertirVenta } from "@/app/api/cotizaciones/[id]/convertir-venta/route"

const S1 = "sucursal-1"
const S2 = "sucursal-2"
const U1 = "user-1"
const ctx = { params: Promise.resolve({ id: "cot-1" }) }
const NO_ENCONTRADA = /Cotizaci[oó]n no encontrada/i

const ordenEn = (sucursal: string, tecnico: string | null = null) => ({
  id: "orden-1",
  sucursal_id: sucursal,
  tecnico_id: tecnico,
  clientes: null,
})

function cot(over: Record<string, unknown> = {}) {
  return {
    id: "cot-1",
    organization_id: "org-1",
    orden_id: "orden-1",
    estado: "BORRADOR",
    tipo: "ORDEN",
    created_by: U1,
    created_at: "2026-01-01T00:00:00Z",
    numero_cotizacion: "COT-001",
    ordenes_servicio: ordenEn(S2),
    items_cotizacion: [],
    ...over,
  }
}

function putRequest(body: unknown) {
  return new Request("http://localhost:3000/api/cotizaciones/cot-1", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

const ventaBody = { metodoPago: "EFECTIVO", items: [{ cotizacionItemId: "item-1", diasGarantia: 0 }] }

/** No write of any kind reached the database. */
function sinEscrituras(...cadenas: Array<ReturnType<typeof createChainMock>>) {
  for (const c of cadenas) {
    expect(c.insert).not.toHaveBeenCalled()
    expect(c.update).not.toHaveBeenCalled()
    expect(c.upsert).not.toHaveBeenCalled()
    expect(c.delete).not.toHaveBeenCalled()
  }
  expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAuditLogs).mockResolvedValue([{ id: "log-1" }] as any)
})

describe("PUT /api/cotizaciones/[id]", () => {
  it("VENDEDOR of another branch: 404 and nothing is written", async () => {
    const cotizaciones = createChainMock(cot())
    mockSupabaseFrom({ cotizaciones })
    mockAuthSuccess({ role: "VENDEDOR", userId: U1, sucursalId: S1 })
    const { status, body } = await parseResponse(await putCotizacion(putRequest({ notas: "x" }), ctx))
    expect(status).toBe(404)
    expect(body.error).toMatch(NO_ENCONTRADA)
    sinEscrituras(cotizaciones)
  })

  it("VENDEDOR of the same branch: allowed", async () => {
    mockSupabaseFrom({ cotizaciones: createChainMock(cot({ ordenes_servicio: ordenEn(S1) })) })
    mockAuthSuccess({ role: "VENDEDOR", userId: U1, sucursalId: S1 })
    const { status } = await parseResponse(await putCotizacion(putRequest({ notas: "x" }), ctx))
    expect(status).toBe(200)
  })

  it("TECNICO assigned to the order in another branch: allowed", async () => {
    mockSupabaseFrom({ cotizaciones: createChainMock(cot({ ordenes_servicio: ordenEn(S2, U1) })) })
    mockAuthSuccess({ role: "TECNICO", userId: U1, sucursalId: S1 })
    const { status } = await parseResponse(await putCotizacion(putRequest({ notas: "x" }), ctx))
    expect(status).toBe(200)
  })

  it("TECNICO not assigned, other branch: 404", async () => {
    const cotizaciones = createChainMock(cot({ ordenes_servicio: ordenEn(S2, "otro") }))
    mockSupabaseFrom({ cotizaciones })
    mockAuthSuccess({ role: "TECNICO", userId: U1, sucursalId: S1 })
    const { status } = await parseResponse(await putCotizacion(putRequest({ notas: "x" }), ctx))
    expect(status).toBe(404)
    sinEscrituras(cotizaciones)
  })

  it("ADMIN with another branch selected: allowed", async () => {
    mockSupabaseFrom({ cotizaciones: createChainMock(cot()) })
    mockAuthSuccess({ role: "ADMIN", userId: U1, sucursalId: S1 })
    const { status } = await parseResponse(await putCotizacion(putRequest({ notas: "x" }), ctx))
    expect(status).toBe(200)
  })

  it("quote without an order: unchanged for a branch-scoped user", async () => {
    mockSupabaseFrom({ cotizaciones: createChainMock(cot({ orden_id: null, ordenes_servicio: null })) })
    mockAuthSuccess({ role: "VENDEDOR", userId: U1, sucursalId: S1 })
    const { status } = await parseResponse(await putCotizacion(putRequest({ notas: "x" }), ctx))
    expect(status).toBe(200)
  })

  it("re-linking to an order of another branch answers like a missing target order", async () => {
    const cotizaciones = createChainMock(cot({ orden_id: null, ordenes_servicio: null }))
    const ordenes = createChainMock({ id: "orden-9", organization_id: "org-1", sucursal_id: S2, tecnico_id: null })
    mockSupabaseFrom({ cotizaciones, ordenes_servicio: ordenes })
    mockAuthSuccess({ role: "VENDEDOR", userId: U1, sucursalId: S1 })
    const { status, body } = await parseResponse(await putCotizacion(putRequest({ ordenId: "orden-9" }), ctx))
    expect(status).toBe(404)
    expect(body.error).toBe("Orden destino no encontrada")
    sinEscrituras(cotizaciones, ordenes)
  })
})

describe("POST /api/cotizaciones/[id]/duplicar", () => {
  it("VENDEDOR of another branch: 404 and no number, no copy", async () => {
    const cotizaciones = createChainMock(cot())
    mockSupabaseFrom({ cotizaciones, organizations: createChainMock({ cotizacion_validez_dias: 30 }) })
    mockAuthSuccess({ role: "VENDEDOR", userId: U1, sucursalId: S1 })
    const { status, body } = await parseResponse(await duplicarCotizacion(createPostRequest({}), ctx))
    expect(status).toBe(404)
    expect(body.error).toMatch(NO_ENCONTRADA)
    sinEscrituras(cotizaciones)
    const { getNextQuoteNumber } = await import("@/lib/counters")
    expect(getNextQuoteNumber).not.toHaveBeenCalled()
  })

  it("VENDEDOR of the same branch: allowed", async () => {
    mockSupabaseFrom({
      cotizaciones: createChainMock(cot({ ordenes_servicio: ordenEn(S1) })),
      organizations: createChainMock({ cotizacion_validez_dias: 30 }),
    })
    mockAuthSuccess({ role: "VENDEDOR", userId: U1, sucursalId: S1 })
    const { status } = await parseResponse(await duplicarCotizacion(createPostRequest({}), ctx))
    expect(status).toBe(201)
  })

  it("TECNICO assigned to the order in another branch: allowed", async () => {
    mockSupabaseFrom({
      cotizaciones: createChainMock(cot({ ordenes_servicio: ordenEn(S2, U1) })),
      organizations: createChainMock({ cotizacion_validez_dias: 30 }),
    })
    mockAuthSuccess({ role: "TECNICO", userId: U1, sucursalId: S1 })
    const { status } = await parseResponse(await duplicarCotizacion(createPostRequest({}), ctx))
    expect(status).toBe(201)
  })

  it("ADMIN with another branch selected: allowed", async () => {
    mockSupabaseFrom({
      cotizaciones: createChainMock(cot()),
      organizations: createChainMock({ cotizacion_validez_dias: 30 }),
    })
    mockAuthSuccess({ role: "ADMIN", userId: U1, sucursalId: S1 })
    const { status } = await parseResponse(await duplicarCotizacion(createPostRequest({}), ctx))
    expect(status).toBe(201)
  })

  it("quote without an order: unchanged for a branch-scoped user", async () => {
    mockSupabaseFrom({
      cotizaciones: createChainMock(cot({ orden_id: null, ordenes_servicio: null })),
      organizations: createChainMock({ cotizacion_validez_dias: 30 }),
    })
    mockAuthSuccess({ role: "VENDEDOR", userId: U1, sucursalId: S1 })
    const { status } = await parseResponse(await duplicarCotizacion(createPostRequest({}), ctx))
    expect(status).toBe(201)
  })
})

describe("GET /api/cotizaciones/[id]/historial", () => {
  it("VENDEDOR of another branch: 404 and the log is not read", async () => {
    mockSupabaseFrom({ cotizaciones: createChainMock(cot()) })
    mockAuthSuccess({ role: "VENDEDOR", userId: U1, sucursalId: S1 })
    const { status, body } = await parseResponse(await historialCotizacion(createGetRequest(), ctx))
    expect(status).toBe(404)
    expect(body.error).toMatch(NO_ENCONTRADA)
    expect(getAuditLogs).not.toHaveBeenCalled()
  })

  it("TECNICO assigned to the order in another branch: allowed", async () => {
    mockSupabaseFrom({ cotizaciones: createChainMock(cot({ ordenes_servicio: ordenEn(S2, U1) })) })
    mockAuthSuccess({ role: "TECNICO", userId: U1, sucursalId: S1 })
    const { status, body } = await parseResponse(await historialCotizacion(createGetRequest(), ctx))
    expect(status).toBe(200)
    expect(body).toEqual([{ id: "log-1" }])
  })

  it("ADMIN with another branch selected: allowed", async () => {
    mockSupabaseFrom({ cotizaciones: createChainMock(cot()) })
    mockAuthSuccess({ role: "ADMIN", userId: U1, sucursalId: S1 })
    const { status } = await parseResponse(await historialCotizacion(createGetRequest(), ctx))
    expect(status).toBe(200)
  })

  it("quote without an order: unchanged for a branch-scoped user", async () => {
    mockSupabaseFrom({ cotizaciones: createChainMock(cot({ orden_id: null, ordenes_servicio: null })) })
    mockAuthSuccess({ role: "VENDEDOR", userId: U1, sucursalId: S1 })
    const { status } = await parseResponse(await historialCotizacion(createGetRequest(), ctx))
    expect(status).toBe(200)
  })
})

describe("POST /api/cotizaciones/[id]/convertir-venta", () => {
  // Org opts technicians in, so TECNICO reaches the scope check.
  const organizations = () => createChainMock({ tecnicos_cobran_cotizaciones: true })

  it("TECNICO not assigned, other branch: 404 before any write or RPC", async () => {
    const cotizaciones = createChainMock(cot({ ordenes_servicio: ordenEn(S2, "otro") }))
    mockSupabaseFrom({ cotizaciones, organizations: organizations() })
    mockAuthSuccess({ role: "TECNICO", userId: U1, sucursalId: S1 })
    const { status, body } = await parseResponse(await convertirVenta(createPostRequest(ventaBody), ctx))
    expect(status).toBe(404)
    expect(body.error).toMatch(NO_ENCONTRADA)
    sinEscrituras(cotizaciones)
  })

  it("TECNICO assigned to the order in another branch: gets past the scope check", async () => {
    mockSupabaseFrom({
      cotizaciones: createChainMock(cot({ ordenes_servicio: ordenEn(S2, U1) })),
      organizations: organizations(),
    })
    mockAuthSuccess({ role: "TECNICO", userId: U1, sucursalId: S1 })
    const { status, body } = await parseResponse(await convertirVenta(createPostRequest(ventaBody), ctx))
    // Not accepted yet: the next guard answers 400, proving the scope check let it through.
    expect(status).toBe(400)
    expect(body.error).toMatch(/aceptadas/i)
  })

  it("ADMIN with another branch selected: gets past the scope check", async () => {
    mockSupabaseFrom({ cotizaciones: createChainMock(cot()) })
    mockAuthSuccess({ role: "ADMIN", userId: U1, sucursalId: S1 })
    const { status } = await parseResponse(await convertirVenta(createPostRequest(ventaBody), ctx))
    expect(status).toBe(400)
  })

  it("quote without an order: unchanged for a branch-scoped technician", async () => {
    mockSupabaseFrom({
      cotizaciones: createChainMock(cot({ orden_id: null, ordenes_servicio: null })),
      organizations: organizations(),
    })
    mockAuthSuccess({ role: "TECNICO", userId: U1, sucursalId: S1 })
    const { status } = await parseResponse(await convertirVenta(createPostRequest(ventaBody), ctx))
    expect(status).toBe(400)
  })
})

describe("the select the scope check depends on", () => {
  // The mock returns the embedded order whatever the select asked for, so the select itself is pinned
  // here: without `orden_id` or the embed (with both columns) the check would see no order and widen.
  const EMBED = /ordenes_servicio!cotizaciones_orden_id_fkey\s*\([^)]*\bsucursal_id\b[^)]*\btecnico_id\b/
  const ADMIN_OK = { role: "ADMIN", userId: U1, sucursalId: S1 }

  const casos: Array<[string, () => Promise<Response>]> = [
    ["PUT [id]", () => putCotizacion(putRequest({ notas: "x" }), ctx)],
    ["duplicar", () => duplicarCotizacion(createPostRequest({}), ctx)],
    ["historial", () => historialCotizacion(createGetRequest(), ctx)],
    ["convertir-venta", () => convertirVenta(createPostRequest(ventaBody), ctx)],
  ]

  it.each(casos)("%s selects orden_id and the order with sucursal_id and tecnico_id", async (_n, llamar) => {
    const cotizaciones = createChainMock(cot())
    mockSupabaseFrom({ cotizaciones, organizations: createChainMock({ cotizacion_validez_dias: 30 }) })
    mockAuthSuccess(ADMIN_OK)
    await llamar()
    const seleccion = String(cotizaciones.select.mock.calls[0][0])
    expect(seleccion).toMatch(EMBED)
    // `*` carries orden_id; otherwise it must be listed (not counting the fkey name in the embed).
    const sinEmbed = seleccion.replace("cotizaciones_orden_id_fkey", "")
    expect(sinEmbed.includes("*") || /\borden_id\b/.test(sinEmbed)).toBe(true)
  })

  it.each(casos)("%s: a linked quote whose order embed is null is a 404 for VENDEDOR and TECNICO", async (_n, llamar) => {
    // convertir-venta is closed to VENDEDOR by its own role guard (403), so only TECNICO reaches the scope check.
    for (const role of _n === "convertir-venta" ? ["TECNICO"] : ["VENDEDOR", "TECNICO"]) {
      vi.clearAllMocks()
      vi.mocked(getAuditLogs).mockResolvedValue([] as any)
      mockSupabaseFrom({
        cotizaciones: createChainMock(cot({ ordenes_servicio: null })),
        organizations: createChainMock({ cotizacion_validez_dias: 30, tecnicos_cobran_cotizaciones: true }),
      })
      mockAuthSuccess({ role, userId: U1, sucursalId: S1 })
      expect((await llamar()).status, `${role}`).toBe(404)
    }
  })

  it.each(casos)("%s: a linked quote whose order embed is null is allowed for ADMIN", async (_n, llamar) => {
    mockSupabaseFrom({
      cotizaciones: createChainMock(cot({ ordenes_servicio: null })),
      organizations: createChainMock({ cotizacion_validez_dias: 30 }),
    })
    mockAuthSuccess(ADMIN_OK)
    expect((await llamar()).status).not.toBe(404)
  })

  it("historial for a quote that does not exist answers 404", async () => {
    mockSupabaseFrom({ cotizaciones: createChainMock(null, { message: "not found" }) })
    mockAuthSuccess(ADMIN_OK)
    const { status, body } = await parseResponse(await historialCotizacion(createGetRequest(), ctx))
    expect(status).toBe(404)
    expect(body.error).toMatch(NO_ENCONTRADA)
    expect(getAuditLogs).not.toHaveBeenCalled()
  })
})
