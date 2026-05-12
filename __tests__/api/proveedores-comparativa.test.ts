import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  mockAuthError,
  createChainMock,
  mockSupabaseFrom,
  parseResponse,
} from "./helpers"

import { GET } from "@/app/api/proveedores/[id]/comparativa/route"

function asParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

function buildReq(id: string) {
  return new Request(`http://localhost:3000/api/proveedores/${id}/comparativa`)
}

function chainArray(rows: any[]) {
  const c: any = createChainMock(rows)
  c.then = (resolve: any) => resolve({ data: rows, error: null })
  return c
}

describe("GET /api/proveedores/[id]/comparativa", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 401 when not authenticated", async () => {
    mockAuthError()
    const res = await GET(buildReq("p1"), asParams("p1"))
    const { status } = await parseResponse(res)
    expect(status).toBe(401)
  })

  it("returns 404 when proveedor not found", async () => {
    mockAuthSuccess()
    mockSupabaseFrom({
      proveedores: createChainMock(null, { message: "not found" }),
    })
    const res = await GET(buildReq("p1"), asParams("p1"))
    const { status } = await parseResponse(res)
    expect(status).toBe(404)
  })

  it("excludes codigos sólo con 1 proveedor; flag mineIsCheapest", async () => {
    mockAuthSuccess()

    const provChain = createChainMock({ id: "p1", nombre: "Mi Proveedor" })

    const invRows = [
      // codigo COMP — 3 proveedores
      { id: "i1", codigo: "COMP", nombre: "Item Compartido", stock: 5, precio_compra: "100", precio_venta: "150", proveedor_id: "p1", proveedores: { id: "p1", nombre: "Mi Proveedor" } },
      { id: "i2", codigo: "COMP", nombre: "Item Compartido", stock: 2, precio_compra: "90",  precio_venta: "140", proveedor_id: "p2", proveedores: { id: "p2", nombre: "Otro A" } },
      { id: "i3", codigo: "COMP", nombre: "Item Compartido", stock: 7, precio_compra: "120", precio_venta: "160", proveedor_id: "p3", proveedores: { id: "p3", nombre: "Otro B" } },
      // codigo BARATO — 2 proveedores, mío es el más barato
      { id: "i4", codigo: "BARATO", nombre: "Mas barato acá", stock: 1, precio_compra: "50", precio_venta: "80", proveedor_id: "p1", proveedores: { id: "p1", nombre: "Mi Proveedor" } },
      { id: "i5", codigo: "BARATO", nombre: "Mas barato acá", stock: 1, precio_compra: "80", precio_venta: "100", proveedor_id: "p2", proveedores: { id: "p2", nombre: "Otro A" } },
      // codigo SOLO — sólo yo (no debe aparecer)
      { id: "i6", codigo: "SOLO", nombre: "Solo mío", stock: 1, precio_compra: "10", precio_venta: "20", proveedor_id: "p1", proveedores: { id: "p1", nombre: "Mi Proveedor" } },
      // codigo OTROS — sólo otros proveedores (no debe aparecer porque proveedor target no lo tiene)
      { id: "i7", codigo: "OTROS", nombre: "Solo otros", stock: 1, precio_compra: "30", precio_venta: "50", proveedor_id: "p2", proveedores: { id: "p2", nombre: "Otro A" } },
    ]

    mockSupabaseFrom({
      proveedores: provChain,
      inventario: chainArray(invRows),
    })

    const res = await GET(buildReq("p1"), asParams("p1"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.proveedor.id).toBe("p1")
    expect(body.items).toHaveLength(2)

    const byCode: Record<string, any> = {}
    for (const it of body.items) byCode[it.codigo] = it

    // COMP: mío 100, otros [90, 120], minPrecioCompra = 90, mineIsCheapest = false
    expect(byCode.COMP).toBeDefined()
    expect(byCode.COMP.mine.precioCompra).toBe(100)
    expect(byCode.COMP.others).toHaveLength(2)
    expect(byCode.COMP.minPrecioCompra).toBe(90)
    expect(byCode.COMP.mineIsCheapest).toBe(false)

    // BARATO: mío 50, otro 80, min = 50, mineIsCheapest = true
    expect(byCode.BARATO).toBeDefined()
    expect(byCode.BARATO.minPrecioCompra).toBe(50)
    expect(byCode.BARATO.mineIsCheapest).toBe(true)

    // SOLO no debe aparecer
    expect(byCode.SOLO).toBeUndefined()
    // OTROS tampoco
    expect(byCode.OTROS).toBeUndefined()
  })

  it("ordena alfabéticamente por código", async () => {
    mockAuthSuccess()
    const provChain = createChainMock({ id: "p1", nombre: "X" })
    const invRows = [
      { id: "a", codigo: "ZZZ", nombre: "z", stock: 1, precio_compra: "10", precio_venta: "20", proveedor_id: "p1", proveedores: { id: "p1", nombre: "X" } },
      { id: "b", codigo: "ZZZ", nombre: "z", stock: 1, precio_compra: "11", precio_venta: "20", proveedor_id: "p2", proveedores: { id: "p2", nombre: "Y" } },
      { id: "c", codigo: "AAA", nombre: "a", stock: 1, precio_compra: "10", precio_venta: "20", proveedor_id: "p1", proveedores: { id: "p1", nombre: "X" } },
      { id: "d", codigo: "AAA", nombre: "a", stock: 1, precio_compra: "11", precio_venta: "20", proveedor_id: "p2", proveedores: { id: "p2", nombre: "Y" } },
    ]
    mockSupabaseFrom({
      proveedores: provChain,
      inventario: chainArray(invRows),
    })

    const res = await GET(buildReq("p1"), asParams("p1"))
    const { body } = await parseResponse(res)
    expect(body.items.map((i: any) => i.codigo)).toEqual(["AAA", "ZZZ"])
  })
})
