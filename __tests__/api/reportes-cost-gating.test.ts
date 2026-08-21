/**
 * Purchase cost is gated on the report endpoints too.
 *
 * These routes are guarded by requireAdminOrVendedor(), which is a deliberate
 * product tier for org-level financial figures. But a VENDEDOR denied
 * precioCompra on /api/inventario could read the identical number here, which
 * is a hole in that gate rather than a tier.
 *
 * The rule: a caller who cannot see per-item purchase cost does not receive
 * cost-derived figures AT ALL, at any aggregation level.
 *
 * An earlier version of this rule spared the org-wide totals, on the theory
 * that one number over the whole inventory does not reduce to a single item.
 * That theory is wrong, and it is retired. When totalItems === 1 — a new org,
 * or one that sells a single SKU — valorCompra / totalUnidades IS the exact
 * per-unit purchase cost, and the payload shipped both operands side by side.
 * The routes already stripped the per-category total for precisely that
 * reason, so the old rule denied the gated role the category number and handed
 * it the org number that equals it.
 *
 * margenPotencial is gated as a consequence, and that is now load-bearing
 * rather than decorative: its cost operand is no longer visible, so the
 * subtraction that used to defeat the gate no longer has both terms.
 *
 * Non-cost figures — totalItems, totalUnidades, valorVenta, counts — stay
 * visible: the tier they belong to has not changed.
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

import { hasPlanFeature } from "@/lib/subscriptions"
import { GET as getAnalisis } from "@/app/api/reportes/analisis-inventario/route"
import { GET as getAnalytics } from "@/app/api/reportes/inventario-analytics/route"
import { GET as getPrediccion } from "@/app/api/reportes/prediccion-repuestos/route"

function mockRole(role: string) {
  vi.mocked(auth).mockResolvedValue({
    user: { id: "user-1", organizationId: "org-1", role, email: "u@u.com" },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any)
}

// One organizations row serves both the umbral lookup and
// resolveVendedoresHabilitados, which share the same table mock.
function orgChain(vendedoresAdministranInventario = false) {
  return createChainMock({
    umbral_stock_bajo: 5,
    vendedores_administran_inventario: vendedoresAdministranInventario,
  })
}

describe("GET /api/reportes/analisis-inventario — per-item cost gated", () => {
  beforeEach(() => vi.clearAllMocks())

  const items = [
    {
      id: "inv-1",
      codigo: "A1",
      nombre: "Pantalla",
      categoria: "Repuestos",
      stock: 10,
      precio_compra: 100,
      precio_venta: 200,
    },
    {
      id: "inv-2",
      codigo: "A2",
      nombre: "Bateria",
      categoria: "Repuestos",
      stock: 0,
      precio_compra: 50,
      precio_venta: 90,
    },
  ]

  function wire(vendedoresAdministranInventario = false) {
    mockSupabaseFrom({
      inventario: createChainMock(items),
      organizations: orgChain(vendedoresAdministranInventario),
      movimientos_inventario: createChainMock([]),
    })
  }

  it("ADMIN sees per-item cost and valorEnStock (no behavior change)", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    wire()

    const { status, body } = await parseResponse(await getAnalisis())

    expect(status).toBe(200)
    expect(body.stockCritico[0].precioCompra).toBe(50)
    expect(body.sinStock[0].precioCompra).toBe(50)
    expect(body.masValiosos[0].precioCompra).toBe(100)
    expect(body.masValiosos[0].valorEnStock).toBe(1000)
  })

  // valorEnStock is precioCompra * stock and stock ships in the same row, so
  // leaving it exposed hands the gated role the cost back by division.
  it("VENDEDOR without inventario opt-in — per-item cost and valorEnStock stripped", async () => {
    mockRole("VENDEDOR")
    wire(false)

    const { status, body } = await parseResponse(await getAnalisis())

    expect(status).toBe(200)
    expect(body.stockCritico[0].precioCompra).toBeNull()
    expect(body.sinStock[0].precioCompra).toBeNull()
    expect(body.masValiosos[0].precioCompra).toBeNull()
    expect(body.masValiosos[0].valorEnStock).toBeNull()
    // Non-cost per-item data is untouched.
    expect(body.masValiosos[0].nombre).toBe("Pantalla")
    expect(body.masValiosos[0].stock).toBe(10)
    expect(body.masValiosos[0].precioVenta).toBe(200)
  })

  it("ADMIN sees the category cost total", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    wire()

    const { body } = await parseResponse(await getAnalisis())

    expect(body.porCategoria[0].valorTotal).toBe(1000)
  })

  // porCategoria.valorTotal is a purchase-cost total over one category, and a
  // category can hold a single SKU — then it is precio_compra × stock, the
  // per-item number stripped a few lines above.
  it("VENDEDOR without opt-in — category cost total stripped", async () => {
    mockRole("VENDEDOR")
    wire(false)

    const { body } = await parseResponse(await getAnalisis())

    expect(body.porCategoria[0].valorTotal).toBeNull()
    // Non-cost category data is untouched.
    expect(body.porCategoria[0].categoria).toBe("Repuestos")
    expect(body.porCategoria[0].cantidad).toBe(2)
    expect(body.porCategoria[0].stockTotal).toBe(10)
  })

  it("ADMIN sees the org-wide cost total and the margin (no behavior change)", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    wire()

    const { body } = await parseResponse(await getAnalisis())

    expect(body.resumen.valorCompra).toBe(1000)
    expect(body.resumen.margenPotencial).toBe(1000)
  })

  it("VENDEDOR without opt-in — the org-wide cost total and the margin are stripped", async () => {
    mockRole("VENDEDOR")
    wire(false)

    const { body } = await parseResponse(await getAnalisis())

    expect(body.resumen.valorCompra).toBeNull()
    expect(body.resumen.margenPotencial).toBeNull()
  })

  it("VENDEDOR without opt-in — non-cost figures in the summary stay visible", async () => {
    mockRole("VENDEDOR")
    wire(false)

    const { body } = await parseResponse(await getAnalisis())

    expect(body.resumen.totalItems).toBe(2)
    expect(body.resumen.totalUnidades).toBe(10)
    expect(body.resumen.valorVenta).toBe(2000)
    expect(body.resumen.itemsSinStock).toBe(1)
    expect(body.resumen.categorias).toBe(1)
  })

  // The case that retired the "org-wide totals are safe" rule: with a single
  // SKU in the org, valorCompra / totalUnidades is the exact per-unit purchase
  // cost, and the summary used to hand over both operands at once.
  it("VENDEDOR without opt-in — a single-SKU org cannot divide the org total back into the unit cost", async () => {
    mockRole("VENDEDOR")
    mockSupabaseFrom({
      inventario: createChainMock([items[0]]),
      organizations: orgChain(false),
      movimientos_inventario: createChainMock([]),
    })

    const { body } = await parseResponse(await getAnalisis())

    expect(body.resumen.totalItems).toBe(1)
    expect(body.resumen.totalUnidades).toBe(10)
    // 1000 / 10 === 100 === precio_compra. The numerator must not be there.
    expect(body.resumen.valorCompra).toBeNull()
    expect(body.resumen.margenPotencial).toBeNull()
  })

  it("VENDEDOR with inventario opt-in — per-item and category costs visible", async () => {
    mockRole("VENDEDOR")
    wire(true)

    const { body } = await parseResponse(await getAnalisis())

    expect(body.masValiosos[0].precioCompra).toBe(100)
    expect(body.masValiosos[0].valorEnStock).toBe(1000)
    expect(body.porCategoria[0].valorTotal).toBe(1000)
  })
})

describe("GET /api/reportes/inventario-analytics — per-item cost gated", () => {
  beforeEach(() => vi.clearAllMocks())

  const items = [
    {
      id: "inv-1",
      codigo: "A1",
      nombre: "Pantalla",
      categoria: "Repuestos",
      tipo_dispositivo: null,
      stock: 4,
      precio_compra: 250,
      precio_venta: 400,
      proveedor: null,
      stock_minimo: 2,
      punto_reorden: null,
    },
  ]

  function wire(vendedoresAdministranInventario = false) {
    mockSupabaseFrom({
      inventario: createChainMock(items),
      organizations: orgChain(vendedoresAdministranInventario),
      movimientos_inventario: createChainMock([]),
    })
  }

  it("ADMIN sees per-item cost and capitalInmovilizado (no behavior change)", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    wire()

    const { status, body } = await parseResponse(await getAnalytics())

    expect(status).toBe(200)
    expect(body.sinMovimiento[0].precioCompra).toBe(250)
    expect(body.sinMovimiento[0].capitalInmovilizado).toBe(1000)
  })

  // capitalInmovilizado here is per-item (stock * precio_compra) and stock is
  // in the same row, so it divides straight back into the gated cost.
  it("VENDEDOR without inventario opt-in — per-item cost and capitalInmovilizado stripped", async () => {
    mockRole("VENDEDOR")
    wire(false)

    const { status, body } = await parseResponse(await getAnalytics())

    expect(status).toBe(200)
    expect(body.sinMovimiento[0].precioCompra).toBeNull()
    expect(body.sinMovimiento[0].capitalInmovilizado).toBeNull()
    expect(body.sinMovimiento[0].stock).toBe(4)
    expect(body.sinMovimiento[0].precioVenta).toBe(400)
  })

  it("ADMIN sees the category cost total", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    wire()

    const { body } = await parseResponse(await getAnalytics())

    expect(body.porCategoria[0].valorCosto).toBe(1000)
  })

  // Same rule as analisis-inventario: a category can hold one SKU, so its cost
  // total is per-item cost in disguise.
  it("VENDEDOR without opt-in — category cost total stripped", async () => {
    mockRole("VENDEDOR")
    wire(false)

    const { body } = await parseResponse(await getAnalytics())

    expect(body.porCategoria[0].valorCosto).toBeNull()
    // Non-cost category data is untouched.
    expect(body.porCategoria[0].categoria).toBe("Repuestos")
    expect(body.porCategoria[0].items).toBe(1)
    expect(body.porCategoria[0].stock).toBe(4)
    expect(body.porCategoria[0].valorVenta).toBe(1600)
  })

  it("ADMIN sees the org-wide valorization total and the margin (no behavior change)", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    wire()

    const { body } = await parseResponse(await getAnalytics())

    expect(body.valorizacion.valorCosto).toBe(1000)
    expect(body.valorizacion.margenPotencial).toBe(600)
  })

  // Same shape as analisis-inventario: this fixture is a single-SKU org, so
  // valorCosto / totalUnidades (1000 / 4) is precio_compra exactly.
  it("VENDEDOR without opt-in — the org-wide valorization total and the margin are stripped", async () => {
    mockRole("VENDEDOR")
    wire(false)

    const { body } = await parseResponse(await getAnalytics())

    expect(body.valorizacion.valorCosto).toBeNull()
    expect(body.valorizacion.margenPotencial).toBeNull()
  })

  it("VENDEDOR without opt-in — non-cost valorization figures stay visible", async () => {
    mockRole("VENDEDOR")
    wire(false)

    const { body } = await parseResponse(await getAnalytics())

    expect(body.valorizacion.valorVenta).toBe(1600)
    expect(body.valorizacion.totalItems).toBe(1)
    expect(body.valorizacion.totalUnidades).toBe(4)
  })

  it("VENDEDOR with inventario opt-in — per-item and category costs visible", async () => {
    mockRole("VENDEDOR")
    wire(true)

    const { body } = await parseResponse(await getAnalytics())

    expect(body.sinMovimiento[0].precioCompra).toBe(250)
    expect(body.sinMovimiento[0].capitalInmovilizado).toBe(1000)
    expect(body.porCategoria[0].valorCosto).toBe(1000)
  })
})

describe("GET /api/reportes/prediccion-repuestos — per-item costoReposicion gated", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(hasPlanFeature).mockResolvedValue(true)
  })

  const inventario = [
    { id: "inv-1", nombre: "Pantalla", codigo: "A1", stock: 5, precio_compra: 100 },
  ]

  const uso = [
    {
      inventario_id: "inv-1",
      cantidad: 6,
      ordenes_servicio: { organization_id: "org-1", sucursal_id: null, fecha_ingreso: "2026-08-01" },
    },
  ]

  function wire(vendedoresAdministranInventario = false) {
    mockSupabaseFrom({
      inventario: createChainMock(inventario),
      repuestos_orden: createChainMock(uso),
      organizations: orgChain(vendedoresAdministranInventario),
    })
  }

  it("ADMIN sees costoReposicion (no behavior change)", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    wire()

    const { status, body } = await parseResponse(await getPrediccion())

    expect(status).toBe(200)
    expect(body.data[0].costoReposicion).toBe(200)
  })

  // costoReposicion is usoMensualPromedio * precio_compra and the average
  // ships in the same row, so it divides straight back into the gated cost.
  it("VENDEDOR without inventario opt-in — costoReposicion stripped, forecast intact", async () => {
    mockRole("VENDEDOR")
    wire(false)

    const { status, body } = await parseResponse(await getPrediccion())

    expect(status).toBe(200)
    expect(body.data[0].costoReposicion).toBeNull()
    expect(body.data[0].usoMensualPromedio).toBe(2)
    expect(body.data[0].stockActual).toBe(5)
    expect(body.data[0].urgencia).toBe("NORMAL")
  })

  it("VENDEDOR with inventario opt-in — costoReposicion visible", async () => {
    mockRole("VENDEDOR")
    wire(true)

    const { body } = await parseResponse(await getPrediccion())

    expect(body.data[0].costoReposicion).toBe(200)
  })
})
