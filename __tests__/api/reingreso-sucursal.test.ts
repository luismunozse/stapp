import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  parseResponse,
  createPostRequest,
} from "./helpers"

vi.mock("@/lib/sucursal", () => ({
  getPrincipalId: vi.fn(),
}))

vi.mock("@/lib/audit", () => ({
  createAuditLogger: vi.fn(() => ({
    create: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.mock("@/lib/counters", () => ({
  getNextOrderNumberByType: vi.fn().mockResolvedValue({ codigo: "CEL-002", numero: 2 }),
}))

import { getPrincipalId } from "@/lib/sucursal"
import { supabaseAdmin } from "@/lib/supabase"
import { POST } from "@/app/api/ordenes/[id]/reingreso/route"

function createParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

const validBody = { problemaReportado: "Problema recurrente" }

function makeOrigenChain(origen: any, nuevaOrden: any) {
  const chain = createChainMock(null)
  let callCount = 0
  chain.single = vi.fn().mockImplementation(() => {
    callCount++
    if (callCount === 1) return Promise.resolve({ data: origen, error: null })
    return Promise.resolve({ data: nuevaOrden, error: null })
  })
  return chain
}

describe("POST /api/ordenes/[id]/reingreso — sucursal_id", () => {
  beforeEach(() => vi.clearAllMocks())

  it("inherits sucursal_id from the source order", async () => {
    mockAuthSuccess()
    vi.mocked(getPrincipalId).mockResolvedValue("suc-principal")

    const mockOrdenOrigen = {
      id: "o1",
      numero_orden: 1,
      codigo_orden: "CEL-001",
      cliente_id: "c1",
      organization_id: "org-1",
      tipo_dispositivo: "CELULAR",
      dispositivo: "iPhone 13",
      problema_reportado: "Pantalla rota",
      estado: "ENTREGADO",
      marca: "Apple",
      color: "Negro",
      imei: null,
      accesorios: null,
      password_dispositivo: null,
      metadata: {},
      sector_id: null,
      sucursal_id: "suc-A",  // has a sucursal_id
      clientes: { id: "c1", nombre: "Juan" },
    }

    const mockNuevaOrden = {
      id: "o2",
      numero_orden: 2,
      codigo_orden: "CEL-002",
      sucursal_id: "suc-A",
      clientes: { id: "c1", nombre: "Juan" },
    }

    let insertedPayload: any = null

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ordenes_servicio") {
        const chain: any = {
          select: vi.fn().mockReturnThis(),
          insert: vi.fn().mockImplementation((payload: any) => {
            insertedPayload = payload
            return {
              select: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({ data: mockNuevaOrden, error: null }),
            }
          }),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: mockOrdenOrigen, error: null }),
        }
        return chain as any
      }
      if (table === "orden_eventos") {
        const chain = createChainMock(null)
        chain.then = (resolve: any) => resolve({ data: null, error: null })
        return chain as any
      }
      return createChainMock(null) as any
    })

    const response = await POST(createPostRequest(validBody), createParams("o1"))
    const { status } = await parseResponse(response)

    expect(status).toBe(201)
    expect(insertedPayload).not.toBeNull()
    expect(insertedPayload.sucursal_id).toBe("suc-A")
    // getPrincipalId should NOT be called when source has sucursal_id
    expect(getPrincipalId).not.toHaveBeenCalled()
  })

  it("falls back to principal when source order has null sucursal_id", async () => {
    mockAuthSuccess()
    vi.mocked(getPrincipalId).mockResolvedValue("suc-principal")

    const mockOrdenOrigen = {
      id: "o1",
      numero_orden: 1,
      codigo_orden: "CEL-001",
      cliente_id: "c1",
      organization_id: "org-1",
      tipo_dispositivo: "CELULAR",
      dispositivo: "iPhone 13",
      problema_reportado: "Pantalla rota",
      estado: "ENTREGADO",
      marca: null,
      color: null,
      imei: null,
      accesorios: null,
      password_dispositivo: null,
      metadata: {},
      sector_id: null,
      sucursal_id: null,  // null — legacy order
      clientes: { id: "c1", nombre: "Juan" },
    }

    const mockNuevaOrden = {
      id: "o2",
      numero_orden: 2,
      codigo_orden: "CEL-002",
      sucursal_id: "suc-principal",
      clientes: { id: "c1", nombre: "Juan" },
    }

    let insertedPayload: any = null

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ordenes_servicio") {
        const chain: any = {
          select: vi.fn().mockReturnThis(),
          insert: vi.fn().mockImplementation((payload: any) => {
            insertedPayload = payload
            return {
              select: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({ data: mockNuevaOrden, error: null }),
            }
          }),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: mockOrdenOrigen, error: null }),
        }
        return chain as any
      }
      if (table === "orden_eventos") {
        const chain = createChainMock(null)
        chain.then = (resolve: any) => resolve({ data: null, error: null })
        return chain as any
      }
      return createChainMock(null) as any
    })

    const response = await POST(createPostRequest(validBody), createParams("o1"))
    const { status } = await parseResponse(response)

    expect(status).toBe(201)
    expect(insertedPayload.sucursal_id).toBe("suc-principal")
    expect(getPrincipalId).toHaveBeenCalledTimes(1)
  })

  it("returns 500 when both source sucursal_id is null and getPrincipalId returns null", async () => {
    mockAuthSuccess()
    vi.mocked(getPrincipalId).mockResolvedValue(null)

    const mockOrdenOrigen = {
      id: "o1",
      numero_orden: 1,
      codigo_orden: "CEL-001",
      cliente_id: "c1",
      organization_id: "org-1",
      tipo_dispositivo: "CELULAR",
      dispositivo: "iPhone 13",
      problema_reportado: "Pantalla rota",
      estado: "ENTREGADO",
      marca: null,
      color: null,
      imei: null,
      accesorios: null,
      password_dispositivo: null,
      metadata: {},
      sector_id: null,
      sucursal_id: null,
      clientes: { id: "c1", nombre: "Juan" },
    }

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ordenes_servicio") {
        const chain: any = {
          select: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: mockOrdenOrigen, error: null }),
        }
        return chain as any
      }
      return createChainMock(null) as any
    })

    const response = await POST(createPostRequest(validBody), createParams("o1"))
    const { status } = await parseResponse(response)

    expect(status).toBe(500)
  })
})
