/**
 * TDD — KPI minor correctness fixes (BUG-7, BUG-8, BUG-9)
 *
 * BUG-7: performance-tecnicos global promedioTiempo must be volume-weighted
 *         (weighted mean over all orders, not mean of per-tech averages)
 * BUG-8: ventas-analytics promedioDescuento must be avg discount amount per sale
 *         (totalDescuentos / ventasCount), not (totalDescuentos / totalRevenue) * 100
 * BUG-9: fallas-comunes ordenes query must exclude CANCELADO from denominator
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  mockSupabaseFrom,
  createChainMock,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn().mockResolvedValue(true),
}))

import { hasPlanFeature } from "@/lib/subscriptions"
import { supabaseAdmin } from "@/lib/supabase"

// ─── BUG-7: performance-tecnicos global promedioTiempo is volume-weighted ─────

describe("BUG-7 — GET /api/reportes/performance-tecnicos global promedioTiempo is volume-weighted", () => {
  let GET: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    const mod = await import("@/app/api/reportes/performance-tecnicos/route")
    GET = mod.GET
  })

  it("Tech A (1 order, 1 day) + Tech B (3 orders, 3 days each) → global promedioTiempo = 2.5, NOT 2", async () => {
    mockAuthSuccess()

    const mockTechnicians = [
      { id: "tA", nombre: "Tech A" },
      { id: "tB", nombre: "Tech B" },
    ]

    const now = new Date("2024-03-15T12:00:00Z")

    const dayMs = 86400000

    // Tech A: 1 order, duration = 1 day
    // Tech B: 3 orders, duration = 3 days each
    // True mean = (1 + 3 + 3 + 3) / 4 = 10/4 = 2.5
    // Wrong mean = (1 + 3) / 2 = 2 (mean of averages, unweighted)
    const mockOrders = [
      {
        tecnico_id: "tA",
        estado: "ENTREGADO",
        fecha_ingreso: new Date(now.getTime() - 1 * dayMs).toISOString(),
        fecha_completado: now.toISOString(),
      },
      {
        tecnico_id: "tB",
        estado: "ENTREGADO",
        fecha_ingreso: new Date(now.getTime() - 3 * dayMs).toISOString(),
        fecha_completado: now.toISOString(),
      },
      {
        tecnico_id: "tB",
        estado: "ENTREGADO",
        fecha_ingreso: new Date(now.getTime() - 3 * dayMs).toISOString(),
        fecha_completado: now.toISOString(),
      },
      {
        tecnico_id: "tB",
        estado: "ENTREGADO",
        fecha_ingreso: new Date(now.getTime() - 3 * dayMs).toISOString(),
        fecha_completado: now.toISOString(),
      },
    ]

    const usersChain = createChainMock(mockTechnicians)
    usersChain.then = (resolve: any) => resolve({ data: mockTechnicians, error: null })

    const ordenesChain = createChainMock(mockOrders)
    ordenesChain.then = (resolve: any) => resolve({ data: mockOrders, error: null })

    mockSupabaseFrom({ users: usersChain, ordenes_servicio: ordenesChain })

    const response = await GET()
    const { status, body } = await parseResponse(response)

    expect(status).toBe(200)

    // Volume-weighted global mean must be 2.5 (not 2)
    // The route rounds to 1 decimal: Math.round(2.5 * 10) / 10 = 2.5
    expect(body.totales.promedioTiempo).toBeCloseTo(2.5, 1)

    // Confirm per-tech averages are still correct and unchanged
    const techA = body.tecnicos.find((t: any) => t.tecnicoId === "tA")
    const techB = body.tecnicos.find((t: any) => t.tecnicoId === "tB")
    expect(techA.tiempoPromedioReparacion).toBeCloseTo(1, 1)
    expect(techB.tiempoPromedioReparacion).toBeCloseTo(3, 1)
  })

  it("single tech with 2 orders (1 day, 3 days) → global promedioTiempo = 2 (simple mean = weighted mean)", async () => {
    mockAuthSuccess()

    const mockTechnicians = [{ id: "tA", nombre: "Tech A" }]
    const now = new Date("2024-03-15T12:00:00Z")
    const dayMs = 86400000

    const mockOrders = [
      {
        tecnico_id: "tA",
        estado: "ENTREGADO",
        fecha_ingreso: new Date(now.getTime() - 1 * dayMs).toISOString(),
        fecha_completado: now.toISOString(),
      },
      {
        tecnico_id: "tA",
        estado: "ENTREGADO",
        fecha_ingreso: new Date(now.getTime() - 3 * dayMs).toISOString(),
        fecha_completado: now.toISOString(),
      },
    ]

    const usersChain = createChainMock(mockTechnicians)
    usersChain.then = (resolve: any) => resolve({ data: mockTechnicians, error: null })

    const ordenesChain = createChainMock(mockOrders)
    ordenesChain.then = (resolve: any) => resolve({ data: mockOrders, error: null })

    mockSupabaseFrom({ users: usersChain, ordenes_servicio: ordenesChain })

    const response = await GET()
    const { status, body } = await parseResponse(response)

    expect(status).toBe(200)
    expect(body.totales.promedioTiempo).toBeCloseTo(2, 1)
  })
})

// ─── BUG-8: ventas-analytics promedioDescuento is avg discount per sale ───────

describe("BUG-8 — GET /api/reportes/ventas-analytics promedioDescuento = totalDescuentos / ventasCount", () => {
  let GET: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    const mod = await import("@/app/api/reportes/ventas-analytics/route")
    GET = mod.GET
  })

  it("3 completed sales with total discounts 300 → promedioDescuento = 100 (NOT a revenue %)", async () => {
    mockAuthSuccess()

    // 3 sales, each with descuento=100, total=1000 → totalDescuentos=300, totalRevenue=3000
    // Correct: 300 / 3 = 100 (avg discount amount per sale)
    // Wrong:   (300 / 3000) * 100 = 10 (% of revenue — this is NOT a "promedio")
    const ventasData = [
      {
        id: "v1",
        total: 1000,
        descuento: 100,
        tipo_descuento: "MONTO",
        porcentaje_descuento: null,
        estado: "COMPLETADA",
        metodo_pago: "EFECTIVO",
        vendedor_id: null,
        created_at: new Date().toISOString(),
        monto_abonado: 900,
        estado_pago: "PAGADO",
      },
      {
        id: "v2",
        total: 1000,
        descuento: 100,
        tipo_descuento: "MONTO",
        porcentaje_descuento: null,
        estado: "COMPLETADA",
        metodo_pago: "EFECTIVO",
        vendedor_id: null,
        created_at: new Date().toISOString(),
        monto_abonado: 900,
        estado_pago: "PAGADO",
      },
      {
        id: "v3",
        total: 1000,
        descuento: 100,
        tipo_descuento: "MONTO",
        porcentaje_descuento: null,
        estado: "COMPLETADA",
        metodo_pago: "EFECTIVO",
        vendedor_id: null,
        created_at: new Date().toISOString(),
        monto_abonado: 900,
        estado_pago: "PAGADO",
      },
    ]

    const ventasChain = createChainMock(ventasData)
    const itemsChain = createChainMock([])
    const margenChain = createChainMock([])
    const usersChain = createChainMock([])

    let itemsVentaCallCount = 0
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ventas") return ventasChain as any
      if (table === "items_venta") {
        itemsVentaCallCount++
        return itemsVentaCallCount === 1 ? itemsChain as any : margenChain as any
      }
      if (table === "users") return usersChain as any
      return createChainMock(null, { message: `No mock for table: ${table}` }) as any
    })

    const response = await GET()
    const { status, body } = await parseResponse(response)

    expect(status).toBe(200)
    // 300 total discounts / 3 sales = 100 average discount amount
    expect(body.descuentosOtorgados.promedioDescuento).toBe(100)
  })

  it("zero sales → promedioDescuento = 0 (no divide-by-zero)", async () => {
    mockAuthSuccess()

    const ventasChain = createChainMock([])
    const itemsChain = createChainMock([])
    const margenChain = createChainMock([])
    const usersChain = createChainMock([])

    let itemsVentaCallCount = 0
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ventas") return ventasChain as any
      if (table === "items_venta") {
        itemsVentaCallCount++
        return itemsVentaCallCount === 1 ? itemsChain as any : margenChain as any
      }
      if (table === "users") return usersChain as any
      return createChainMock(null, { message: `No mock for table: ${table}` }) as any
    })

    const response = await GET()
    const { status, body } = await parseResponse(response)

    expect(status).toBe(200)
    expect(body.descuentosOtorgados.promedioDescuento).toBe(0)
  })
})

// ─── BUG-9: fallas-comunes excludes CANCELADO from ordenes query ──────────────

describe("BUG-9 — GET /api/reportes/fallas-comunes excludes CANCELADO from ordenes query", () => {
  let GET: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.mocked(hasPlanFeature).mockResolvedValue(true)
    const mod = await import("@/app/api/reportes/fallas-comunes/route")
    GET = mod.GET
  })

  it("ordenes query chain receives .neq('estado', 'CANCELADO')", async () => {
    mockAuthSuccess()

    const mockOrdenes = [
      { problema_reportado: "Pantalla rota", diagnostico: null, tipo_dispositivo: "celular" },
    ]

    const ordenesChain = createChainMock(mockOrdenes)
    ordenesChain.then = (resolve: any) => resolve({ data: mockOrdenes, error: null })

    mockSupabaseFrom({ ordenes_servicio: ordenesChain })

    const request = new Request("http://localhost:3000/api/reportes/fallas-comunes")
    await GET(request)

    // The query chain must have called .neq("estado", "CANCELADO")
    expect(ordenesChain.neq).toHaveBeenCalledWith("estado", "CANCELADO")
  })

  it("denominator reflects only non-cancelled orders → percentage is correct", async () => {
    mockAuthSuccess()

    // After CANCELADO filter: 2 real orders, both with "pantalla rota"
    // → pantalla rota count = 2, porcentaje = round(2/2 * 100) = 100
    const mockOrdenes = [
      { problema_reportado: "Pantalla rota", diagnostico: null, tipo_dispositivo: "celular" },
      { problema_reportado: "pantalla estrellada", diagnostico: null, tipo_dispositivo: "celular" },
    ]

    const ordenesChain = createChainMock(mockOrdenes)
    ordenesChain.then = (resolve: any) => resolve({ data: mockOrdenes, error: null })

    mockSupabaseFrom({ ordenes_servicio: ordenesChain })

    const request = new Request("http://localhost:3000/api/reportes/fallas-comunes")
    const response = await GET(request)
    const { status, body } = await parseResponse(response)

    expect(status).toBe(200)
    // Both orders match "Pantalla rota" pattern → 100%
    const pantallaRota = body.data.find((d: any) => d.falla === "Pantalla rota")
    expect(pantallaRota).toBeDefined()
    expect(pantallaRota.porcentaje).toBe(100)
    // total is based only on non-cancelled (2)
    expect(body.total).toBe(2)
  })
})
