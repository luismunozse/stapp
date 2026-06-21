import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
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

describe("POST /api/cotizaciones/[id]/convertir-venta — atomic wrapper RPC", () => {
  beforeEach(() => vi.clearAllMocks())

  it("calls convertir_cotizacion_venta_atomica (NOT crear_venta_atomica + liberar separately)", async () => {
    mockAuthSuccess()
    vi.mocked(sucursalParaEscritura).mockResolvedValue("suc-A")

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "cotizaciones") return createChainMock(mockCotizacion) as any
      if (table === "ventas") return createChainMock({ numero_venta: 1 }) as any
      return createChainMock(null) as any
    })

    const calledRpcs: string[] = []
    let capturedParams: any = null

    vi.mocked(supabaseAdmin.rpc).mockImplementation((fn: string, params?: any) => {
      calledRpcs.push(fn)
      if (fn === "convertir_cotizacion_venta_atomica") {
        capturedParams = params
        return Promise.resolve({ data: { ventaId: "venta-1", numeroVenta: 1, garantias: [], items: [] }, error: null }) as any
      }
      return Promise.resolve({ data: null, error: null }) as any
    })

    const response = await POST(createPostRequest(validBody), createParams("cot-1"))
    const { status } = await parseResponse(response)

    expect(status).toBe(201)
    // MUST call the atomic wrapper, NOT the two separate RPCs
    expect(calledRpcs).toContain("convertir_cotizacion_venta_atomica")
    expect(calledRpcs).not.toContain("crear_venta_atomica")
    expect(calledRpcs).not.toContain("liberar_items_cotizacion")
  })

  it("passes p_cotizacion_id to the atomic wrapper", async () => {
    mockAuthSuccess()
    vi.mocked(sucursalParaEscritura).mockResolvedValue("suc-A")

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "cotizaciones") return createChainMock(mockCotizacion) as any
      if (table === "ventas") return createChainMock({ numero_venta: 1 }) as any
      return createChainMock(null) as any
    })

    let capturedParams: any = null
    vi.mocked(supabaseAdmin.rpc).mockImplementation((fn: string, params?: any) => {
      if (fn === "convertir_cotizacion_venta_atomica") {
        capturedParams = params
        return Promise.resolve({ data: { ventaId: "venta-1", numeroVenta: 1, garantias: [], items: [] }, error: null }) as any
      }
      return Promise.resolve({ data: null, error: null }) as any
    })

    await POST(createPostRequest(validBody), createParams("cot-42"))

    expect(capturedParams).not.toBeNull()
    expect(capturedParams.p_cotizacion_id).toBe("cot-42")
  })

  it("still passes p_sucursal_id from the orden (sucursal inheritance)", async () => {
    mockAuthSuccess()
    vi.mocked(sucursalParaEscritura).mockResolvedValue("suc-B")

    const cotizacionConOrden = {
      ...mockCotizacion,
      ordenes_servicio: { sucursal_id: "suc-A", clientes: { id: "c1", nombre: "Juan" } },
    }

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "cotizaciones") return createChainMock(cotizacionConOrden) as any
      if (table === "ventas") return createChainMock({ numero_venta: 1 }) as any
      return createChainMock(null) as any
    })

    let capturedParams: any = null
    vi.mocked(supabaseAdmin.rpc).mockImplementation((fn: string, params?: any) => {
      if (fn === "convertir_cotizacion_venta_atomica") {
        capturedParams = params
        return Promise.resolve({ data: { ventaId: "venta-1", numeroVenta: 1, garantias: [], items: [] }, error: null }) as any
      }
      return Promise.resolve({ data: null, error: null }) as any
    })

    const response = await POST(createPostRequest(validBody), createParams("cot-1"))
    const { status } = await parseResponse(response)

    expect(status).toBe(201)
    expect(capturedParams.p_sucursal_id).toBe("suc-A")
  })

  it("falls back to crear_venta_atomica + liberar when function-missing error", async () => {
    mockAuthSuccess()
    vi.mocked(sucursalParaEscritura).mockResolvedValue("suc-A")

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "cotizaciones") return createChainMock(mockCotizacion) as any
      if (table === "ventas") return createChainMock({ numero_venta: 1 }) as any
      return createChainMock(null) as any
    })

    const calledRpcs: string[] = []
    vi.mocked(supabaseAdmin.rpc).mockImplementation((fn: string) => {
      calledRpcs.push(fn)
      if (fn === "convertir_cotizacion_venta_atomica") {
        return Promise.resolve({
          data: null,
          error: { code: "PGRST202", message: "Could not find the function" },
        }) as any
      }
      if (fn === "crear_venta_atomica") {
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
    expect(calledRpcs).toContain("convertir_cotizacion_venta_atomica")
    expect(calledRpcs).toContain("crear_venta_atomica")
    expect(calledRpcs).toContain("liberar_items_cotizacion")
  })

  it("returns 201 with ventaId on success", async () => {
    mockAuthSuccess()
    vi.mocked(sucursalParaEscritura).mockResolvedValue("suc-A")

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "cotizaciones") return createChainMock(mockCotizacion) as any
      if (table === "ventas") return createChainMock({ numero_venta: 7 }) as any
      return createChainMock(null) as any
    })

    vi.mocked(supabaseAdmin.rpc).mockImplementation((fn: string) => {
      if (fn === "convertir_cotizacion_venta_atomica") {
        return Promise.resolve({
          data: { ventaId: "venta-99", numeroVenta: 7, garantias: [], items: [] },
          error: null,
        }) as any
      }
      return Promise.resolve({ data: null, error: null }) as any
    })

    const response = await POST(createPostRequest(validBody), createParams("cot-1"))
    const { status, body } = await parseResponse(response)

    expect(status).toBe(201)
    expect(body.ventaId).toBe("venta-99")
  })
})
