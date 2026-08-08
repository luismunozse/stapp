/**
 * Tests: GET/PUT/DELETE /api/facturacion/[id] resolve venta-sourced invoices
 * (previously 404'd / crashed because of the ordenes_servicio!inner join).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, createGetRequest, createPostRequest, parseResponse } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

import { GET as facturaGet, PUT as facturaPut, DELETE as facturaDelete } from "@/app/api/facturacion/[id]/route"

const params = Promise.resolve({ id: "f-venta-1" })

function ventaFacturaRow(over: Partial<any> = {}) {
  return {
    id: "f-venta-1",
    orden_id: null,
    venta_id: "v1",
    numero_factura: "0001-00000002",
    fecha: "2026-01-02T00:00:00Z",
    subtotal: 200,
    iva: 0,
    total: 200,
    monto_abonado: 200,
    estado_pago: "PAGADO",
    ventas: {
      id: "v1",
      numero_venta: 5,
      cliente_nombre: "Consumidor Final",
      cliente_id: null,
      organization_id: "org-1",
      sucursal_id: "suc-1",
    },
    pagos_parciales: [],
    ...over,
  }
}

describe("GET /api/facturacion/[id] — venta origin", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns the venta-sourced invoice with origen='venta' (base lookup + branch fetch)", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "facturas") {
        const callIndex = vi.mocked(supabaseAdmin.from).mock.calls.length
        // 1st call: base lookup (id, orden_id, venta_id). 2nd call: branch fetch.
        if (callIndex === 1) return createChainMock({ id: "f-venta-1", orden_id: null, venta_id: "v1" }) as any
        return createChainMock(ventaFacturaRow()) as any
      }
      return createChainMock(null, { message: `No mock for table: ${table}` }) as any
    })

    const res = await facturaGet(createGetRequest("http://localhost:3000/api/facturacion/f-venta-1"), { params })
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.origen).toBe("venta")
    expect(body.venta.numeroVenta).toBe(5)
    expect(body.ventaId).toBe("v1")
  })

  it("404 when the base lookup finds nothing", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "facturas") return createChainMock(null, { message: "not found" }) as any
      return createChainMock(null, { message: `No mock for table: ${table}` }) as any
    })

    const res = await facturaGet(createGetRequest("http://localhost:3000/api/facturacion/f-venta-1"), { params })
    const { status } = await parseResponse(res)
    expect(status).toBe(404)
  })
})

describe("DELETE /api/facturacion/[id] — venta origin", () => {
  beforeEach(() => vi.clearAllMocks())

  it("does not 404 on the pre-check for a venta-sourced invoice", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "facturas") {
        const callIndex = vi.mocked(supabaseAdmin.from).mock.calls.length
        if (callIndex === 1) return createChainMock({ id: "f-venta-1", orden_id: null, venta_id: "v1" }) as any
        return createChainMock(ventaFacturaRow()) as any
      }
      if (table === "audit_logs") return createChainMock({}) as any
      return createChainMock(null, { message: `No mock for table: ${table}` }) as any
    })
    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "eliminar_factura_atomica") return Promise.resolve({ data: { ok: true }, error: null })
      return Promise.resolve({ data: null, error: null })
    }) as any)

    const res = await facturaDelete(new Request("http://localhost:3000/api/facturacion/f-venta-1", { method: "DELETE" }), { params })
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.success).toBe(true)
  })
})
