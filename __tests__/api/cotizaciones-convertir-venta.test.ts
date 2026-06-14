import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  mockAuthError,
  createChainMock,
  mockSupabaseFrom,
  createPostRequest,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/sucursal", () => ({
  sucursalParaEscritura: vi.fn(),
}))

import { sucursalParaEscritura } from "@/lib/sucursal"
import { supabaseAdmin } from "@/lib/supabase"
import { POST } from "@/app/api/cotizaciones/[id]/convertir-venta/route"

function createParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

const validBody = {
  metodoPago: "EFECTIVO",
  items: [{ cotizacionItemId: "item-1", diasGarantia: 0 }],
}

const mockCotizacion = {
  id: "cot-1",
  numero_cotizacion: "COT-001",
  estado: "ACEPTADA",
  tipo: "ORDEN",
  clientes: { id: "c1", nombre: "Juan", telefono: "123" },
  ordenes_servicio: null,
  items_cotizacion: [
    {
      id: "item-1",
      descripcion: "Servicio",
      cantidad: 1,
      precio_unitario: 10000,
      descuento_valor: 0,
      descuento_tipo: "monto",
      inventario_id: null,
      costo_unitario: null,
    },
  ],
  descuento_global_tipo: null,
  descuento_global_valor: 0,
  iva: 0,
}

describe("POST /api/cotizaciones/[id]/convertir-venta", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 401 when not authenticated", async () => {
    mockAuthError()
    const response = await POST(createPostRequest(validBody), createParams("cot-1"))
    const { status } = await parseResponse(response)
    expect(status).toBe(401)
  })

  it("returns 403 when role is not ADMIN", async () => {
    mockAuthSuccess({ role: "TECNICO" })
    const response = await POST(createPostRequest(validBody), createParams("cot-1"))
    const { status } = await parseResponse(response)
    expect(status).toBe(403)
  })

  it("returns 500 when sucursalParaEscritura returns null", async () => {
    mockAuthSuccess()
    vi.mocked(sucursalParaEscritura).mockResolvedValue(null)

    const response = await POST(createPostRequest(validBody), createParams("cot-1"))
    const { status } = await parseResponse(response)
    expect(status).toBe(500)
  })

  it("includes p_sucursal_id in rpcParams when sucursalParaEscritura returns a value", async () => {
    mockAuthSuccess()
    vi.mocked(sucursalParaEscritura).mockResolvedValue("suc-A")

    const cotizacionChain = createChainMock(mockCotizacion)
    const ventaChain = createChainMock({ numero_venta: 1 })
    let capturedRpcParams: any = null

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "cotizaciones") return cotizacionChain as any
      if (table === "ventas") return ventaChain as any
      return createChainMock(null) as any
    })

    vi.mocked(supabaseAdmin.rpc).mockImplementation((fn: string, params?: any) => {
      if (fn === "crear_venta_atomica") {
        capturedRpcParams = params
        return Promise.resolve({ data: "venta-1", error: null }) as any
      }
      if (fn === "liberar_items_cotizacion") {
        return Promise.resolve({ data: null, error: null }) as any
      }
      return Promise.resolve({ data: null, error: null }) as any
    })

    const response = await POST(createPostRequest(validBody), createParams("cot-1"))
    const { status } = await parseResponse(response)

    expect(status).toBe(201)
    expect(capturedRpcParams).not.toBeNull()
    expect(capturedRpcParams.p_sucursal_id).toBe("suc-A")
  })

  it("calls sucursalParaEscritura with correct args", async () => {
    mockAuthSuccess({ organizationId: "org-99", role: "ADMIN" })
    vi.mocked(sucursalParaEscritura).mockResolvedValue("suc-X")

    vi.mocked(supabaseAdmin.from).mockImplementation(() => createChainMock(null, { message: "not found" }) as any)

    await POST(createPostRequest(validBody), createParams("cot-1"))

    expect(sucursalParaEscritura).toHaveBeenCalledWith({
      role: "ADMIN",
      organizationId: "org-99",
      userSucursalId: null,
    })
  })
})
