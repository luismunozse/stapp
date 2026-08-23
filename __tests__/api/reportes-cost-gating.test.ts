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
  createGetRequest,
  mockSupabaseFrom,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn(),
}))

vi.mock("@/lib/sucursal", () => ({
  sucursalParaLectura: vi.fn().mockResolvedValue({ verTodas: true, sucursalId: null }),
}))

import { hasPlanFeature } from "@/lib/subscriptions"
import { GET as getAnalisis } from "@/app/api/reportes/analisis-inventario/route"
import { GET as getAnalytics } from "@/app/api/reportes/inventario-analytics/route"
import { GET as getPrediccion } from "@/app/api/reportes/prediccion-repuestos/route"
import { GET as getRentabilidad } from "@/app/api/reportes/rentabilidad/route"
import { GET as getRentabilidadTecnicos } from "@/app/api/reportes/rentabilidad-tecnicos/route"
import { GET as getVentasAnalytics } from "@/app/api/reportes/ventas-analytics/route"

function mockRole(role: string) {
  vi.mocked(auth).mockResolvedValue({
    user: { id: "user-1", organizationId: "org-1", role, email: "u@u.com" },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any)
}

// One organizations row serves the umbral lookup, the commission flag and
// resolveVendedoresHabilitados, which all share the same table mock.
function orgChain(vendedoresAdministranInventario = false) {
  return createChainMock({
    umbral_stock_bajo: 5,
    comision_aplica_sin_reparacion: false,
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

/**
 * The three siblings below sit behind the same requireAdminOrVendedor() guard
 * as the reports above and derive the same purchase cost, but by a different
 * route: repuestos_orden.precio_unitario is a FROZEN copy of precio_compra,
 * and items_cotizacion falls back to inventario.precio_compra outright.
 *
 * The single-order fixture is the reduction that makes this per-item rather
 * than aggregate: one técnico, one order, one repuesto of quantity 1, so
 * costoRepuestos IS precio_compra exactly — the number /api/ordenes/[id]
 * already nulls for the same role.
 *
 * Gating only the cost line is not enough, and that lesson is already written
 * into analisis-inventario: ganancia is ingresos - costos with ingresos in the
 * same row, so it hands the cost back by subtraction. margen and
 * gananciaPorHora are ganancia rescaled by visible divisors. Every figure in
 * that closure is gated, and the sort key moves off it too, because ordering
 * rows by a cost-derived key survives nulling the number.
 */

describe("GET /api/reportes/rentabilidad-tecnicos — repuesto cost gated", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(hasPlanFeature).mockResolvedValue(true)
  })

  // No date range: the route falls back to the current month.
  const tecnicosRequest = () =>
    createGetRequest("http://localhost:3000/api/reportes/rentabilidad-tecnicos")

  // costoRepuestos = 1 x 300 = 300, the frozen precio_compra itself.
  // comision = (1000 - 300) x 10% = 70. manoObra = 100.
  // ganancia = 1000 - 300 - 100 - 70 = 530. margen = 53%.
  // gananciaPorHora = 530 / 2 = 265.
  const ordenes = [
    {
      id: "ord-1",
      tecnico_id: "tec-1",
      costo_final: "1000",
      porcentaje_comision: "10",
      estado: "ENTREGADO",
      horas_trabajadas: "2",
      costo_mano_obra: "100",
      tecnico: { nombre: "Ana Torres" },
      repuestos_orden: [{ cantidad: 1, precio_unitario: "300" }],
      cotizaciones: [],
    },
  ]

  function wire(vendedoresAdministranInventario = false) {
    mockSupabaseFrom({
      ordenes_servicio: createChainMock(ordenes),
      organizations: orgChain(vendedoresAdministranInventario),
    })
  }

  it("ADMIN sees the repuesto cost and the whole profit closure (no behavior change)", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    wire()

    const { status, body } = await parseResponse(await getRentabilidadTecnicos(tecnicosRequest()))

    expect(status).toBe(200)
    expect(body.data[0].costoRepuestos).toBe(300)
    expect(body.data[0].comision).toBe(70)
    expect(body.data[0].ganancia).toBe(530)
    expect(body.data[0].margen).toBe(53)
    expect(body.data[0].gananciaPorHora).toBe(265)
    expect(body.totales.ganancia).toBe(530)
    expect(body.margenPromedio).toBe(53)
  })

  it("VENDEDOR without inventario opt-in — costoRepuestos stripped", async () => {
    mockRole("VENDEDOR")
    wire(false)

    const { status, body } = await parseResponse(await getRentabilidadTecnicos(tecnicosRequest()))

    expect(status).toBe(200)
    expect(body.data[0].costoRepuestos).toBeNull()
  })

  // ganancia is ingresos - costoRepuestos - costoManoObra - comision, and
  // ingresos and costoManoObra ship in the same row: leaving it exposed hands
  // the cost back by subtraction, exactly the way margenPotencial did.
  it("VENDEDOR without opt-in — the figures that invert back to the cost are stripped too", async () => {
    mockRole("VENDEDOR")
    wire(false)

    const { body } = await parseResponse(await getRentabilidadTecnicos(tecnicosRequest()))

    expect(body.data[0].ganancia).toBeNull()
    expect(body.data[0].margen).toBeNull()
    expect(body.data[0].gananciaPorHora).toBeNull()
    expect(body.data[0].comision).toBeNull()
    expect(body.totales.ganancia).toBeNull()
    expect(body.margenPromedio).toBeNull()
  })

  it("VENDEDOR without opt-in — non-cost figures stay visible", async () => {
    mockRole("VENDEDOR")
    wire(false)

    const { body } = await parseResponse(await getRentabilidadTecnicos(tecnicosRequest()))

    expect(body.data[0].nombre).toBe("Ana Torres")
    expect(body.data[0].ordenes).toBe(1)
    expect(body.data[0].horasTrabajadas).toBe(2)
    expect(body.data[0].ingresos).toBe(1000)
    expect(body.data[0].costoManoObra).toBe(100)
    expect(body.totales.tecnicos).toBe(1)
    expect(body.totales.ingresos).toBe(1000)
    expect(body.totales.horas).toBe(2)
  })

  // The rows are ranked by ganancia for a caller who can see it. Nulling the
  // number but keeping that order would still publish the ranking, and with
  // ingresos visible per row a ganancia ranking is a cost ranking.
  it("VENDEDOR without opt-in — rows are ordered by a visible key, not by ganancia", async () => {
    mockRole("VENDEDOR")
    mockSupabaseFrom({
      ordenes_servicio: createChainMock([
        // Lower ingresos, but far cheaper repuestos: ranks FIRST by ganancia
        // and SECOND by ingresos, so the two orderings disagree.
        {
          ...ordenes[0],
          id: "ord-2",
          tecnico_id: "tec-2",
          costo_final: "900",
          porcentaje_comision: "0",
          costo_mano_obra: "0",
          tecnico: { nombre: "Beto" },
          repuestos_orden: [{ cantidad: 1, precio_unitario: "10" }],
        },
        ordenes[0],
      ]),
      organizations: orgChain(false),
    })

    const { body } = await parseResponse(await getRentabilidadTecnicos(tecnicosRequest()))

    // Beto's ganancia is 890 vs Ana's 530, so a ganancia sort would put Beto
    // first. Ingresos put Ana (1000) first.
    expect(body.data.map((t: any) => t.nombre)).toEqual(["Ana Torres", "Beto"])
  })

  // costoRepuestos NO es sólo precio_compra: mezcla
  // items_cotizacion.costo_unitario, que gobierna canViewCotizacionCosts —
  // ADMIN-only a propósito y MÁS estricta que hasInventarioAccess. Dos costos
  // distintos alimentan un mismo número, así que hacen falta las dos llaves.
  //
  // No se parte el agregado en una cifra "sólo repuestos" para este rol: un
  // número de rentabilidad al que le falta parte del costo es peor que
  // ninguno, porque se lee como exacto.
  it("VENDEDOR with inventario opt-in — still stripped: quote costs need the ADMIN key", async () => {
    mockRole("VENDEDOR")
    wire(true)

    const { body } = await parseResponse(await getRentabilidadTecnicos(tecnicosRequest()))

    expect(body.data[0].costoRepuestos).toBeNull()
    expect(body.data[0].ganancia).toBeNull()
    expect(body.data[0].comision).toBeNull()
    expect(body.margenPromedio).toBeNull()
    // Lo que no es costo no se toca.
    expect(body.data[0].ingresos).toBe(1000)
    expect(body.data[0].costoManoObra).toBe(100)
  })

  it("ADMIN holds both keys — the cost closure is visible", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    wire(true)

    const { body } = await parseResponse(await getRentabilidadTecnicos(tecnicosRequest()))

    expect(body.data[0].costoRepuestos).toBe(300)
    expect(body.data[0].ganancia).toBe(530)
    expect(body.margenPromedio).toBe(53)
  })
})

describe("GET /api/reportes/rentabilidad — repuesto cost gated", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(hasPlanFeature).mockResolvedValue(true)
  })

  // costos = repuestos 300 + comision 70 + manoObra 100 = 470.
  // ganancia = 1000 - 470 = 530. margen = 53%.
  const ordenes = [
    {
      id: "ord-1",
      tipo_dispositivo: "CELULAR",
      costo_final: "1000",
      estado: "ENTREGADO",
      porcentaje_comision: "10",
      tecnico_id: "tec-1",
      costo_mano_obra: "100",
      repuestos_orden: [{ cantidad: 1, precio_unitario: "300" }],
      cotizaciones: [],
    },
  ]

  function wire(vendedoresAdministranInventario = false) {
    mockSupabaseFrom({
      ordenes_servicio: createChainMock(ordenes),
      organizations: orgChain(vendedoresAdministranInventario),
    })
  }

  it("ADMIN sees costos, ganancia and margen (no behavior change)", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    wire()

    const { status, body } = await parseResponse(await getRentabilidad())

    expect(status).toBe(200)
    expect(body.data[0].costos).toBe(470)
    expect(body.data[0].ganancia).toBe(530)
    expect(body.data[0].margen).toBe(53)
    expect(body.margenPromedio).toBe(53)
  })

  // A device type can hold a single order, and this fixture is that case:
  // costos minus the visible costoManoObra is the repuesto cost.
  it("VENDEDOR without inventario opt-in — costos and everything that inverts to it are stripped", async () => {
    mockRole("VENDEDOR")
    wire(false)

    const { status, body } = await parseResponse(await getRentabilidad())

    expect(status).toBe(200)
    expect(body.data[0].costos).toBeNull()
    expect(body.data[0].ganancia).toBeNull()
    expect(body.data[0].margen).toBeNull()
    expect(body.margenPromedio).toBeNull()
  })

  it("VENDEDOR without opt-in — non-cost figures stay visible", async () => {
    mockRole("VENDEDOR")
    wire(false)

    const { body } = await parseResponse(await getRentabilidad())

    expect(body.data[0].tipoDispositivo).toBe("CELULAR")
    expect(body.data[0].ingresos).toBe(1000)
    expect(body.data[0].cantidad).toBe(1)
    expect(body.data[0].costoManoObra).toBe(100)
  })

  it("VENDEDOR without opt-in — rows are ordered by a visible key, not by ganancia", async () => {
    mockRole("VENDEDOR")
    mockSupabaseFrom({
      ordenes_servicio: createChainMock([
        {
          ...ordenes[0],
          id: "ord-2",
          tipo_dispositivo: "TABLET",
          costo_final: "900",
          porcentaje_comision: "0",
          costo_mano_obra: "0",
          repuestos_orden: [{ cantidad: 1, precio_unitario: "10" }],
        },
        ordenes[0],
      ]),
      organizations: orgChain(false),
    })

    const { body } = await parseResponse(await getRentabilidad())

    // TABLET's ganancia is 890 vs CELULAR's 530; ingresos put CELULAR first.
    expect(body.data.map((d: any) => d.tipoDispositivo)).toEqual(["CELULAR", "TABLET"])
  })

  // Misma mezcla que rentabilidad-tecnicos: `costos` agrega
  // items_cotizacion.costo_unitario además de repuestos_orden, así que el
  // permiso de inventario solo no alcanza.
  it("VENDEDOR with inventario opt-in — still stripped: quote costs need the ADMIN key", async () => {
    mockRole("VENDEDOR")
    wire(true)

    const { body } = await parseResponse(await getRentabilidad())

    expect(body.data[0].costos).toBeNull()
    expect(body.data[0].ganancia).toBeNull()
    expect(body.margenPromedio).toBeNull()
    expect(body.data[0].ingresos).toBe(1000)
  })

  it("ADMIN holds both keys — the cost closure is visible", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    wire(true)

    const { body } = await parseResponse(await getRentabilidad())

    expect(body.data[0].costos).toBe(470)
    expect(body.data[0].ganancia).toBe(530)
  })

  // El early return de "sin órdenes" devolvía margenPromedio: 0 mientras el
  // camino con datos devuelve null para el rol gateado. Formas distintas para
  // el mismo campo es como el próximo lector arma una suposición equivocada.
  it("empty result keeps the same shape — margenPromedio is null, not 0", async () => {
    mockRole("VENDEDOR")
    mockSupabaseFrom({
      ordenes_servicio: createChainMock([]),
      organizations: orgChain(false),
    })

    const { status, body } = await parseResponse(await getRentabilidad())

    expect(status).toBe(200)
    expect(body.data).toEqual([])
    expect(body.margenPromedio).toBeNull()
  })
})

describe("GET /api/reportes/ventas-analytics — margen bruto cost gated", () => {
  beforeEach(() => vi.clearAllMocks())

  // totalVentas 400, totalCosto = 2 x 100 = 200, margen 200, porcentaje 50.
  const itemsVenta = [
    {
      descripcion: "Pantalla",
      cantidad: 2,
      subtotal: 400,
      precio_unitario: 200,
      inventario_id: "inv-1",
      venta_id: "venta-1",
      costo_unitario_snapshot: 100,
      inventario: { precio_compra: 120 },
      ventas: { organization_id: "org-1", estado: "COMPLETADA", created_at: new Date().toISOString(), vendedor_id: null, sucursal_id: null },
    },
  ]

  function wire(vendedoresAdministranInventario = false) {
    mockSupabaseFrom({
      ventas: createChainMock([]),
      items_venta: createChainMock(itemsVenta),
      organizations: orgChain(vendedoresAdministranInventario),
    })
  }

  it("ADMIN sees the gross margin block (no behavior change)", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    wire()

    const { status, body } = await parseResponse(await getVentasAnalytics())

    expect(status).toBe(200)
    expect(body.margenBruto.totalCosto).toBe(200)
    expect(body.margenBruto.margen).toBe(200)
    expect(body.margenBruto.porcentaje).toBe(50)
  })

  // Same shape as resumen.valorCompra, which this branch already gated: margen
  // is totalVentas - totalCosto and totalVentas ships beside it, so nulling
  // only totalCosto would leave the subtraction to give it back.
  it("VENDEDOR without inventario opt-in — totalCosto, margen and porcentaje stripped", async () => {
    mockRole("VENDEDOR")
    wire(false)

    const { status, body } = await parseResponse(await getVentasAnalytics())

    expect(status).toBe(200)
    expect(body.margenBruto.totalCosto).toBeNull()
    expect(body.margenBruto.margen).toBeNull()
    expect(body.margenBruto.porcentaje).toBeNull()
  })

  it("VENDEDOR without opt-in — sale revenue stays visible", async () => {
    mockRole("VENDEDOR")
    wire(false)

    const { body } = await parseResponse(await getVentasAnalytics())

    expect(body.margenBruto.totalVentas).toBe(400)
    expect(body.topProductos[0].descripcion).toBe("Pantalla")
  })

  it("VENDEDOR with inventario opt-in — the gross margin block is visible", async () => {
    mockRole("VENDEDOR")
    wire(true)

    const { body } = await parseResponse(await getVentasAnalytics())

    expect(body.margenBruto.totalCosto).toBe(200)
    expect(body.margenBruto.margen).toBe(200)
  })
})
