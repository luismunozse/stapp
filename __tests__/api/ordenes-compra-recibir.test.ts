import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  mockAuthError,
  createChainMock,
  mockSupabaseFrom,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/depositos", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/depositos")>()),
  depositoPermitido: vi.fn(),
}))

import { supabaseAdmin } from "@/lib/supabase"
import { depositoPermitido, DEPOSITO_INVALIDO } from "@/lib/depositos"
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
    vi.mocked(depositoPermitido).mockResolvedValue(true)
  })

  it("rechaza con 400 un depositoId no permitido y NO llama a la RPC", async () => {
    mockAuthSuccess()
    mockSupabaseFrom({
      ordenes_compra: createChainMock({ id: "oc-1", estado: "ENVIADA" }),
    })
    vi.mocked(depositoPermitido).mockResolvedValue(false)

    const [req, ctx] = createRecibirRequest({ ...validBody, depositoId: "dep-ajeno" })
    const { status, body } = await parseResponse(await POST(req, ctx))

    expect(status).toBe(400)
    expect(body.error).toBe(DEPOSITO_INVALIDO)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("valida el depositoId con alcance sucursal, el rol y la sucursal de la sesion", async () => {
    mockAuthSuccess({ role: "ADMIN", sucursalId: "suc-1", organizationId: "org-9" })
    mockSupabaseFrom({
      ordenes_compra: createChainMock({ id: "oc-1", estado: "ENVIADA" }),
    })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { estado: "RECIBIDA" }, error: null } as any)

    const [req, ctx] = createRecibirRequest({ ...validBody, depositoId: "dep-2" })
    await POST(req, ctx)

    expect(depositoPermitido).toHaveBeenCalledWith({
      depositoId: "dep-2",
      organizationId: "org-9",
      role: "ADMIN",
      userSucursalId: "suc-1",
      alcance: "sucursal",
    })
  })

  it("sin depositoId no valida (queda el default del servidor)", async () => {
    mockAuthSuccess()
    mockSupabaseFrom({
      ordenes_compra: createChainMock({ id: "oc-1", estado: "ENVIADA" }),
    })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { estado: "RECIBIDA" }, error: null } as any)

    const [req, ctx] = createRecibirRequest(validBody)
    await POST(req, ctx)

    expect(depositoPermitido).not.toHaveBeenCalled()
  })

  it("responde 500 sin llamar a la RPC si la validacion del deposito falla", async () => {
    mockAuthSuccess()
    mockSupabaseFrom({
      ordenes_compra: createChainMock({ id: "oc-1", estado: "ENVIADA" }),
    })
    vi.mocked(depositoPermitido).mockRejectedValue(new Error("db down"))
    vi.spyOn(console, "error").mockImplementation(() => {})

    const [req, ctx] = createRecibirRequest({ ...validBody, depositoId: "dep-2" })
    const res = await POST(req, ctx)

    expect(res.status).toBe(500)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
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
