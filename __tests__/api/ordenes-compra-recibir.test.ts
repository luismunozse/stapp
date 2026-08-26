import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  mockAuthError,
  createChainMock,
  mockSupabaseFrom,
  parseResponse,
} from "./helpers"

import { supabaseAdmin } from "@/lib/supabase"
import { POST } from "@/app/api/ordenes-compra/[id]/recibir/route"

function createRecibirRequest(body: any, id = "oc-1"): [Request, { params: Promise<{ id: string }> }] {
  const req = new Request(`http://localhost:3000/api/ordenes-compra/${id}/recibir`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  return [req, { params: Promise.resolve({ id }) }]
}

const validBody = {
  items: [{ itemId: "item-1", cantidadRecibida: 3 }],
  // Obligatorio desde la migración 313: sin clave de idempotencia un reintento
  // no se distingue de una segunda recepción real.
  requestId: "req-test-1",
}

describe("POST /api/ordenes-compra/[id]/recibir", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 401 when not authenticated", async () => {
    mockAuthError()
    const [req, ctx] = createRecibirRequest(validBody)
    const res = await POST(req, ctx)
    const { status } = await parseResponse(res)
    expect(status).toBe(401)
  })

  it("returns 404 when OC does not exist", async () => {
    mockAuthSuccess()
    mockSupabaseFrom({
      ordenes_compra: createChainMock(null, { code: "PGRST116", message: "not found" }),
    })

    const [req, ctx] = createRecibirRequest(validBody)
    const res = await POST(req, ctx)
    const { status } = await parseResponse(res)
    expect(status).toBe(404)
  })

  it("returns 400 when OC estado is not ENVIADA or RECIBIDA_PARCIAL", async () => {
    mockAuthSuccess()
    mockSupabaseFrom({
      ordenes_compra: createChainMock({ id: "oc-1", estado: "BORRADOR" }),
    })

    const [req, ctx] = createRecibirRequest(validBody)
    const res = await POST(req, ctx)
    const { status } = await parseResponse(res)
    expect(status).toBe(400)
  })

  it("pasa depositoId a la RPC como p_deposito_id", async () => {
    mockAuthSuccess()
    mockSupabaseFrom({
      ordenes_compra: createChainMock({ id: "oc-1", estado: "ENVIADA" }),
    })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { estado: "RECIBIDA" }, error: null } as any)

    const [req, ctx] = createRecibirRequest({ ...validBody, depositoId: "dep-2" })
    await POST(req, ctx)

    const rpcArgs = vi.mocked(supabaseAdmin.rpc).mock.calls[0][1] as any
    expect(rpcArgs.p_deposito_id).toBe("dep-2")
  })

  it("manda p_deposito_id null cuando el body no trae depositoId", async () => {
    mockAuthSuccess()
    mockSupabaseFrom({
      ordenes_compra: createChainMock({ id: "oc-1", estado: "ENVIADA" }),
    })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { estado: "RECIBIDA" }, error: null } as any)

    const [req, ctx] = createRecibirRequest(validBody)
    await POST(req, ctx)

    const rpcArgs = vi.mocked(supabaseAdmin.rpc).mock.calls[0][1] as any
    expect(rpcArgs.p_deposito_id).toBeNull()
  })

  it("mapea P0010 a 400 con mensaje claro", async () => {
    mockAuthSuccess()
    mockSupabaseFrom({
      ordenes_compra: createChainMock({ id: "oc-1", estado: "ENVIADA" }),
    })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null,
      error: { code: "P0010", message: "STOCK_INSUFICIENTE_DEPOSITO: dep-2" },
    } as any)

    const [req, ctx] = createRecibirRequest({ ...validBody, depositoId: "dep-2" })
    const res = await POST(req, ctx)
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body.error).toContain("Stock insuficiente en el depósito")
  })

  it("mapea P0011 a 400 sin filtrar org id en la respuesta", async () => {
    mockAuthSuccess()
    mockSupabaseFrom({
      ordenes_compra: createChainMock({ id: "oc-1", estado: "ENVIADA" }),
    })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null,
      error: { code: "P0011", message: "ORG_SIN_DEPOSITO_PRINCIPAL: org-1" },
    } as any)

    const [req, ctx] = createRecibirRequest(validBody)
    const res = await POST(req, ctx)
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body.error).toContain("depósito principal")
    // Must NOT leak the raw org id to the client
    expect(body.error).not.toContain("org-1")
  })
})
