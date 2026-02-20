import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import {
  mockAuthSuccess,
  mockAuthError,
  createChainMock,
  mockSupabaseFrom,
  createGetRequest,
  parseResponse,
} from "./helpers"

// ─── Performance Técnicos ───

describe("GET /api/reportes/performance-tecnicos", () => {
  let GET: any

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import("@/app/api/reportes/performance-tecnicos/route")
    GET = mod.GET
  })

  it("returns 401 when not authenticated", async () => {
    mockAuthError()

    const response = await GET()
    const { status, body } = await parseResponse(response)

    expect(status).toBe(401)
    expect(body.error).toBe("No autorizado")
  })

  it("calculates performance metrics correctly", async () => {
    mockAuthSuccess()

    const mockTechnicians = [
      { id: "t1", nombre: "Pedro Tecnico" },
      { id: "t2", nombre: "Ana Tecnica" },
    ]

    const today = new Date()
    const mockOrders = [
      { tecnico_id: "t1", estado: "ENTREGADO", fecha_ingreso: today.toISOString(), fecha_completado: new Date(today.getTime() + 3 * 86400000).toISOString() },
      { tecnico_id: "t1", estado: "REPARADO", fecha_ingreso: today.toISOString(), fecha_completado: new Date(today.getTime() + 1 * 86400000).toISOString() },
      { tecnico_id: "t1", estado: "EN_REPARACION", fecha_ingreso: today.toISOString(), fecha_completado: null },
      { tecnico_id: "t2", estado: "RECIBIDO", fecha_ingreso: today.toISOString(), fecha_completado: null },
    ]

    const usersChain = createChainMock(mockTechnicians)
    usersChain.then = (resolve: any) => resolve({ data: mockTechnicians, error: null })

    const ordenesChain = createChainMock(mockOrders)
    ordenesChain.then = (resolve: any) => resolve({ data: mockOrders, error: null })

    mockSupabaseFrom({ users: usersChain, ordenes_servicio: ordenesChain })

    const response = await GET()
    const { status, body } = await parseResponse(response)

    expect(status).toBe(200)
    expect(body.tecnicos).toHaveLength(2)

    const pedro = body.tecnicos.find((t: any) => t.nombre === "Pedro Tecnico")
    expect(pedro.ordenesCompletadas).toBe(2)
    expect(pedro.ordenesEnProceso).toBe(1)
    expect(pedro.tasaCompletado).toBe(67)

    const ana = body.tecnicos.find((t: any) => t.nombre === "Ana Tecnica")
    expect(ana.ordenesCompletadas).toBe(0)
    expect(ana.ordenesEnProceso).toBe(1)
    expect(ana.tasaCompletado).toBe(0)

    expect(body.totales.totalOrdenes).toBe(4)
    expect(body.totales.totalCompletadas).toBe(2)
    expect(body.totales.totalEnProceso).toBe(2)
  })

  it("handles no technicians gracefully", async () => {
    mockAuthSuccess()

    const usersChain = createChainMock([])
    usersChain.then = (resolve: any) => resolve({ data: [], error: null })

    const ordenesChain = createChainMock([])
    ordenesChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({ users: usersChain, ordenes_servicio: ordenesChain })

    const response = await GET()
    const { status, body } = await parseResponse(response)

    expect(status).toBe(200)
    expect(body.tecnicos).toHaveLength(0)
    expect(body.totales.totalOrdenes).toBe(0)
  })
})

// ─── Top Clientes ───

describe("GET /api/reportes/top-clientes", () => {
  let GET: any

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import("@/app/api/reportes/top-clientes/route")
    GET = mod.GET
  })

  it("returns 401 when not authenticated", async () => {
    mockAuthError()

    const req = new NextRequest("http://localhost:3000/api/reportes/top-clientes")
    const response = await GET(req)
    const { status } = await parseResponse(response)

    expect(status).toBe(401)
  })

  it("returns top clients sorted by orders", async () => {
    mockAuthSuccess()

    const mockClientes = [
      { id: "c1", nombre: "Cliente A", telefono: "111", email: "a@test.com" },
      { id: "c2", nombre: "Cliente B", telefono: "222", email: "b@test.com" },
    ]

    const mockOrdenes = [
      { id: "o1", cliente_id: "c1", fecha_ingreso: "2024-01-01", facturas: [{ total: 5000, estado_pago: "PAGADO" }] },
      { id: "o2", cliente_id: "c1", fecha_ingreso: "2024-02-01", facturas: [{ total: 3000, estado_pago: "PAGADO" }] },
      { id: "o3", cliente_id: "c2", fecha_ingreso: "2024-03-01", facturas: [] },
    ]

    const clientesChain = createChainMock(mockClientes)
    clientesChain.then = (resolve: any) => resolve({ data: mockClientes, error: null })

    const ordenesChain = createChainMock(mockOrdenes)
    ordenesChain.then = (resolve: any) => resolve({ data: mockOrdenes, error: null })

    mockSupabaseFrom({ clientes: clientesChain, ordenes_servicio: ordenesChain })

    const req = new NextRequest("http://localhost:3000/api/reportes/top-clientes?tipo=ordenes")
    const response = await GET(req)
    const { status, body } = await parseResponse(response)

    expect(status).toBe(200)
    expect(body.clientes).toHaveLength(2)
    expect(body.clientes[0].nombre).toBe("Cliente A")
    expect(body.clientes[0].totalOrdenes).toBe(2)
    expect(body.clientes[0].totalGastado).toBe(8000)
    expect(body.estadisticas.totalClientes).toBe(2)
  })

  it("sorts by monto when tipo=monto", async () => {
    mockAuthSuccess()

    const mockClientes = [
      { id: "c1", nombre: "Cliente Pobre", telefono: "111", email: null },
      { id: "c2", nombre: "Cliente Rico", telefono: "222", email: null },
    ]

    const mockOrdenes = [
      { id: "o1", cliente_id: "c1", fecha_ingreso: "2024-01-01", facturas: [{ total: 1000, estado_pago: "PAGADO" }] },
      { id: "o2", cliente_id: "c1", fecha_ingreso: "2024-02-01", facturas: [{ total: 1000, estado_pago: "PAGADO" }] },
      { id: "o3", cliente_id: "c2", fecha_ingreso: "2024-03-01", facturas: [{ total: 50000, estado_pago: "PAGADO" }] },
    ]

    const clientesChain = createChainMock(mockClientes)
    clientesChain.then = (resolve: any) => resolve({ data: mockClientes, error: null })

    const ordenesChain = createChainMock(mockOrdenes)
    ordenesChain.then = (resolve: any) => resolve({ data: mockOrdenes, error: null })

    mockSupabaseFrom({ clientes: clientesChain, ordenes_servicio: ordenesChain })

    const req = new NextRequest("http://localhost:3000/api/reportes/top-clientes?tipo=monto")
    const response = await GET(req)
    const { status, body } = await parseResponse(response)

    expect(status).toBe(200)
    expect(body.clientes[0].nombre).toBe("Cliente Rico")
    expect(body.clientes[0].totalGastado).toBe(50000)
    expect(body.ordenadoPor).toBe("monto")
  })
})

// ─── Resumen Ingresos ───

describe("GET /api/reportes/resumen-ingresos", () => {
  let GET: any

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import("@/app/api/reportes/resumen-ingresos/route")
    GET = mod.GET
  })

  it("returns 401 when not authenticated", async () => {
    mockAuthError()

    const response = await GET(createGetRequest("http://localhost:3000/api/reportes/resumen-ingresos"))
    const { status } = await parseResponse(response)

    expect(status).toBe(401)
  })

  it("aggregates income from facturas and ventas", async () => {
    mockAuthSuccess()

    const now = new Date()

    const mockFacturas = [
      { id: "f1", total: 5000, fecha: now.toISOString(), ordenes_servicio: { id: "o1", organization_id: "org-1", tipo_dispositivo: "CELULAR", dispositivo: "iPhone" } },
      { id: "f2", total: 3000, fecha: now.toISOString(), ordenes_servicio: { id: "o2", organization_id: "org-1", tipo_dispositivo: "COMPUTADORA", dispositivo: "MacBook" } },
    ]

    const mockVentas = [
      { id: "v1", total: 2000, created_at: now.toISOString() },
    ]

    const facturasChain = createChainMock(mockFacturas)
    facturasChain.then = (resolve: any) => resolve({ data: mockFacturas, error: null })

    const ventasChain = createChainMock(mockVentas)
    ventasChain.then = (resolve: any) => resolve({ data: mockVentas, error: null })

    mockSupabaseFrom({ facturas: facturasChain, ventas: ventasChain })

    const response = await GET(createGetRequest("http://localhost:3000/api/reportes/resumen-ingresos?meses=6"))
    const { status, body } = await parseResponse(response)

    expect(status).toBe(200)
    expect(body.resumen.totalServicios).toBe(8000)
    expect(body.resumen.totalVentas).toBe(2000)
    expect(body.resumen.totalIngresos).toBe(10000)
    expect(body.resumen.cantidadServicios).toBe(2)
    expect(body.resumen.cantidadVentas).toBe(1)
    expect(body.porMes).toBeInstanceOf(Array)
    expect(body.porDispositivo).toHaveLength(2)
    expect(body.periodo.meses).toBe(6)
  })

  it("returns empty data when no income exists", async () => {
    mockAuthSuccess()

    const facturasChain = createChainMock([])
    facturasChain.then = (resolve: any) => resolve({ data: [], error: null })

    const ventasChain = createChainMock([])
    ventasChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({ facturas: facturasChain, ventas: ventasChain })

    const response = await GET(createGetRequest("http://localhost:3000/api/reportes/resumen-ingresos"))
    const { status, body } = await parseResponse(response)

    expect(status).toBe(200)
    expect(body.resumen.totalIngresos).toBe(0)
    expect(body.resumen.totalServicios).toBe(0)
    expect(body.resumen.totalVentas).toBe(0)
    expect(body.porDispositivo).toHaveLength(0)
  })
})
