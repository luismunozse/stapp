import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  mockAuthError,
  createChainMock,
  mockSupabaseFrom,
  parseResponse,
} from "./helpers"

import { GET as GET_GLOBAL } from "@/app/api/proveedores/stats/route"
import { GET as GET_BY_ID } from "@/app/api/proveedores/[id]/stats/route"

function chainArray(rows: any[]) {
  const c: any = createChainMock(rows)
  c.then = (resolve: any) => resolve({ data: rows, error: null })
  return c
}

// ─── Stats global ───────────────────────────────────
describe("GET /api/proveedores/stats", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 401 when not authenticated", async () => {
    mockAuthError()
    const res = await GET_GLOBAL()
    const { status } = await parseResponse(res)
    expect(status).toBe(401)
  })

  it("aggregates productos count, ordenes count, totalComprado, ultimaCompra", async () => {
    mockAuthSuccess()

    const inventarioRows = [
      { proveedor_id: "p1" },
      { proveedor_id: "p1" },
      { proveedor_id: "p2" },
    ]
    const ocRows = [
      { proveedor_id: "p1", estado: "RECIBIDA", total: "1000", fecha_emision: "2026-04-01" },
      { proveedor_id: "p1", estado: "RECIBIDA_PARCIAL", total: "500", fecha_emision: "2026-05-10" },
      { proveedor_id: "p1", estado: "BORRADOR", total: "9999", fecha_emision: "2026-03-01" },
      { proveedor_id: "p2", estado: "RECIBIDA", total: "200", fecha_emision: "2026-01-01" },
    ]

    mockSupabaseFrom({
      inventario: chainArray(inventarioRows),
      ordenes_compra: chainArray(ocRows),
    })

    const res = await GET_GLOBAL()
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    // p1: 2 items, 3 OCs, totalComprado = 1000 + 500 (excluye BORRADOR), ultimaCompra = más reciente
    expect(body.p1.productosCount).toBe(2)
    expect(body.p1.ordenesCount).toBe(3)
    expect(body.p1.totalComprado).toBe(1500)
    expect(body.p1.ultimaCompra).toBe("2026-05-10")

    // p2: 1 item, 1 OC, totalComprado = 200
    expect(body.p2.productosCount).toBe(1)
    expect(body.p2.ordenesCount).toBe(1)
    expect(body.p2.totalComprado).toBe(200)
  })
})

// ─── Stats por proveedor ───────────────────────────
describe("GET /api/proveedores/[id]/stats", () => {
  beforeEach(() => vi.clearAllMocks())

  function asParams(id: string) {
    return { params: Promise.resolve({ id }) }
  }

  function buildReq() {
    return new Request("http://localhost:3000/api/proveedores/p1/stats")
  }

  it("returns 404 when proveedor not found", async () => {
    mockAuthSuccess()
    const provChain = createChainMock(null, { message: "not found" })
    mockSupabaseFrom({ proveedores: provChain })

    const res = await GET_BY_ID(buildReq(), asParams("missing"))
    const { status, body } = await parseResponse(res)
    expect(status).toBe(404)
    expect(body.error).toContain("no encontrado")
  })

  it("computes KPIs: valorStock, sinStock, bajoStock, ordenesAbiertas", async () => {
    mockAuthSuccess()

    const provChain = createChainMock({ id: "p1" })
    const orgChain = createChainMock({ umbral_stock_bajo: 5 })
    const invRows = [
      { stock: 10, stock_minimo: 3, precio_compra: "100", precio_venta: "150" },
      { stock: 0,  stock_minimo: null, precio_compra: "50",  precio_venta: "80" },
      { stock: 2,  stock_minimo: null, precio_compra: "20",  precio_venta: "40" }, // bajo (≤5 global)
    ]
    const ocRows = [
      { estado: "RECIBIDA", total: "1000", fecha_emision: "2026-02-01" },
      { estado: "ENVIADA",  total: "500",  fecha_emision: "2026-03-01" },
      { estado: "BORRADOR", total: "200",  fecha_emision: "2026-04-01" },
    ]

    mockSupabaseFrom({
      proveedores: provChain,
      organizations: orgChain,
      inventario: chainArray(invRows),
      ordenes_compra: chainArray(ocRows),
    })

    const res = await GET_BY_ID(buildReq(), asParams("p1"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.productosCount).toBe(3)
    expect(body.itemsSinStock).toBe(1)
    expect(body.itemsBajoStock).toBe(1) // stock 2 ≤ umbral 5
    expect(body.valorCostoStock).toBe(10 * 100 + 0 * 50 + 2 * 20) // 1040
    expect(body.valorVentaStock).toBe(10 * 150 + 0 * 80 + 2 * 40) // 1580
    expect(body.ordenesCount).toBe(3)
    // BORRADOR + ENVIADA = abiertas
    expect(body.ordenesAbiertas).toBe(2)
    expect(body.totalComprado).toBe(1000)
    expect(body.ultimaCompra).toBe("2026-04-01")
  })
})
