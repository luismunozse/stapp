/**
 * TDD — KPI correctness fixes (BUG-2, BUG-3, BUG-4, BUG-5)
 *
 * BUG-2: top-clientes must exclude CANCELADO from totalOrdenes
 * BUG-3: tasa-retorno must exclude CANCELADO from recurring-client count
 * BUG-4: performance-tecnicos tasaCompletado must:
 *         - exclude CANCELADO from denominator
 *         - include ENTREGADO_SIN_REPARACION in numerator
 * BUG-5: ventas-analytics margin must prefer costo_unitario_snapshot over precio_compra
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import {
  mockAuthSuccess,
  mockSupabaseFrom,
  createChainMock,
  createGetRequest,
  parseResponse,
} from "./helpers"

// Mock subscriptions at module level so hasPlanFeature is controllable
vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn().mockResolvedValue(true),
}))

import { hasPlanFeature } from "@/lib/subscriptions"

// ─── BUG-2: top-clientes excludes CANCELADO from totalOrdenes ───────────────

describe("BUG-2 — GET /api/reportes/top-clientes excludes CANCELADO from totalOrdenes", () => {
  let GET: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    const mod = await import("@/app/api/reportes/top-clientes/route")
    GET = mod.GET
  })

  it("ordenes query chain receives .neq('estado', 'CANCELADO')", async () => {
    mockAuthSuccess()

    const mockClientes = [
      { id: "c1", nombre: "Cliente A", telefono: "111", email: "a@test.com" },
    ]

    // Real orders only (no CANCELADO here — cancelled ones must be excluded by the query)
    const mockOrdenes = [
      { id: "o1", cliente_id: "c1", fecha_ingreso: "2024-01-01", facturas: [{ total: 5000, estado_pago: "PAGADO" }] },
      { id: "o2", cliente_id: "c1", fecha_ingreso: "2024-02-01", facturas: [] },
    ]

    const clientesChain = createChainMock(mockClientes)
    clientesChain.then = (resolve: any) => resolve({ data: mockClientes, error: null })

    const ordenesChain = createChainMock(mockOrdenes)
    ordenesChain.then = (resolve: any) => resolve({ data: mockOrdenes, error: null })

    mockSupabaseFrom({ clientes: clientesChain, ordenes_servicio: ordenesChain })

    const req = new NextRequest("http://localhost:3000/api/reportes/top-clientes?tipo=ordenes")
    await GET(req)

    // The ordenes query chain must have called .neq("estado", "CANCELADO")
    expect(ordenesChain.neq).toHaveBeenCalledWith("estado", "CANCELADO")
  })

  it("CANCELADO orders are not counted in totalOrdenes", async () => {
    mockAuthSuccess()

    const mockClientes = [
      { id: "c1", nombre: "Cliente A", telefono: "111", email: "a@test.com" },
    ]

    // Simulate that the DB already filtered out CANCELADO (the query filter did its job)
    // so we only receive the non-cancelled orders in the response
    const realOrders = [
      { id: "o1", cliente_id: "c1", fecha_ingreso: "2024-01-01", facturas: [{ total: 5000, estado_pago: "PAGADO" }] },
    ]

    const clientesChain = createChainMock(mockClientes)
    clientesChain.then = (resolve: any) => resolve({ data: mockClientes, error: null })

    const ordenesChain = createChainMock(realOrders)
    ordenesChain.then = (resolve: any) => resolve({ data: realOrders, error: null })

    mockSupabaseFrom({ clientes: clientesChain, ordenes_servicio: ordenesChain })

    const req = new NextRequest("http://localhost:3000/api/reportes/top-clientes?tipo=ordenes")
    const response = await GET(req)
    const { status, body } = await parseResponse(response)

    expect(status).toBe(200)
    expect(body.clientes[0].totalOrdenes).toBe(1)
  })
})

// ─── BUG-3: tasa-retorno excludes CANCELADO ─────────────────────────────────

describe("BUG-3 — GET /api/reportes/tasa-retorno excludes CANCELADO from return rate", () => {
  let GET: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    const mod = await import("@/app/api/reportes/tasa-retorno/route")
    GET = mod.GET
  })

  it("ordenes query chain receives .neq('estado', 'CANCELADO')", async () => {
    mockAuthSuccess()
    vi.mocked(hasPlanFeature).mockResolvedValue(true)

    const mockClientes = [
      { id: "c1", nombre: "Cliente A", telefono: "111" },
      { id: "c2", nombre: "Cliente B", telefono: "222" },
    ]

    const mockOrdenes = [
      { cliente_id: "c1" },
      { cliente_id: "c1" },
    ]

    const clientesChain = createChainMock(mockClientes)
    clientesChain.then = (resolve: any) => resolve({ data: mockClientes, error: null })

    const ordenesChain = createChainMock(mockOrdenes)
    ordenesChain.then = (resolve: any) => resolve({ data: mockOrdenes, error: null })

    mockSupabaseFrom({ clientes: clientesChain, ordenes_servicio: ordenesChain })

    await GET()

    // The ordenes query chain must have called .neq("estado", "CANCELADO")
    expect(ordenesChain.neq).toHaveBeenCalledWith("estado", "CANCELADO")
  })

  it("clients with only CANCELADO orders are not counted as recurring", async () => {
    mockAuthSuccess()
    vi.mocked(hasPlanFeature).mockResolvedValue(true)

    const mockClientes = [
      { id: "c1", nombre: "Cliente A", telefono: "111" },
    ]

    // After the CANCELADO filter, this client only has 1 real order → not recurring
    const realOrdenes = [{ cliente_id: "c1" }]

    const clientesChain = createChainMock(mockClientes)
    clientesChain.then = (resolve: any) => resolve({ data: mockClientes, error: null })

    const ordenesChain = createChainMock(realOrdenes)
    ordenesChain.then = (resolve: any) => resolve({ data: realOrdenes, error: null })

    mockSupabaseFrom({ clientes: clientesChain, ordenes_servicio: ordenesChain })

    const response = await GET()
    const { status, body } = await parseResponse(response)

    expect(status).toBe(200)
    // 1 real order → not recurring → tasa = 0
    expect(body.clientesRecurrentes).toBe(0)
    expect(body.tasaRetorno).toBe(0)
  })
})

// ─── BUG-4: performance-tecnicos tasaCompletado fix ─────────────────────────

describe("BUG-4 — GET /api/reportes/performance-tecnicos tasaCompletado", () => {
  let GET: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    const mod = await import("@/app/api/reportes/performance-tecnicos/route")
    GET = mod.GET
  })

  it("tech with [REPARADO, ENTREGADO_SIN_REPARACION, CANCELADO] → tasaCompletado = 100", async () => {
    mockAuthSuccess()

    const mockTechnicians = [{ id: "t1", nombre: "Técnico Test" }]

    const today = new Date()
    const mockOrders = [
      // Numerator candidates (completed): REPARADO + ENTREGADO_SIN_REPARACION
      {
        tecnico_id: "t1",
        estado: "REPARADO",
        fecha_ingreso: today.toISOString(),
        fecha_completado: new Date(today.getTime() + 2 * 86400000).toISOString(),
      },
      {
        tecnico_id: "t1",
        estado: "ENTREGADO_SIN_REPARACION",
        fecha_ingreso: today.toISOString(),
        fecha_completado: new Date(today.getTime() + 1 * 86400000).toISOString(),
      },
      // CANCELADO → excluded from denominator
      {
        tecnico_id: "t1",
        estado: "CANCELADO",
        fecha_ingreso: today.toISOString(),
        fecha_completado: null,
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
    expect(body.tecnicos).toHaveLength(1)

    const tech = body.tecnicos[0]
    // 2 completed (REPARADO + ENTREGADO_SIN_REPARACION) / 2 non-cancelled = 100%
    expect(tech.tasaCompletado).toBe(100)
    expect(tech.ordenesCompletadas).toBe(2)
  })

  it("tech with [ENTREGADO, CANCELADO, CANCELADO] → tasaCompletado = 100 (1/1 non-cancelled)", async () => {
    mockAuthSuccess()

    const mockTechnicians = [{ id: "t1", nombre: "Técnico Test" }]
    const today = new Date()

    const mockOrders = [
      {
        tecnico_id: "t1",
        estado: "ENTREGADO",
        fecha_ingreso: today.toISOString(),
        fecha_completado: new Date(today.getTime() + 3 * 86400000).toISOString(),
      },
      {
        tecnico_id: "t1",
        estado: "CANCELADO",
        fecha_ingreso: today.toISOString(),
        fecha_completado: null,
      },
      {
        tecnico_id: "t1",
        estado: "CANCELADO",
        fecha_ingreso: today.toISOString(),
        fecha_completado: null,
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
    const tech = body.tecnicos[0]
    // 1 ENTREGADO / 1 non-cancelled = 100%
    expect(tech.tasaCompletado).toBe(100)
  })

  it("tech with only CANCELADO → tasaCompletado = 0 (no non-cancelled orders)", async () => {
    mockAuthSuccess()

    const mockTechnicians = [{ id: "t1", nombre: "Técnico Test" }]
    const today = new Date()

    const mockOrders = [
      {
        tecnico_id: "t1",
        estado: "CANCELADO",
        fecha_ingreso: today.toISOString(),
        fecha_completado: null,
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
    const tech = body.tecnicos[0]
    // No non-cancelled orders → tasaCompletado = 0
    expect(tech.tasaCompletado).toBe(0)
  })
})

// ─── BUG-5: ventas-analytics margin uses costo_unitario_snapshot ────────────

import { supabaseAdmin } from "@/lib/supabase"

describe("BUG-5 — GET /api/reportes/ventas-analytics uses costo_unitario_snapshot for margin", () => {
  let GET: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    const mod = await import("@/app/api/reportes/ventas-analytics/route")
    GET = mod.GET
  })

  it("uses costo_unitario_snapshot when present (snapshot=300, precio_compra=500 → cost=300)", async () => {
    mockAuthSuccess()

    const ventasChain = createChainMock([
      {
        id: "v1",
        total: 1000,
        descuento: 0,
        tipo_descuento: null,
        porcentaje_descuento: null,
        estado: "COMPLETADA",
        metodo_pago: "EFECTIVO",
        vendedor_id: null,
        created_at: new Date().toISOString(),
        monto_abonado: 1000,
        estado_pago: "PAGADO",
      },
    ])

    // itemsVentaMes (top products): empty
    const itemsChain = createChainMock([])

    // margenQuery: item with snapshot=300, precio_compra=500
    const margenChain = createChainMock([
      {
        cantidad: 1,
        precio_unitario: 1000,
        subtotal: 1000,
        inventario_id: "inv-1",
        costo_unitario_snapshot: 300,
        inventario: { precio_compra: 500 },
        ventas: { organization_id: "org-1", estado: "COMPLETADA", created_at: new Date().toISOString(), sucursal_id: null },
      },
    ])

    const usersChain = createChainMock([])

    // Both itemsVentaMes and margenQuery hit items_venta.
    // Differentiate by call order: 1st call = topProducts (empty), 2nd call = margin (with snapshot).
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
    // snapshot=300 must be used, not precio_compra=500 → totalCosto = 1 * 300 = 300
    expect(body.margenBruto.totalCosto).toBe(300)
    expect(body.margenBruto.totalVentas).toBe(1000)
    expect(body.margenBruto.margen).toBe(700)
  })

  it("falls back to precio_compra when costo_unitario_snapshot is null (legacy rows)", async () => {
    mockAuthSuccess()

    const ventasChain = createChainMock([
      {
        id: "v1",
        total: 1000,
        descuento: 0,
        tipo_descuento: null,
        porcentaje_descuento: null,
        estado: "COMPLETADA",
        metodo_pago: "EFECTIVO",
        vendedor_id: null,
        created_at: new Date().toISOString(),
        monto_abonado: 1000,
        estado_pago: "PAGADO",
      },
    ])

    const itemsChain = createChainMock([])

    // Legacy row: snapshot is null → must fall back to precio_compra=200
    const margenChain = createChainMock([
      {
        cantidad: 2,
        precio_unitario: 500,
        subtotal: 1000,
        inventario_id: "inv-1",
        costo_unitario_snapshot: null,
        inventario: { precio_compra: 200 },
        ventas: { organization_id: "org-1", estado: "COMPLETADA", created_at: new Date().toISOString(), sucursal_id: null },
      },
    ])

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
    // null snapshot → fallback precio_compra=200; totalCosto = 2 * 200 = 400
    expect(body.margenBruto.totalCosto).toBe(400)
  })
})
