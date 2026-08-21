import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  parseResponse,
} from "./helpers"

import { GET as GET_GLOBAL } from "@/app/api/proveedores/stats/route"
import { GET as GET_BY_ID } from "@/app/api/proveedores/[id]/stats/route"

// totalComprado is the sum of ordenes_compra.total for received purchase
// orders: what the org paid this supplier. It is the same commercial data as
// valorCostoStock, which already sits behind hasInventarioAccess in the very
// same payload.
function chainArray(rows: any[]) {
  const c: any = createChainMock(rows)
  c.then = (resolve: any) => resolve({ data: rows, error: null })
  return c
}

const ocRows = [
  { proveedor_id: "p1", estado: "RECIBIDA", total: "1000", fecha_emision: "2026-04-01" },
  { proveedor_id: "p1", estado: "RECIBIDA_PARCIAL", total: "500", fecha_emision: "2026-05-10" },
]

function seedGlobal() {
  mockSupabaseFrom({
    inventario: chainArray([{ proveedor_id: "p1" }]),
    ordenes_compra: chainArray(ocRows),
  })
}

function seedById() {
  mockSupabaseFrom({
    proveedores: createChainMock({ id: "p1" }),
    organizations: createChainMock({ umbral_stock_bajo: 5 }),
    inventario: chainArray([
      { stock: 10, stock_minimo: 3, precio_compra: "100", precio_venta: "150" },
    ]),
    ordenes_compra: chainArray([
      { estado: "RECIBIDA", total: "1000", fecha_emision: "2026-02-01" },
    ]),
  })
}

const byIdReq = () => new Request("http://localhost:3000/api/proveedores/p1/stats")
const byIdParams = { params: Promise.resolve({ id: "p1" }) }

describe("GET /api/proveedores/stats purchase-spend gating", () => {
  beforeEach(() => vi.clearAllMocks())

  it("keeps totalComprado for ADMIN", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    seedGlobal()
    const { status, body } = await parseResponse(await GET_GLOBAL())
    expect(status).toBe(200)
    expect(body.p1.totalComprado).toBe(1500)
  })

  it("nulls totalComprado for TECNICO", async () => {
    mockAuthSuccess({ role: "TECNICO" })
    seedGlobal()
    const { status, body } = await parseResponse(await GET_GLOBAL())
    expect(status).toBe(200)
    // Non-cost counters stay: they say nothing about what was paid.
    expect(body.p1.productosCount).toBe(1)
    expect(body.p1.ordenesCount).toBe(2)
    expect(body.p1.ultimaCompra).toBe("2026-05-10")
    expect(body.p1.totalComprado).toBeNull()
  })
})

describe("GET /api/proveedores/[id]/stats purchase-spend gating", () => {
  beforeEach(() => vi.clearAllMocks())

  it("keeps totalComprado for ADMIN", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    seedById()
    const { status, body } = await parseResponse(await GET_BY_ID(byIdReq(), byIdParams))
    expect(status).toBe(200)
    expect(body.valorCostoStock).toBe(1000)
    expect(body.totalComprado).toBe(1000)
  })

  it("nulls totalComprado alongside valorCostoStock for TECNICO", async () => {
    mockAuthSuccess({ role: "TECNICO" })
    seedById()
    const { status, body } = await parseResponse(await GET_BY_ID(byIdReq(), byIdParams))
    expect(status).toBe(200)
    // Already gated before this change — asserted so the pair cannot drift apart.
    expect(body.valorCostoStock).toBeNull()
    expect(body.totalComprado).toBeNull()
    // Sale-side value and counters are a different tier and stay visible.
    expect(body.valorVentaStock).toBe(1500)
    expect(body.ordenesCount).toBe(1)
  })
})
