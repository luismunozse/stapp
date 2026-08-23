/**
 * Nulling the cost is not enough when the list ORDER is the cost.
 *
 * These reports build a list, sort it by a cost-derived key, slice a top-N, and
 * only then null the money. A gated caller still receives the rows ranked by
 * stock x precio_compra with `stock` visible on every row — divide the rank
 * position out and the relative unit cost comes back. The slice leaks too: the
 * membership of a "top 20 by capital" list is itself the ranking.
 *
 * So when the caller cannot see cost, both the sort key AND the selection have
 * to be cost-free. For the roles that CAN see cost nothing changes: same order,
 * same members, same report as before.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth } from "@/lib/auth"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn(),
}))

import { GET as getAnalisis } from "@/app/api/reportes/analisis-inventario/route"
import { GET as getAnalytics } from "@/app/api/reportes/inventario-analytics/route"

function mockRole(role: string) {
  vi.mocked(auth).mockResolvedValue({
    user: { id: "user-1", organizationId: "org-1", role, email: "u@u.com" },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any)
}

function orgChain(vendedoresAdministranInventario = false) {
  return createChainMock({
    umbral_stock_bajo: 5,
    vendedores_administran_inventario: vendedoresAdministranInventario,
  })
}

/**
 * Cost rank and stock rank are deliberately INVERTED here, so an assertion on
 * the resulting order can only pass for one of the two sort keys.
 *
 *   barato : stock 100, costo 1   -> capital  100  (cost rank #3, stock rank #1)
 *   medio  : stock  10, costo 50  -> capital  500  (cost rank #2, stock rank #2)
 *   caro   : stock   1, costo 900 -> capital  900  (cost rank #1, stock rank #3)
 */
const items = [
  {
    id: "medio",
    codigo: "M",
    nombre: "Medio",
    categoria: "Media",
    tipo_dispositivo: "CELULAR",
    stock: 10,
    precio_compra: 50,
    precio_venta: 80,
    proveedor: null,
    stock_minimo: 0,
    punto_reorden: null,
  },
  {
    id: "caro",
    codigo: "C",
    nombre: "Caro",
    categoria: "Cara",
    tipo_dispositivo: "CELULAR",
    stock: 1,
    precio_compra: 900,
    precio_venta: 1200,
    proveedor: null,
    stock_minimo: 0,
    punto_reorden: null,
  },
  {
    id: "barato",
    codigo: "B",
    nombre: "Barato",
    categoria: "Barata",
    tipo_dispositivo: "CELULAR",
    stock: 100,
    precio_compra: 1,
    precio_venta: 5,
    proveedor: null,
    stock_minimo: 0,
    punto_reorden: null,
  },
]

describe("GET /api/reportes/inventario-analytics — sinMovimiento ordering", () => {
  beforeEach(() => vi.clearAllMocks())

  function wire(vendedoresHabilitados = false) {
    mockSupabaseFrom({
      inventario: createChainMock(items),
      // No sale movements: every item lands in sinMovimiento.
      movimientos_inventario: createChainMock([]),
      organizations: orgChain(vendedoresHabilitados),
    })
  }

  it("keeps the capital ordering for ADMIN (report unchanged)", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    wire()

    const { status, body } = await parseResponse(await getAnalytics())

    expect(status).toBe(200)
    expect(body.sinMovimiento.map((i: any) => i.id)).toEqual(["caro", "medio", "barato"])
    expect(body.sinMovimiento[0].capitalInmovilizado).toBe(900)
  })

  it("does not rank by capital for a gated VENDEDOR", async () => {
    mockRole("VENDEDOR")
    wire(false)

    const { status, body } = await parseResponse(await getAnalytics())

    expect(status).toBe(200)
    const ids = body.sinMovimiento.map((i: any) => i.id)
    // Cost-free key: stock desc. The exact inverse of the capital ranking.
    expect(ids).toEqual(["barato", "medio", "caro"])
    expect(body.sinMovimiento[0].capitalInmovilizado).toBeNull()
    expect(body.sinMovimiento[0].precioCompra).toBeNull()
    // Stock stays visible — it is not cost, and the dead-stock list needs it.
    expect(body.sinMovimiento[0].stock).toBe(100)
  })

  it("keeps the capital ordering for a VENDEDOR the org opted in", async () => {
    mockRole("VENDEDOR")
    wire(true)

    const { body } = await parseResponse(await getAnalytics())

    expect(body.sinMovimiento.map((i: any) => i.id)).toEqual(["caro", "medio", "barato"])
    expect(body.sinMovimiento[0].capitalInmovilizado).toBe(900)
  })
})

describe("GET /api/reportes/analisis-inventario — masValiosos and porCategoria ordering", () => {
  beforeEach(() => vi.clearAllMocks())

  function wire(vendedoresHabilitados = false) {
    mockSupabaseFrom({
      inventario: createChainMock(items),
      movimientos_inventario: createChainMock([]),
      organizations: orgChain(vendedoresHabilitados),
    })
  }

  it("keeps the value ordering for ADMIN (report unchanged)", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    wire()

    const { status, body } = await parseResponse(await getAnalisis())

    expect(status).toBe(200)
    expect(body.masValiosos.map((i: any) => i.id)).toEqual(["caro", "medio", "barato"])
    expect(body.masValiosos[0].valorEnStock).toBe(900)
    expect(body.porCategoria.map((c: any) => c.categoria)).toEqual(["Cara", "Media", "Barata"])
  })

  it("does not rank masValiosos by value for a gated VENDEDOR", async () => {
    mockRole("VENDEDOR")
    wire(false)

    const { status, body } = await parseResponse(await getAnalisis())

    expect(status).toBe(200)
    expect(body.masValiosos.map((i: any) => i.id)).toEqual(["barato", "medio", "caro"])
    expect(body.masValiosos[0].valorEnStock).toBeNull()
    expect(body.masValiosos[0].precioCompra).toBeNull()
  })

  it("does not rank porCategoria by cost value for a gated VENDEDOR", async () => {
    mockRole("VENDEDOR")
    wire(false)

    const { body } = await parseResponse(await getAnalisis())

    // Cost-free key: stock total desc, the inverse of the cost-value ranking.
    expect(body.porCategoria.map((c: any) => c.categoria)).toEqual(["Barata", "Media", "Cara"])
    expect(body.porCategoria[0].valorTotal).toBeNull()
    expect(body.porCategoria[0].stockTotal).toBe(100)
  })

  it("keeps the value ordering for a VENDEDOR the org opted in", async () => {
    mockRole("VENDEDOR")
    wire(true)

    const { body } = await parseResponse(await getAnalisis())

    expect(body.masValiosos.map((i: any) => i.id)).toEqual(["caro", "medio", "barato"])
    expect(body.porCategoria.map((c: any) => c.categoria)).toEqual(["Cara", "Media", "Barata"])
  })

  it("does not let the top-N membership be chosen by cost for a gated VENDEDOR", async () => {
    mockRole("VENDEDOR")
    // An item with stock but no cost is excluded from masValiosos today
    // (valorEnStock > 0). For a gated caller that filter is itself a cost
    // signal, so selection has to fall back to stock.
    mockSupabaseFrom({
      inventario: createChainMock([
        ...items,
        {
          id: "sin-costo",
          codigo: "S",
          nombre: "Sin costo",
          categoria: "Otra",
          tipo_dispositivo: "CELULAR",
          stock: 500,
          precio_compra: null,
          precio_venta: 10,
          proveedor: null,
          stock_minimo: 0,
          punto_reorden: null,
        },
      ]),
      movimientos_inventario: createChainMock([]),
      organizations: orgChain(false),
    })

    const { body } = await parseResponse(await getAnalisis())

    expect(body.masValiosos.map((i: any) => i.id)).toEqual([
      "sin-costo",
      "barato",
      "medio",
      "caro",
    ])
  })
})
