/**
 * Tests: GET /api/clientes/[id]/deuda-sucursal
 *
 * Covers:
 *   - 401 when unauthenticated
 *   - 404 when cliente is unknown or belongs to another org
 *   - branch-scoped operator (TECNICO/VENDEDOR) → RPC called with p_sucursal_id = their branch
 *   - ADMIN verTodas (no cookie / cookie "todas") → RPC called with p_sucursal_id = null
 *   - response shape { deudaTotal, deudaFiado, deudaOrdenes }
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth } from "@/lib/auth"
import { cookies } from "next/headers"
import { supabaseAdmin } from "@/lib/supabase"
import { mockAuthError, createChainMock, createGetRequest, parseResponse } from "./helpers"

import { GET } from "@/app/api/clientes/[id]/deuda-sucursal/route"

function mockAuthWithSucursal(opts: {
  role?: string
  userId?: string
  organizationId?: string
  sucursalId?: string | null
}) {
  vi.mocked(auth).mockResolvedValue({
    user: {
      id: opts.userId ?? "user-1",
      organizationId: opts.organizationId ?? "org-1",
      role: opts.role ?? "ADMIN",
      sucursalId: opts.sucursalId ?? null,
      email: "test@test.com",
    },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any)
}

function mockCookie(value: string | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn((name: string) =>
      name === "stapp-sucursal-activa" && value ? { value } : undefined
    ),
    set: vi.fn(),
  } as any)
}

function callRoute(clienteId = "cliente-1") {
  return GET(
    createGetRequest(`http://localhost:3000/api/clientes/${clienteId}/deuda-sucursal`),
    { params: Promise.resolve({ id: clienteId }) }
  )
}

describe("GET /api/clientes/[id]/deuda-sucursal", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 401 when not authenticated", async () => {
    mockAuthError()

    const response = await callRoute()
    const { status } = await parseResponse(response)

    expect(status).toBe(401)
  })

  it("returns 404 when cliente is unknown or belongs to another org", async () => {
    mockAuthWithSucursal({ role: "ADMIN" })
    mockCookie(null)
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "clientes") return createChainMock(null, { message: "not found" }) as any
      return createChainMock(null) as any
    })

    const response = await callRoute("cliente-ajeno")
    const { status, body } = await parseResponse(response)

    expect(status).toBe(404)
    expect(body.error).toBeTruthy()
    expect(vi.mocked(supabaseAdmin.rpc)).not.toHaveBeenCalled()
  })

  it("TECNICO with sucursalId 'suc-A' → RPC called with p_sucursal_id: 'suc-A'", async () => {
    mockAuthWithSucursal({ role: "TECNICO", sucursalId: "suc-A" })
    mockCookie(null)
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "clientes") return createChainMock({ id: "cliente-1" }) as any
      return createChainMock(null) as any
    })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: [{ deuda_fiado: 100, deuda_ordenes: 50, deuda_total: 150 }],
      error: null,
    } as any)

    const response = await callRoute()
    const { status } = await parseResponse(response)

    expect(status).toBe(200)
    const rpcArgs = vi.mocked(supabaseAdmin.rpc).mock.calls[0]
    expect(rpcArgs[0]).toBe("get_deuda_cliente_sucursal")
    expect(rpcArgs[1]).toMatchObject({
      p_org_id: "org-1",
      p_cliente_id: "cliente-1",
      p_sucursal_id: "suc-A",
    })
  })

  it("ADMIN verTodas (no cookie) → RPC called with p_sucursal_id: null", async () => {
    mockAuthWithSucursal({ role: "ADMIN", sucursalId: null })
    mockCookie(null)
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "clientes") return createChainMock({ id: "cliente-1" }) as any
      return createChainMock(null) as any
    })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: [{ deuda_fiado: 0, deuda_ordenes: 0, deuda_total: 0 }],
      error: null,
    } as any)

    const response = await callRoute()
    const { status } = await parseResponse(response)

    expect(status).toBe(200)
    const rpcArgs = vi.mocked(supabaseAdmin.rpc).mock.calls[0]
    expect(rpcArgs[1]).toMatchObject({ p_sucursal_id: null })
  })

  it("returns { deudaTotal, deudaFiado, deudaOrdenes } built from the RPC row", async () => {
    mockAuthWithSucursal({ role: "ADMIN" })
    mockCookie(null)
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "clientes") return createChainMock({ id: "cliente-1" }) as any
      return createChainMock(null) as any
    })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: [{ deuda_fiado: "120.50", deuda_ordenes: "30.00", deuda_total: "150.50" }],
      error: null,
    } as any)

    const response = await callRoute()
    const { status, body } = await parseResponse(response)

    expect(status).toBe(200)
    expect(body).toEqual({ deudaTotal: 150.5, deudaFiado: 120.5, deudaOrdenes: 30 })
  })

  it("returns 500 when the RPC call fails", async () => {
    mockAuthWithSucursal({ role: "ADMIN" })
    mockCookie(null)
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "clientes") return createChainMock({ id: "cliente-1" }) as any
      return createChainMock(null) as any
    })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null,
      error: { message: "function does not exist" },
    } as any)

    const response = await callRoute()
    const { status } = await parseResponse(response)

    expect(status).toBe(500)
  })
})
