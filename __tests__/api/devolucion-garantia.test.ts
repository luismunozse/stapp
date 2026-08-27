/**
 * A return must retire the warranty it created.
 *
 * Before this, `POST /api/ventas/[id]/devolucion` never touched
 * `garantias_venta`, and the series reset left `fecha_garantia_vence` behind —
 * so a serialized unit went back to DISPONIBLE still carrying the previous
 * buyer's warranty window and, once re-sold inside it, was re-flagged
 * GARANTIA_ACTIVA off that stale date (`175_lotes_series.sql:535`).
 *
 * These cover the JS fallback path only (the RPC is the real path in prod and
 * mirrors this logic in migration 316 — there is no DB harness here).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, createPostRequest, parseResponse } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

vi.mock("@/lib/counters", () => ({
  getNextReturnNumber: vi.fn().mockResolvedValue("DEV-000001"),
}))

vi.mock("@/lib/audit", () => ({
  createAuditLogger: vi.fn(() => ({ create: vi.fn().mockResolvedValue(undefined) })),
}))

import { POST } from "@/app/api/ventas/[id]/devolucion/route"

const createParams = (id: string) => ({ params: Promise.resolve({ id }) })

const CHAIN_METHODS = [
  "select", "insert", "update", "upsert", "delete",
  "eq", "neq", "not", "gte", "lte", "gt", "lt",
  "or", "in", "is", "textSearch", "order", "limit", "range", "maybeSingle",
]

/** devoluciones_venta is hit 3x: list prior returns (array), insert, re-read. */
function makeDevChain() {
  const insertResult = { id: "d1", items_devolucion: [] }
  let calls = 0
  const chain: any = {}
  for (const m of CHAIN_METHODS) chain[m] = vi.fn().mockReturnValue(chain)
  chain.single = vi.fn().mockResolvedValue({ data: insertResult, error: null })
  chain.then = (resolve: any, reject?: any) => {
    calls++
    return Promise.resolve(calls === 1 ? { data: [], error: null } : { data: insertResult, error: null }).then(resolve, reject)
  }
  chain.catch = (reject: any) => Promise.resolve({ data: [], error: null }).catch(reject)
  return chain
}

function setup(venta: any) {
  mockAuthSuccess({ role: "ADMIN" })
  vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
    if (fn === "registrar_devolucion_atomica") {
      return Promise.resolve({ data: null, error: { code: "42883", message: "does not exist" } })
    }
    return Promise.resolve({ data: {}, error: null })
  }) as any)

  const devChain = makeDevChain()
  const garantiasChain = createChainMock(null)
  const seriesChain = createChainMock([{ id: "s1" }])

  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    if (table === "ventas") return createChainMock(venta) as any
    if (table === "devoluciones_venta") return devChain as any
    if (table === "items_devolucion") return createChainMock({ id: "id1" }) as any
    if (table === "garantias_venta") return garantiasChain as any
    if (table === "inventario_series") return seriesChain as any
    return createChainMock(null, { message: `No mock: ${table}` }) as any
  })

  return { devChain, garantiasChain, seriesChain }
}

const VENTA = {
  id: "v1",
  estado: "COMPLETADA",
  cliente_id: null,
  organization_id: "org-1",
  sucursal_id: null,
  total: 30,
  items_venta: [{ id: "iv1", cantidad: 3, descripcion: "Item", inventario_id: "inv1", precio_unitario: 10 }],
}

async function post(items: any[]) {
  return POST(
    createPostRequest({ motivo: "Defectuoso", items }, "http://localhost/api/ventas/v1/devolucion"),
    createParams("v1")
  )
}

describe("POST /api/ventas/[id]/devolucion — warranty retirement", () => {
  beforeEach(() => vi.clearAllMocks())

  it("voids the warranty of a line returned in full", async () => {
    const { garantiasChain } = setup(VENTA)

    const { status } = await parseResponse(
      await post([{ itemVentaId: "iv1", inventarioId: "inv1", cantidad: 3, precioUnitario: 10, restaurarStock: true }])
    )

    expect(status).toBe(201)
    expect(garantiasChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ estado: "ANULADA" })
    )
    expect(garantiasChain.in).toHaveBeenCalledWith("item_venta_id", ["iv1"])
    // Only warranties still live get retired — never a claimed or expired one.
    expect(garantiasChain.eq).toHaveBeenCalledWith("estado", "ACTIVA")
  })

  it("leaves the warranty alone on a partial return", async () => {
    const { garantiasChain } = setup(VENTA)

    const { status } = await parseResponse(
      await post([{ itemVentaId: "iv1", inventarioId: "inv1", cantidad: 1, precioUnitario: 10, restaurarStock: true }])
    )

    expect(status).toBe(201)
    expect(garantiasChain.update).not.toHaveBeenCalled()
  })

  it("clears fecha_garantia_vence when the serial goes back to stock", async () => {
    const { seriesChain } = setup(VENTA)

    await post([{ itemVentaId: "iv1", inventarioId: "inv1", cantidad: 3, precioUnitario: 10, restaurarStock: true }])

    expect(seriesChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ estado: "DISPONIBLE", fecha_garantia_vence: null })
    )
  })

  it("retires the serial as DEVUELTO when stock is not restored", async () => {
    const { seriesChain } = setup(VENTA)

    await post([{ itemVentaId: "iv1", inventarioId: "inv1", cantidad: 3, precioUnitario: 10, restaurarStock: false }])

    expect(seriesChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ estado: "DEVUELTO", fecha_garantia_vence: null })
    )
  })

  it("does not fail the return when voiding the warranty errors", async () => {
    const { garantiasChain } = setup(VENTA)
    garantiasChain.then = (resolve: any) =>
      Promise.resolve({ data: null, error: { message: "boom" } }).then(resolve)

    const { status } = await parseResponse(
      await post([{ itemVentaId: "iv1", inventarioId: "inv1", cantidad: 3, precioUnitario: 10, restaurarStock: true }])
    )

    // The money already moved and the goods already changed hands; a warranty
    // bookkeeping failure must not 500 the return.
    expect(status).toBe(201)
  })
})
