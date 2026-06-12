import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  mockAuthError,
  createChainMock,
  mockSupabaseFrom,
  parseResponse,
} from "./helpers"

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock("@/lib/webhooks/dispatcher", () => ({
  emitWebhookEvent: vi.fn().mockResolvedValue(undefined),
}))

import { supabaseAdmin } from "@/lib/supabase"
import { POST } from "@/app/api/inventario/[id]/stock/route"

function createStockRequest(body: any, id = "inv-1"): [Request, { params: Promise<{ id: string }> }] {
  const req = new Request(`http://localhost:3000/api/inventario/${id}/stock`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  return [req, { params: Promise.resolve({ id }) }]
}

describe("POST /api/inventario/[id]/stock", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 401 when not authenticated", async () => {
    mockAuthError()
    const [req, ctx] = createStockRequest({ mode: "delta", value: 5 })
    const res = await POST(req, ctx)
    const { status } = await parseResponse(res)
    expect(status).toBe(401)
  })

  it("maps P0002 to 404", async () => {
    mockAuthSuccess()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null,
      error: { code: "P0002", message: "Item not found" },
    } as any)

    const [req, ctx] = createStockRequest({ mode: "delta", value: 5 })
    const res = await POST(req, ctx)
    const { status } = await parseResponse(res)
    expect(status).toBe(404)
  })

  it("maps P0003 to 400 (stock negativo)", async () => {
    mockAuthSuccess()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null,
      error: { code: "P0003", message: "stock negativo" },
    } as any)

    const [req, ctx] = createStockRequest({ mode: "delta", value: -999 })
    const res = await POST(req, ctx)
    const { status, body } = await parseResponse(res)
    expect(status).toBe(400)
    expect(body.error).toContain("negativo")
  })

  it("pasa depositoId a la RPC como p_deposito_id", async () => {
    mockAuthSuccess()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: { stock: 10, changed: true, stockAnterior: 5, stockPosterior: 10, movimientoId: "m1" },
      error: null,
    } as any)
    mockSupabaseFrom({
      inventario: createChainMock({ id: "inv-1", codigo: "A1", nombre: "Item", stock: 10, punto_reorden: null, stock_minimo: null, organization_id: "org-1" }),
    })

    const [req, ctx] = createStockRequest({ mode: "delta", value: 5, depositoId: "dep-2" })
    await POST(req, ctx)

    const rpcArgs = vi.mocked(supabaseAdmin.rpc).mock.calls[0][1] as any
    expect(rpcArgs.p_deposito_id).toBe("dep-2")
  })

  it("manda p_deposito_id null cuando el body no trae depositoId", async () => {
    mockAuthSuccess()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: { stock: 10, changed: false, stockAnterior: 10, stockPosterior: 10, movimientoId: null },
      error: null,
    } as any)

    const [req, ctx] = createStockRequest({ mode: "delta", value: 5 })
    await POST(req, ctx)

    const rpcArgs = vi.mocked(supabaseAdmin.rpc).mock.calls[0][1] as any
    expect(rpcArgs.p_deposito_id).toBeNull()
  })

  it("mapea P0010 a 400 con mensaje claro", async () => {
    mockAuthSuccess()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null,
      error: { code: "P0010", message: "STOCK_INSUFICIENTE_DEPOSITO: dep-2" },
    } as any)

    const [req, ctx] = createStockRequest({ mode: "delta", value: -5, depositoId: "dep-2" })
    const res = await POST(req, ctx)
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body.error).toContain("Stock insuficiente en el depósito")
  })

  it("mapea P0011 a 400 con mensaje claro", async () => {
    mockAuthSuccess()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null,
      error: { code: "P0011", message: "ORG_SIN_DEPOSITO_PRINCIPAL: org-1" },
    } as any)

    const [req, ctx] = createStockRequest({ mode: "delta", value: -5 })
    const res = await POST(req, ctx)
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body.error).toContain("depósito principal")
  })
})
