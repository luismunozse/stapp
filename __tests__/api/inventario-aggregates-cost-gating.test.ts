import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth } from "@/lib/auth"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createGetRequest,
  parseResponse,
} from "./helpers"

import { GET as getLotes } from "@/app/api/inventario/[id]/lotes/route"
import { GET as getStats } from "@/app/api/inventario/stats/route"
import { GET as getSummary } from "@/app/api/inventario/summary/route"
import { GET as getProveedorStats } from "@/app/api/proveedores/[id]/stats/route"

function mockRole(role: string) {
  vi.mocked(auth).mockResolvedValue({
    user: { id: "user-1", organizationId: "org-1", role, email: "u@u.com" },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any)
}

// A single organizations row satisfies both the umbral lookup and
// resolveVendedoresHabilitados, which share the same table mock.
function orgChain(vendedoresAdministranInventario = false) {
  return createChainMock({
    umbral_stock_bajo: 5,
    vendedores_administran_inventario: vendedoresAdministranInventario,
  })
}

describe("GET /api/inventario/[id]/lotes — per-lot cost gated by hasInventarioAccess", () => {
  beforeEach(() => vi.clearAllMocks())

  const loteRows = [
    {
      id: "lote-1",
      numero_lote: "L-001",
      cantidad_inicial: 10,
      cantidad_actual: 4,
      costo_unitario: 250,
      fecha_vencimiento: null,
      fecha_recepcion: "2026-01-01",
      estado: "ACTIVO",
      deposito_id: null,
      proveedor_id: null,
      orden_compra_id: null,
      notas: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
  ]

  function ctx(id = "inv-1") {
    return { params: Promise.resolve({ id }) }
  }

  function wire(vendedoresAdministranInventario = false) {
    mockSupabaseFrom({
      inventario_lotes: createChainMock(loteRows),
      organizations: orgChain(vendedoresAdministranInventario),
    })
  }

  it("ADMIN sees costo_unitario (no behavior change)", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    wire()

    const { status, body } = await parseResponse(await getLotes(createGetRequest(), ctx()))

    expect(status).toBe(200)
    expect(body.data[0].costo_unitario).toBe(250)
  })

  it("TECNICO — costo_unitario stripped, lot tracking data intact", async () => {
    mockRole("TECNICO")
    wire()

    const { status, body } = await parseResponse(await getLotes(createGetRequest(), ctx()))

    expect(status).toBe(200)
    expect(body.data[0].costo_unitario).toBeNull()
    expect(body.data[0].numero_lote).toBe("L-001")
    expect(body.data[0].cantidad_actual).toBe(4)
    expect(body.data[0].estado).toBe("ACTIVO")
  })

  it("VENDEDOR without inventario opt-in — costo_unitario stripped", async () => {
    mockRole("VENDEDOR")
    wire(false)

    const { status, body } = await parseResponse(await getLotes(createGetRequest(), ctx()))

    expect(status).toBe(200)
    expect(body.data[0].costo_unitario).toBeNull()
  })

  it("VENDEDOR with inventario opt-in — costo_unitario visible", async () => {
    mockRole("VENDEDOR")
    wire(true)

    const { status, body } = await parseResponse(await getLotes(createGetRequest(), ctx()))

    expect(status).toBe(200)
    expect(body.data[0].costo_unitario).toBe(250)
  })
})

describe("GET /api/inventario/stats — cost-derived aggregates gated", () => {
  beforeEach(() => vi.clearAllMocks())

  // 10 units at 100 cost / 200 sale, minimo 5; plus one out-of-stock item whose
  // replenishment cost feeds valorEnRiesgo.
  const items = [
    { stock: 10, stock_reservado: 0, precio_compra: 100, precio_venta: 200, stock_minimo: 5 },
    { stock: 0, stock_reservado: 0, precio_compra: 50, precio_venta: 90, stock_minimo: 4 },
  ]

  function wire(vendedoresAdministranInventario = false) {
    mockSupabaseFrom({
      organizations: orgChain(vendedoresAdministranInventario),
      inventario: createChainMock(items),
    })
  }

  it("ADMIN sees valorCosto and valorEnRiesgo (no behavior change)", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    wire()

    const { status, body } = await parseResponse(await getStats())

    expect(status).toBe(200)
    expect(body.valorCosto).toBe(1000)
    expect(body.valorEnRiesgo).toBe(200)
  })

  it("TECNICO — cost aggregates stripped, counts and sale value intact", async () => {
    mockRole("TECNICO")
    wire()

    const { status, body } = await parseResponse(await getStats())

    expect(status).toBe(200)
    expect(body.valorCosto).toBeNull()
    expect(body.valorEnRiesgo).toBeNull()
    expect(body.totalSkus).toBe(2)
    expect(body.sinStock).toBe(1)
    expect(body.valorVenta).toBe(2000)
  })

  it("VENDEDOR without inventario opt-in — cost aggregates stripped", async () => {
    mockRole("VENDEDOR")
    wire(false)

    const { body } = await parseResponse(await getStats())

    expect(body.valorCosto).toBeNull()
    expect(body.valorEnRiesgo).toBeNull()
  })
})

describe("GET /api/inventario/summary — cost-derived aggregates gated", () => {
  beforeEach(() => vi.clearAllMocks())

  const items = [{ stock: 10, precio_compra: 100, precio_venta: 200, stock_minimo: 5 }]

  function wire(vendedoresAdministranInventario = false) {
    mockSupabaseFrom({
      organizations: orgChain(vendedoresAdministranInventario),
      inventario: createChainMock(items),
    })
  }

  it("ADMIN sees valorCosto and margenEstimado (no behavior change)", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    wire()

    const { status, body } = await parseResponse(await getSummary(createGetRequest()))

    expect(status).toBe(200)
    expect(body.valorCosto).toBe(1000)
    expect(body.margenEstimado).toBe(1000)
  })

  // margenEstimado is valorVenta - valorCosto, so leaving it exposed hands the
  // gated role the cost back by subtraction.
  it("TECNICO — valorCosto and margenEstimado stripped, counts and sale value intact", async () => {
    mockRole("TECNICO")
    wire()

    const { status, body } = await parseResponse(await getSummary(createGetRequest()))

    expect(status).toBe(200)
    expect(body.valorCosto).toBeNull()
    expect(body.margenEstimado).toBeNull()
    expect(body.totalArticulos).toBe(1)
    expect(body.totalStock).toBe(10)
    expect(body.valorVenta).toBe(2000)
  })
})

describe("GET /api/proveedores/[id]/stats — stock cost gated", () => {
  beforeEach(() => vi.clearAllMocks())

  function ctx(id = "prov-1") {
    return { params: Promise.resolve({ id }) }
  }

  function wire(vendedoresAdministranInventario = false) {
    mockSupabaseFrom({
      proveedores: createChainMock({ id: "prov-1" }),
      organizations: orgChain(vendedoresAdministranInventario),
      inventario: createChainMock([
        { stock: 4, stock_minimo: 2, precio_compra: 250, precio_venta: 400 },
      ]),
      ordenes_compra: createChainMock([
        { estado: "RECIBIDA", total: 1000, fecha_emision: "2026-01-05" },
      ]),
    })
  }

  it("ADMIN sees valorCostoStock (no behavior change)", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    wire()

    const { status, body } = await parseResponse(await getProveedorStats(createGetRequest(), ctx()))

    expect(status).toBe(200)
    expect(body.valorCostoStock).toBe(1000)
  })

  // With a single product, valorCostoStock / (productosCount * stock) is that
  // item's exact precio_compra — the number the rest of the branch hides.
  it("TECNICO — valorCostoStock stripped, counts and sale value intact", async () => {
    mockRole("TECNICO")
    wire()

    const { status, body } = await parseResponse(await getProveedorStats(createGetRequest(), ctx()))

    expect(status).toBe(200)
    expect(body.valorCostoStock).toBeNull()
    expect(body.productosCount).toBe(1)
    expect(body.valorVentaStock).toBe(1600)
    expect(body.ordenesCount).toBe(1)
  })

  it("VENDEDOR with inventario opt-in — valorCostoStock visible", async () => {
    mockRole("VENDEDOR")
    wire(true)

    const { body } = await parseResponse(await getProveedorStats(createGetRequest(), ctx()))

    expect(body.valorCostoStock).toBe(1000)
  })
})
