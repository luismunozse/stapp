import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  mockAuthError,
  createChainMock,
  mockSupabaseFrom,
  createGetRequest,
  createPostRequest,
  parseResponse,
} from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  unstable_cache: vi.fn((fn: any) => fn),
}))

vi.mock("@/lib/audit", () => ({
  createAuditLogger: vi.fn(() => ({
    create: vi.fn().mockResolvedValue(undefined),
  })),
}))

import { GET, POST, DELETE } from "@/app/api/ordenes/[id]/cobros/route"

function createParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

describe("GET /api/ordenes/[id]/cobros", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 401 when not authenticated", async () => {
    mockAuthError()
    const response = await GET(createGetRequest("http://localhost:3000/api/ordenes/o1/cobros"), createParams("o1"))
    const { status } = await parseResponse(response)
    expect(status).toBe(401)
  })

  it("returns cobros with anulado field", async () => {
    mockAuthSuccess()

    const mockCobros = [
      {
        id: "c1",
        monto: "5000",
        metodo_pago: "EFECTIVO",
        numero_referencia: null,
        observaciones: null,
        cuotas: null,
        recargo_porcentaje: null,
        monto_original: null,
        created_at: "2024-01-01T10:00:00Z",
        anulado: false,
        anulado_at: null,
        anulado_motivo: null,
      },
      {
        id: "c2",
        monto: "3000",
        metodo_pago: "TRANSFERENCIA",
        numero_referencia: "REF-123",
        observaciones: "Pago parcial",
        cuotas: null,
        recargo_porcentaje: null,
        monto_original: null,
        created_at: "2024-01-02T10:00:00Z",
        anulado: true,
        anulado_at: "2024-01-03T10:00:00Z",
        anulado_motivo: "Error de monto",
      },
    ]

    const chain = createChainMock(mockCobros)
    chain.then = (resolve: any) => resolve({ data: mockCobros, error: null })
    mockSupabaseFrom({ cobros_orden: chain })

    const response = await GET(createGetRequest("http://localhost:3000/api/ordenes/o1/cobros"), createParams("o1"))
    const { status, body } = await parseResponse(response)

    expect(status).toBe(200)
    expect(body).toHaveLength(2)
    expect(body[0].anulado).toBe(false)
    expect(body[0].monto).toBe(5000)
    expect(body[1].anulado).toBe(true)
    expect(body[1].anuladoMotivo).toBe("Error de monto")
  })
})

describe("POST /api/ordenes/[id]/cobros", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 401 when not authenticated", async () => {
    mockAuthError()
    const response = await POST(
      createPostRequest({ pagos: [{ monto: 100, metodo: "EFECTIVO" }] }),
      createParams("o1")
    )
    const { status } = await parseResponse(response)
    expect(status).toBe(401)
  })

  it("returns 403 when non-admin tries to register cobro", async () => {
    mockAuthSuccess({ role: "TECNICO" })
    const response = await POST(
      createPostRequest({ pagos: [{ monto: 100, metodo: "EFECTIVO" }] }),
      createParams("o1")
    )
    const { status, body } = await parseResponse(response)
    expect(status).toBe(403)
    expect(body.error).toContain("administradores")
  })

  it("validates required fields", async () => {
    mockAuthSuccess()
    const response = await POST(
      createPostRequest({ pagos: [] }),
      createParams("o1")
    )
    const { status } = await parseResponse(response)
    expect(status).toBe(400)
  })

  it("rejects amount exceeding pending", async () => {
    mockAuthSuccess()

    const mockOrden = {
      id: "o1",
      costo_final: "5000",
      total_cobrado: "4000",
      estado_cobro: "PARCIAL",
      descuento_cobro: "0",
      cliente_id: "c1",
      organization_id: "org-1",
    }

    const chain = createChainMock(mockOrden)
    mockSupabaseFrom({ ordenes_servicio: chain })

    // RPC returns a business-rule error so the route returns 400
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "El monto total (2000.00) excede el pendiente (1000.00)" },
    } as any)

    const response = await POST(
      createPostRequest({ pagos: [{ monto: 2000, metodo: "EFECTIVO" }] }),
      createParams("o1")
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(400)
    expect(body.error).toContain("excede")
  })

  it("creates cobro and returns updated state", async () => {
    mockAuthSuccess()

    const mockOrden = {
      id: "o1",
      costo_final: "5000",
      total_cobrado: "0",
      estado_cobro: "PENDIENTE",
      descuento_cobro: "0",
      cliente_id: "c1",
      organization_id: "org-1",
    }

    const ordenChain = createChainMock(mockOrden)
    mockSupabaseFrom({ ordenes_servicio: ordenChain })

    // RPC returns atomic result — route reads response.orden directly
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: {
        replayed: false,
        response: {
          cobros: [{ id: "cob1", monto: 5000, metodo: "EFECTIVO", cuotas: null }],
          orden: { totalCobrado: 5000, estadoCobro: "COBRADO", descuento: 0 },
        },
      },
      error: null,
    } as any)

    const response = await POST(
      createPostRequest({ pagos: [{ monto: 5000, metodo: "EFECTIVO" }] }),
      createParams("o1")
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(201)
    expect(body.totalCobrado).toBe(5000)
    expect(body.estadoCobro).toBe("COBRADO")
  })
})

describe("DELETE /api/ordenes/[id]/cobros - Anulación", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 401 when not authenticated", async () => {
    mockAuthError()
    const response = await DELETE(
      new Request("http://localhost:3000/api/ordenes/o1/cobros?cobroId=c1", { method: "DELETE" }),
      createParams("o1")
    )
    const { status } = await parseResponse(response)
    expect(status).toBe(401)
  })

  it("returns 403 when non-admin tries to anular", async () => {
    mockAuthSuccess({ role: "TECNICO" })
    const response = await DELETE(
      new Request("http://localhost:3000/api/ordenes/o1/cobros?cobroId=c1", { method: "DELETE" }),
      createParams("o1")
    )
    const { status, body } = await parseResponse(response)
    expect(status).toBe(403)
    expect(body.error).toContain("administradores")
  })

  it("returns 400 when cobroId is missing", async () => {
    mockAuthSuccess()
    const response = await DELETE(
      new Request("http://localhost:3000/api/ordenes/o1/cobros", { method: "DELETE" }),
      createParams("o1")
    )
    const { status, body } = await parseResponse(response)
    expect(status).toBe(400)
    expect(body.error).toContain("cobroId")
  })

  it("returns 404 when cobro not found", async () => {
    mockAuthSuccess()
    const chain = createChainMock(null, { message: "not found" })
    mockSupabaseFrom({ cobros_orden: chain })

    const response = await DELETE(
      new Request("http://localhost:3000/api/ordenes/o1/cobros?cobroId=nonexistent", { method: "DELETE" }),
      createParams("o1")
    )
    const { status } = await parseResponse(response)
    expect(status).toBe(404)
  })

  it("returns 400 when cobro already anulado", async () => {
    mockAuthSuccess()
    const chain = createChainMock({ id: "c1", monto: "5000", anulado: true })
    mockSupabaseFrom({ cobros_orden: chain })

    const response = await DELETE(
      new Request("http://localhost:3000/api/ordenes/o1/cobros?cobroId=c1", { method: "DELETE" }),
      createParams("o1")
    )
    const { status, body } = await parseResponse(response)
    expect(status).toBe(400)
    expect(body.error).toContain("ya fue anulado")
  })

  it("anula cobro successfully", async () => {
    mockAuthSuccess()

    const cobrosChain = createChainMock({ id: "c1", monto: "5000", anulado: false })

    // Update chain needs to be chainable
    const updateChain = createChainMock(null)
    updateChain.then = (resolve: any) => resolve({ data: null, error: null })

    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: null, error: null } as any)

    let fromCallCount = 0
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      fromCallCount++
      // First call: SELECT cobro, second: UPDATE cobro
      return cobrosChain as any
    })

    const response = await DELETE(
      new Request("http://localhost:3000/api/ordenes/o1/cobros?cobroId=c1&motivo=Error%20de%20monto", { method: "DELETE" }),
      createParams("o1")
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(200)
    expect(body.message).toContain("anulado")
  })
})
