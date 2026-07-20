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
      if (fn === "convertir_cotizacion_venta_atomica") {
        capturedRpcParams = params
        return Promise.resolve({ data: { ventaId: "venta-1", numeroVenta: 1, garantias: [], items: [] }, error: null }) as any
      }
      return Promise.resolve({ data: null, error: null }) as any
    })

    const response = await POST(createPostRequest(validBody), createParams("cot-1"))
    const { status } = await parseResponse(response)

    expect(status).toBe(201)
    expect(capturedRpcParams).not.toBeNull()
    expect(capturedRpcParams.p_sucursal_id).toBe("suc-A")
  })

  it("hereda la sucursal de la orden vinculada (ignora la sucursal activa)", async () => {
    mockAuthSuccess()
    // Admin operando con la sucursal activa en suc-B...
    vi.mocked(sucursalParaEscritura).mockResolvedValue("suc-B")

    // ...pero la cotización está vinculada a una orden de suc-A.
    const cotizacionConOrden = {
      ...mockCotizacion,
      ordenes_servicio: { sucursal_id: "suc-A", clientes: { id: "c1", nombre: "Juan" } },
    }
    const cotizacionChain = createChainMock(cotizacionConOrden)
    const ventaChain = createChainMock({ numero_venta: 1 })
    let capturedRpcParams: any = null

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "cotizaciones") return cotizacionChain as any
      if (table === "ventas") return ventaChain as any
      return createChainMock(null) as any
    })

    vi.mocked(supabaseAdmin.rpc).mockImplementation((fn: string, params?: any) => {
      if (fn === "convertir_cotizacion_venta_atomica") {
        capturedRpcParams = params
        return Promise.resolve({ data: { ventaId: "venta-1", numeroVenta: 1, garantias: [], items: [] }, error: null }) as any
      }
      return Promise.resolve({ data: null, error: null }) as any
    })

    const response = await POST(createPostRequest(validBody), createParams("cot-1"))
    const { status } = await parseResponse(response)

    expect(status).toBe(201)
    // La venta debe quedar atribuida a la sucursal de la orden (suc-A), no a la activa (suc-B).
    expect(capturedRpcParams.p_sucursal_id).toBe("suc-A")
  })

  it("bug #3: con CUENTA_CORRIENTE arma p_pagos para que el RPC debite la cuenta", async () => {
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
      if (fn === "convertir_cotizacion_venta_atomica") {
        capturedRpcParams = params
        return Promise.resolve({ data: { ventaId: "venta-1", numeroVenta: 1 }, error: null }) as any
      }
      return Promise.resolve({ data: null, error: null }) as any
    })

    const response = await POST(
      createPostRequest(
        { metodoPago: "CUENTA_CORRIENTE", items: [{ cotizacionItemId: "item-1", diasGarantia: 0 }] },
        "http://localhost/api/cotizaciones/cot-1/convertir-venta"
      ),
      createParams("cot-1")
    )
    const { status } = await parseResponse(response)

    expect(status).toBe(201)
    // total del mock = 10000 (item 10000, sin descuento, iva 0)
    expect(capturedRpcParams.p_pagos).toEqual([{ metodo: "CUENTA_CORRIENTE", monto: 10000 }])
  })

  it("bug #3: rechaza con 400 conversión en CUENTA_CORRIENTE sin cliente registrado", async () => {
    mockAuthSuccess()
    vi.mocked(sucursalParaEscritura).mockResolvedValue("suc-A")

    // Cotización sin cliente (ni directo ni por orden) → clienteId null.
    const cotizacionSinCliente = { ...mockCotizacion, clientes: null, ordenes_servicio: null }
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "cotizaciones") return createChainMock(cotizacionSinCliente) as any
      return createChainMock(null) as any
    })

    const response = await POST(
      createPostRequest(
        { metodoPago: "CUENTA_CORRIENTE", items: [{ cotizacionItemId: "item-1", diasGarantia: 0 }] },
        "http://localhost/api/cotizaciones/cot-1/convertir-venta"
      ),
      createParams("cot-1")
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(400)
    expect(body.error).toMatch(/cuenta corriente/i)
    // No debe crear la venta.
    const rpcCalls = vi.mocked(supabaseAdmin.rpc).mock.calls.map((c) => c[0])
    expect(rpcCalls).not.toContain("convertir_cotizacion_venta_atomica")
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
