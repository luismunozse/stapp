import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  mockAuthError,
  createChainMock,
  mockSupabaseFrom,
  createPostRequest,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/counters", () => ({
  getNextInvoiceNumber: vi.fn().mockResolvedValue(1),
}))

import { POST } from "@/app/api/facturacion/generar/route"

describe("POST /api/facturacion/generar", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 401 when not authenticated", async () => {
    mockAuthError()

    const response = await POST(createPostRequest({ ordenId: "o1" }))
    const { status, body } = await parseResponse(response)

    expect(status).toBe(401)
  })

  it("returns 403 for non-ADMIN roles", async () => {
    mockAuthSuccess({ role: "TECNICO" })

    const response = await POST(createPostRequest({ ordenId: "o1" }))
    const { status, body } = await parseResponse(response)

    expect(status).toBe(403)
    expect(body.error).toContain("Solo administradores")
  })

  it("returns 400 when ordenId is missing", async () => {
    mockAuthSuccess()

    const response = await POST(createPostRequest({}))
    const { status } = await parseResponse(response)

    expect(status).toBe(400)
  })

  it("returns 404 when order not found", async () => {
    mockAuthSuccess()

    const chain = createChainMock(null, { message: "not found" })
    mockSupabaseFrom({ ordenes_servicio: chain })

    const response = await POST(createPostRequest({ ordenId: "nonexistent" }))
    const { status, body } = await parseResponse(response)

    expect(status).toBe(404)
    expect(body.error).toContain("Orden no encontrada")
  })

  it("returns 400 when order is not REPARADO or ENTREGADO", async () => {
    mockAuthSuccess()

    const mockOrden = {
      id: "o1",
      estado: "EN_REPARACION",
      costo_final: 5000,
      presupuesto: 5000,
      sena: 0,
      organization_id: "org-1",
      numero_orden: 1,
      dispositivo: "iPhone",
      clientes: { nombre: "Test" },
      repuestos_orden: [],
      facturas: [],
    }

    const chain = createChainMock(mockOrden)
    mockSupabaseFrom({ ordenes_servicio: chain })

    const response = await POST(createPostRequest({ ordenId: "o1" }))
    const { status, body } = await parseResponse(response)

    expect(status).toBe(400)
    expect(body.error).toContain("reparada")
  })

  it("returns 400 when factura already exists", async () => {
    mockAuthSuccess()

    const mockOrden = {
      id: "o1",
      estado: "REPARADO",
      costo_final: 5000,
      presupuesto: 5000,
      sena: 0,
      organization_id: "org-1",
      numero_orden: 1,
      dispositivo: "iPhone",
      clientes: { nombre: "Test" },
      repuestos_orden: [],
      facturas: [{ id: "f1" }],
    }

    const chain = createChainMock(mockOrden)
    mockSupabaseFrom({ ordenes_servicio: chain })

    const response = await POST(createPostRequest({ ordenId: "o1" }))
    const { status, body } = await parseResponse(response)

    expect(status).toBe(400)
    expect(body.error).toContain("Ya existe una factura")
  })

  it("creates factura successfully with seña consideration", async () => {
    mockAuthSuccess()

    const mockOrden = {
      id: "o1",
      estado: "REPARADO",
      costo_final: 10000,
      presupuesto: 10000,
      sena: 3000,
      organization_id: "org-1",
      numero_orden: 1,
      dispositivo: "iPhone 14",
      clientes: { nombre: "Juan" },
      repuestos_orden: [],
      facturas: [],
    }

    const mockFactura = {
      id: "f-new",
      orden_id: "o1",
      numero_factura: 1,
      fecha: "2024-01-01",
      subtotal: 10000,
      iva: 0,
      total: 10000,
      estado_pago: "PAGADO_PARCIAL",
      monto_abonado: 3000,
    }

    const ordenesChain = createChainMock(mockOrden)
    const facturasChain = createChainMock(mockFactura)
    const pagosChain = createChainMock(null)
    pagosChain.then = (resolve: any) => resolve({ data: null, error: null })

    mockSupabaseFrom({
      ordenes_servicio: ordenesChain,
      facturas: facturasChain,
      pagos_parciales: pagosChain,
    })

    const response = await POST(createPostRequest({ ordenId: "o1" }))
    const { status, body } = await parseResponse(response)

    expect(status).toBe(201)
    expect(body.numeroFactura).toBe(1)
    expect(body.orden.dispositivo).toBe("iPhone 14")
  })

  it("creates factura with PAGADO status when seña covers total", async () => {
    mockAuthSuccess()

    const mockOrden = {
      id: "o1",
      estado: "ENTREGADO",
      costo_final: 5000,
      presupuesto: 5000,
      sena: 5000,
      organization_id: "org-1",
      numero_orden: 1,
      dispositivo: "Samsung A54",
      clientes: { nombre: "Maria" },
      repuestos_orden: [],
      facturas: [],
    }

    const mockFactura = {
      id: "f-new",
      orden_id: "o1",
      numero_factura: 2,
      fecha: "2024-01-01",
      subtotal: 5000,
      iva: 0,
      total: 5000,
      estado_pago: "PAGADO",
      monto_abonado: 5000,
    }

    const ordenesChain = createChainMock(mockOrden)
    const facturasChain = createChainMock(mockFactura)
    const pagosChain = createChainMock(null)
    pagosChain.then = (resolve: any) => resolve({ data: null, error: null })

    mockSupabaseFrom({
      ordenes_servicio: ordenesChain,
      facturas: facturasChain,
      pagos_parciales: pagosChain,
    })

    const response = await POST(createPostRequest({ ordenId: "o1" }))
    const { status } = await parseResponse(response)

    expect(status).toBe(201)
  })

  it("calculates subtotal from repuestos when costo_final is 0", async () => {
    mockAuthSuccess()

    const mockOrden = {
      id: "o1",
      estado: "REPARADO",
      costo_final: 0,
      presupuesto: 0,
      sena: 0,
      organization_id: "org-1",
      numero_orden: 1,
      dispositivo: "Laptop",
      clientes: { nombre: "Carlos" },
      repuestos_orden: [
        { cantidad: 2, precio_unitario: 1000 },
        { cantidad: 1, precio_unitario: 3000 },
      ],
      facturas: [],
    }

    const mockFactura = {
      id: "f-new",
      orden_id: "o1",
      numero_factura: 3,
      fecha: "2024-01-01",
      subtotal: 5000,
      iva: 0,
      total: 5000,
      estado_pago: "PENDIENTE",
      monto_abonado: 0,
    }

    const ordenesChain = createChainMock(mockOrden)
    const facturasChain = createChainMock(mockFactura)

    mockSupabaseFrom({
      ordenes_servicio: ordenesChain,
      facturas: facturasChain,
    })

    const response = await POST(createPostRequest({ ordenId: "o1" }))
    const { status, body } = await parseResponse(response)

    expect(status).toBe(201)
    expect(body.subtotal).toBe(5000)
  })
})
