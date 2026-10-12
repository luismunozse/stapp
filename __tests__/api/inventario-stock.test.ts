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

vi.mock("@/lib/depositos", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/depositos")>()),
  depositoPermitido: vi.fn(),
  depositoPorDefecto: vi.fn(),
}))

import { supabaseAdmin } from "@/lib/supabase"
import { depositoPermitido, depositoPorDefecto, DEPOSITO_INVALIDO } from "@/lib/depositos"
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
    vi.mocked(depositoPermitido).mockResolvedValue(true)
    vi.mocked(depositoPorDefecto).mockResolvedValue(null)
  })

  it("rechaza con 400 un depositoId no permitido y NO llama a la RPC", async () => {
    mockAuthSuccess({ role: "VENDEDOR", sucursalId: "suc-1" })
    mockSupabaseFrom({ organizations: createChainMock({ vendedores_administran_inventario: true }) })
    vi.mocked(depositoPermitido).mockResolvedValue(false)

    const [req, ctx] = createStockRequest({ mode: "delta", value: 5, depositoId: "dep-ajeno" })
    const res = await POST(req, ctx)
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body.error).toBe(DEPOSITO_INVALIDO)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("valida el depositoId con alcance sucursal, el rol y la sucursal de la sesion", async () => {
    mockAuthSuccess({ role: "VENDEDOR", sucursalId: "suc-1", organizationId: "org-9" })
    mockSupabaseFrom({ organizations: createChainMock({ vendedores_administran_inventario: true }) })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: { stock: 1, changed: false, stockAnterior: 1, stockPosterior: 1, movimientoId: null },
      error: null,
    } as any)

    const [req, ctx] = createStockRequest({ mode: "delta", value: 5, depositoId: "dep-2" })
    await POST(req, ctx)

    expect(depositoPermitido).toHaveBeenCalledWith({
      depositoId: "dep-2",
      organizationId: "org-9",
      role: "VENDEDOR",
      userSucursalId: "suc-1",
      alcance: "sucursal",
    })
  })

  it("no valida nada cuando no hay depositoId (queda el default del servidor)", async () => {
    mockAuthSuccess()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: { stock: 1, changed: false, stockAnterior: 1, stockPosterior: 1, movimientoId: null },
      error: null,
    } as any)

    const [req, ctx] = createStockRequest({ mode: "delta", value: 5 })
    await POST(req, ctx)

    expect(depositoPermitido).not.toHaveBeenCalled()
    expect(supabaseAdmin.rpc).toHaveBeenCalled()
  })

  it("responde 500 y no llama a la RPC si la validacion del deposito falla", async () => {
    mockAuthSuccess()
    vi.mocked(depositoPermitido).mockRejectedValue(new Error("db down"))
    vi.spyOn(console, "error").mockImplementation(() => {})

    const [req, ctx] = createStockRequest({ mode: "delta", value: 5, depositoId: "dep-2" })
    const res = await POST(req, ctx)

    expect(res.status).toBe(500)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
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

  describe("sin depositoId: depósito por defecto de la sucursal", () => {
    const okRpc = {
      data: { stock: 10, changed: false, stockAnterior: 10, stockPosterior: 10, movimientoId: null },
      error: null,
    }

    it("VENDEDOR de la sucursal B: la RPC recibe el depósito de B, sin revalidarlo", async () => {
      mockAuthSuccess({ role: "VENDEDOR", sucursalId: "suc-b", organizationId: "org-9" })
      mockSupabaseFrom({ organizations: createChainMock({ vendedores_administran_inventario: true }) })
      vi.mocked(depositoPorDefecto).mockResolvedValue("dep-b")
      vi.mocked(supabaseAdmin.rpc).mockResolvedValue(okRpc as any)

      const [req, ctx] = createStockRequest({ mode: "delta", value: -1 })
      await POST(req, ctx)

      expect(depositoPorDefecto).toHaveBeenCalledWith({
        organizationId: "org-9",
        role: "VENDEDOR",
        userSucursalId: "suc-b",
      })
      expect(depositoPermitido).not.toHaveBeenCalled()
      const rpcArgs = vi.mocked(supabaseAdmin.rpc).mock.calls[0][1] as any
      expect(rpcArgs.p_deposito_id).toBe("dep-b")
    })

    it("ADMIN viendo todas (default null): la RPC recibe p_deposito_id null", async () => {
      mockAuthSuccess({ role: "ADMIN" })
      vi.mocked(depositoPorDefecto).mockResolvedValue(null)
      vi.mocked(supabaseAdmin.rpc).mockResolvedValue(okRpc as any)

      const [req, ctx] = createStockRequest({ mode: "delta", value: -1 })
      await POST(req, ctx)

      const rpcArgs = vi.mocked(supabaseAdmin.rpc).mock.calls[0][1] as any
      expect(rpcArgs.p_deposito_id).toBeNull()
    })

    it("con depositoId explícito no consulta el default", async () => {
      mockAuthSuccess({ role: "VENDEDOR", sucursalId: "suc-b" })
      mockSupabaseFrom({ organizations: createChainMock({ vendedores_administran_inventario: true }) })
      vi.mocked(supabaseAdmin.rpc).mockResolvedValue(okRpc as any)

      const [req, ctx] = createStockRequest({ mode: "delta", value: -1, depositoId: "dep-2" })
      await POST(req, ctx)

      expect(depositoPorDefecto).not.toHaveBeenCalled()
      const rpcArgs = vi.mocked(supabaseAdmin.rpc).mock.calls[0][1] as any
      expect(rpcArgs.p_deposito_id).toBe("dep-2")
    })

    it("P0010 con el depósito por defecto: 400 que nombra el depósito de la sucursal", async () => {
      mockAuthSuccess({ role: "VENDEDOR", sucursalId: "suc-b" })
      mockSupabaseFrom({ organizations: createChainMock({ vendedores_administran_inventario: true }) })
      vi.mocked(depositoPorDefecto).mockResolvedValue("dep-b")
      vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
        data: null,
        error: { code: "P0010", message: "STOCK_INSUFICIENTE_DEPOSITO: dep-b" },
      } as any)

      const [req, ctx] = createStockRequest({ mode: "delta", value: -5 })
      const { status, body } = await parseResponse(await POST(req, ctx))

      expect(status).toBe(400)
      expect(body.error).toContain("No hay stock suficiente en el depósito de tu sucursal")
    })
  })
})
