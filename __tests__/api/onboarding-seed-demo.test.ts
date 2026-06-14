import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  mockAuthError,
  createChainMock,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/sucursal", () => ({
  getPrincipalId: vi.fn(),
}))

import { getPrincipalId } from "@/lib/sucursal"
import { supabaseAdmin } from "@/lib/supabase"
import { POST } from "@/app/api/onboarding/seed-demo-data/route"

const mockClientes = [{ id: "c1" }, { id: "c2" }, { id: "c3" }]
const mockInventario = [{ id: "inv-1" }, { id: "inv-2" }]
const mockOrdenes = [{ id: "ord-1" }, { id: "ord-2" }]

describe("POST /api/onboarding/seed-demo-data — sucursal_id", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 401 when not authenticated", async () => {
    mockAuthError()
    const response = await POST()
    const { status } = await parseResponse(response)
    expect(status).toBe(401)
  })

  it("returns 400 when getPrincipalId returns null", async () => {
    mockAuthSuccess()
    vi.mocked(getPrincipalId).mockResolvedValue(null)

    // Guard: org is empty
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "clientes") return createChainMock(null, null, 0) as any
      if (table === "ordenes_servicio") return createChainMock(null, null, 0) as any
      return createChainMock(null) as any
    })

    const response = await POST()
    const { status, body } = await parseResponse(response)

    expect(status).toBe(400)
    expect(body.error).toMatch(/sucursal principal/i)
  })

  it("calls getPrincipalId exactly once", async () => {
    mockAuthSuccess()
    vi.mocked(getPrincipalId).mockResolvedValue("suc-principal")

    const insertedOrdenes: any[] = []

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "clientes") {
        const chain = createChainMock(null, null, 0)
        chain.insert = vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          then: (resolve: any) => resolve({ data: mockClientes, error: null }),
        })
        return chain as any
      }
      if (table === "inventario") {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnThis(),
            then: (resolve: any) => resolve({ data: mockInventario, error: null }),
          }),
        } as any
      }
      if (table === "ordenes_servicio") {
        const chain = createChainMock(null, null, 0)
        chain.insert = vi.fn().mockImplementation((payload: any) => {
          insertedOrdenes.push(...(Array.isArray(payload) ? payload : [payload]))
          return {
            select: vi.fn().mockReturnThis(),
            then: (resolve: any) => resolve({ data: mockOrdenes, error: null }),
          }
        })
        return chain as any
      }
      if (table === "organizations") {
        return {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          then: (resolve: any) => resolve({ data: null, error: null }),
        } as any
      }
      return createChainMock(null) as any
    })

    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: 1, error: null } as any)

    const response = await POST()
    const { status } = await parseResponse(response)

    expect(status).toBe(200)
    expect(getPrincipalId).toHaveBeenCalledTimes(1)
  })

  it("stamps sucursal_id on all demo ordenes_servicio INSERTs", async () => {
    mockAuthSuccess()
    vi.mocked(getPrincipalId).mockResolvedValue("suc-principal")

    const insertedOrdenes: any[] = []

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "clientes") {
        const chain = createChainMock(null, null, 0)
        chain.insert = vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          then: (resolve: any) => resolve({ data: mockClientes, error: null }),
        })
        return chain as any
      }
      if (table === "inventario") {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnThis(),
            then: (resolve: any) => resolve({ data: mockInventario, error: null }),
          }),
        } as any
      }
      if (table === "ordenes_servicio") {
        const chain = createChainMock(null, null, 0)
        chain.insert = vi.fn().mockImplementation((payload: any) => {
          const items = Array.isArray(payload) ? payload : [payload]
          insertedOrdenes.push(...items)
          return {
            select: vi.fn().mockReturnThis(),
            then: (resolve: any) => resolve({ data: mockOrdenes, error: null }),
          }
        })
        return chain as any
      }
      if (table === "organizations") {
        return {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          then: (resolve: any) => resolve({ data: null, error: null }),
        } as any
      }
      return createChainMock(null) as any
    })

    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: 1, error: null } as any)

    const response = await POST()
    const { status } = await parseResponse(response)

    expect(status).toBe(200)
    expect(insertedOrdenes.length).toBeGreaterThan(0)
    for (const orden of insertedOrdenes) {
      expect(orden.sucursal_id).toBe("suc-principal")
    }
  })
})
