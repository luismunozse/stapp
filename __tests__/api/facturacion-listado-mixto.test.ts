/**
 * Tests: GET /api/facturacion returns both orden- and venta-sourced invoices
 * with an `origen` discriminator, merged and sorted by fecha desc.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createGetRequest, parseResponse } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

import { GET as facturacionGet } from "@/app/api/facturacion/route"

function chainableThenable(result: { data: any; error: any }) {
  const chain: any = {}
  const methods = ["select", "eq", "order"]
  for (const m of methods) chain[m] = vi.fn().mockReturnValue(chain)
  chain.then = (resolve: any) => Promise.resolve(result).then(resolve)
  return chain
}

describe("GET /api/facturacion — mixed origen listing", () => {
  beforeEach(() => vi.clearAllMocks())

  it("merges orden and venta invoices, each tagged with origen, sorted by fecha desc", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    const facturaOrden = {
      id: "f-orden-1",
      orden_id: "o1",
      numero_factura: "0001-00000001",
      fecha: "2026-01-01T00:00:00Z",
      subtotal: 100,
      iva: 0,
      total: 100,
      monto_abonado: 100,
      estado_pago: "PAGADO",
      created_at: "2026-01-01T00:00:00Z",
      ordenes_servicio: {
        id: "o1",
        numero_orden: 1,
        codigo_orden: "CEL001",
        dispositivo: "iPhone",
        organization_id: "org-1",
        clientes: { id: "c1", nombre: "Ana" },
      },
      pagos_parciales: [],
    }

    const facturaVenta = {
      id: "f-venta-1",
      venta_id: "v1",
      numero_factura: "0001-00000002",
      fecha: "2026-01-02T00:00:00Z",
      subtotal: 200,
      iva: 0,
      total: 200,
      monto_abonado: 200,
      estado_pago: "PAGADO",
      created_at: "2026-01-02T00:00:00Z",
      ventas: {
        id: "v1",
        numero_venta: 5,
        cliente_nombre: "Consumidor Final",
        cliente_id: null,
        organization_id: "org-1",
      },
      pagos_parciales: [],
    }

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table !== "facturas") {
        return chainableThenable({ data: null, error: { message: `No mock for table: ${table}` } })
      }
      // Both queries hit the same table name; disambiguate by call order:
      // 1st call = ordenes query, 2nd call = ventas query.
      const callIndex = vi.mocked(supabaseAdmin.from).mock.calls.length
      if (callIndex === 1) return chainableThenable({ data: [facturaOrden], error: null })
      return chainableThenable({ data: [facturaVenta], error: null })
    })

    const res = await facturacionGet(createGetRequest("http://localhost:3000/api/facturacion"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body).toHaveLength(2)
    // Sorted by fecha desc: venta (01-02) before orden (01-01)
    expect(body[0].origen).toBe("venta")
    expect(body[0].venta.numeroVenta).toBe(5)
    expect(body[1].origen).toBe("orden")
    expect(body[1].orden.codigoOrden).toBe("CEL001")
  })
})
