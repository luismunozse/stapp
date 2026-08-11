/**
 * Tests: GET /api/facturacion returns both orden- and venta-sourced invoices
 * with an `origen` discriminator, merged and sorted by fecha desc.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { cookies } from "next/headers"
import { mockAuthSuccess, createGetRequest, parseResponse } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"
import { SUCURSAL_COOKIE } from "@/lib/sucursal"

import { GET as facturacionGet } from "@/app/api/facturacion/route"

function chainableThenable(result: { data: any; error: any }) {
  const chain: any = {}
  const methods = ["select", "eq", "order"]
  for (const m of methods) chain[m] = vi.fn().mockReturnValue(chain)
  chain.then = (resolve: any) => Promise.resolve(result).then(resolve)
  return chain
}

// ADMIN's branch filter is resolved from the "active sucursal" cookie
// (see lib/sucursal.ts sucursalParaLectura). Controlling it here lets us
// assert the filter actually reaches both the orden and the venta query.
function mockCookie(value: string | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn((name: string) => (name === SUCURSAL_COOKIE && value ? { value } : undefined)),
    set: vi.fn(),
  } as any)
}

// Installs the facturas mock and returns both underlying chains so tests
// can assert on their individual `.eq(...)` call history — this is what
// catches a filter silently failing to reach one of the two queries.
function mockFacturasQueries(
  ordenResult: { data: any; error: any },
  ventaResult: { data: any; error: any }
) {
  const ordenesChain = chainableThenable(ordenResult)
  const ventasChain = chainableThenable(ventaResult)
  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    if (table !== "facturas") {
      return chainableThenable({ data: null, error: { message: `No mock for table: ${table}` } })
    }
    const callIndex = vi.mocked(supabaseAdmin.from).mock.calls.length
    return callIndex === 1 ? ordenesChain : ventasChain
  })
  return { ordenesChain, ventasChain }
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

describe("GET /api/facturacion — sucursal filter reaches both queries", () => {
  beforeEach(() => vi.clearAllMocks())

  it("applies the sucursal filter to both the orden query and the venta query when a branch is scoped", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-B")

    const { ordenesChain, ventasChain } = mockFacturasQueries(
      { data: [], error: null },
      { data: [], error: null }
    )

    const res = await facturacionGet(createGetRequest("http://localhost:3000/api/facturacion"))

    expect(res.status).toBe(200)
    expect(ordenesChain.eq.mock.calls).toContainEqual(["ordenes_servicio.sucursal_id", "suc-B"])
    expect(ventasChain.eq.mock.calls).toContainEqual(["ventas.sucursal_id", "suc-B"])
  })

  it("does not apply a sucursal filter to either query when the ADMIN is viewing all branches", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie(null) // no cookie => verTodas

    const { ordenesChain, ventasChain } = mockFacturasQueries(
      { data: [], error: null },
      { data: [], error: null }
    )

    const res = await facturacionGet(createGetRequest("http://localhost:3000/api/facturacion"))

    expect(res.status).toBe(200)
    expect(ordenesChain.eq.mock.calls.find((c: any[]) => c[0] === "ordenes_servicio.sucursal_id")).toBeUndefined()
    expect(ventasChain.eq.mock.calls.find((c: any[]) => c[0] === "ventas.sucursal_id")).toBeUndefined()
  })
})

describe("GET /api/facturacion — estadoPago filter reaches both queries", () => {
  beforeEach(() => vi.clearAllMocks())

  it("applies the estadoPago filter to both the orden query and the venta query when provided", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie(null)

    const { ordenesChain, ventasChain } = mockFacturasQueries(
      { data: [], error: null },
      { data: [], error: null }
    )

    const res = await facturacionGet(
      createGetRequest("http://localhost:3000/api/facturacion?estadoPago=PAGADO")
    )

    expect(res.status).toBe(200)
    expect(ordenesChain.eq.mock.calls).toContainEqual(["estado_pago", "PAGADO"])
    expect(ventasChain.eq.mock.calls).toContainEqual(["estado_pago", "PAGADO"])
  })
})

describe("GET /api/facturacion — error propagation", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 500 when the orden query errors", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie(null)

    mockFacturasQueries(
      { data: null, error: { message: "orden query boom" } },
      { data: [], error: null }
    )

    const res = await facturacionGet(createGetRequest("http://localhost:3000/api/facturacion"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(500)
    expect(body.error).toBe("Error al obtener remitos")
  })

  it("returns 500 when the venta query errors", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie(null)

    mockFacturasQueries(
      { data: [], error: null },
      { data: null, error: { message: "venta query boom" } }
    )

    const res = await facturacionGet(createGetRequest("http://localhost:3000/api/facturacion"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(500)
    expect(body.error).toBe("Error al obtener remitos")
  })
})
