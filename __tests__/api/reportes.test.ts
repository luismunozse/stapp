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
      { id: "f1", total: 5000, fecha: now.toISOString(), orden_id: "o1", ordenes_servicio: { id: "o1", organization_id: "org-1", tipo_dispositivo: "CELULAR", dispositivo: "iPhone", tipos_dispositivo: null } },
      { id: "f2", total: 3000, fecha: now.toISOString(), orden_id: "o2", ordenes_servicio: { id: "o2", organization_id: "org-1", tipo_dispositivo: "COMPUTADORA", dispositivo: "MacBook", tipos_dispositivo: null } },
    ]

    const mockVentas = [
      { id: "v1", total: 2000, created_at: now.toISOString() },
    ]

    const facturasChain = createChainMock(mockFacturas)
    facturasChain.then = (resolve: any) => resolve({ data: mockFacturas, error: null })

    const ventasChain = createChainMock(mockVentas)
    ventasChain.then = (resolve: any) => resolve({ data: mockVentas, error: null })

    const cobrosChain = createChainMock([])
    cobrosChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({ facturas: facturasChain, ventas: ventasChain, cobros_orden: cobrosChain })

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

    const cobrosChain = createChainMock([])
    cobrosChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({ facturas: facturasChain, ventas: ventasChain, cobros_orden: cobrosChain })

    const response = await GET(createGetRequest("http://localhost:3000/api/reportes/resumen-ingresos"))
    const { status, body } = await parseResponse(response)

    expect(status).toBe(200)
    expect(body.resumen.totalIngresos).toBe(0)
    expect(body.resumen.totalServicios).toBe(0)
    expect(body.resumen.totalVentas).toBe(0)
    expect(body.porDispositivo).toHaveLength(0)
  })

  it("breaks down income per month by payment method", async () => {
    mockAuthSuccess()

    const now = new Date()
    const mesKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`

    // Factura sin cobro directo → sin método → bucket SIN_ESPECIFICAR (net = subtotal)
    const mockFacturas = [
      { id: "f1", total: 6050, subtotal: 5000, iva: 1050, fecha: now.toISOString(), orden_id: "o1", ordenes_servicio: { id: "o1", organization_id: "org-1", tipo_dispositivo: "CELULAR", dispositivo: "iPhone", tipos_dispositivo: null } },
    ]

    // Ventas con método (net = iva_neto)
    const mockVentas = [
      { id: "v1", total: 2420, iva_neto: 2000, iva_monto: 420, metodo_pago: "EFECTIVO", created_at: now.toISOString() },
      { id: "v2", total: 3630, iva_neto: 3000, iva_monto: 630, metodo_pago: "TRANSFERENCIA", created_at: now.toISOString() },
    ]

    // Cobro directo a orden con método (gross = monto)
    const mockCobros = [
      { id: "c1", monto: 1500, metodo_pago: "TARJETA_CREDITO", created_at: now.toISOString(), orden_id: "o9", ordenes_servicio: { organization_id: "org-1", tipo_dispositivo: "CELULAR", dispositivo: "Samsung", tipos_dispositivo: null } },
      { id: "c2", monto: 500, metodo_pago: "EFECTIVO", created_at: now.toISOString(), orden_id: "o10", ordenes_servicio: { organization_id: "org-1", tipo_dispositivo: "CELULAR", dispositivo: "Motorola", tipos_dispositivo: null } },
    ]

    const facturasChain = createChainMock(mockFacturas)
    facturasChain.then = (resolve: any) => resolve({ data: mockFacturas, error: null })

    const ventasChain = createChainMock(mockVentas)
    ventasChain.then = (resolve: any) => resolve({ data: mockVentas, error: null })

    const cobrosChain = createChainMock(mockCobros)
    cobrosChain.then = (resolve: any) => resolve({ data: mockCobros, error: null })

    mockSupabaseFrom({ facturas: facturasChain, ventas: ventasChain, cobros_orden: cobrosChain })

    const response = await GET(createGetRequest("http://localhost:3000/api/reportes/resumen-ingresos?meses=6"))
    const { status, body } = await parseResponse(response)

    expect(status).toBe(200)
    expect(body.porMetodoPago).toBeInstanceOf(Array)

    const mesActual = body.porMetodoPago.find((m: any) => m.mesKey === mesKey)
    expect(mesActual).toBeDefined()
    // 5000 (factura) + 2000 + 3000 (ventas) + 1500 + 500 (cobros) = 12000
    expect(mesActual.total).toBe(12000)

    const byMetodo = Object.fromEntries(
      mesActual.metodos.map((m: any) => [m.metodo, m.monto])
    )
    expect(byMetodo.EFECTIVO).toBe(2500) // 2000 venta + 500 cobro
    expect(byMetodo.TRANSFERENCIA).toBe(3000)
    expect(byMetodo.TARJETA_CREDITO).toBe(1500)
    expect(byMetodo.SIN_ESPECIFICAR).toBe(5000) // factura sin pagos_parciales → fallback
  })

  it("prorates factura NET income across payment methods from pagos_parciales", async () => {
    mockAuthSuccess()

    const now = new Date()
    const mesKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`

    // Factura PAGADA: neto 5000, total bruto 6050 (IVA 1050).
    // Pagos: 60% efectivo (3630) / 40% transferencia (2420) sobre el bruto.
    // El neto (5000) debe repartirse en la MISMA proporción: 3000 / 2000.
    const mockFacturas = [
      {
        id: "f1", total: 6050, subtotal: 5000, iva: 1050, fecha: now.toISOString(), orden_id: "o1",
        ordenes_servicio: { id: "o1", organization_id: "org-1", tipo_dispositivo: "CELULAR", dispositivo: "iPhone", tipos_dispositivo: null },
        pagos_parciales: [
          { monto: 3630, metodo_pago: "EFECTIVO" },
          { monto: 2420, metodo_pago: "TRANSFERENCIA" },
        ],
      },
    ]

    const facturasChain = createChainMock(mockFacturas)
    facturasChain.then = (resolve: any) => resolve({ data: mockFacturas, error: null })

    const ventasChain = createChainMock([])
    ventasChain.then = (resolve: any) => resolve({ data: [], error: null })

    const cobrosChain = createChainMock([])
    cobrosChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({ facturas: facturasChain, ventas: ventasChain, cobros_orden: cobrosChain })

    const response = await GET(createGetRequest("http://localhost:3000/api/reportes/resumen-ingresos?meses=6"))
    const { status, body } = await parseResponse(response)

    expect(status).toBe(200)
    const mesActual = body.porMetodoPago.find((m: any) => m.mesKey === mesKey)
    expect(mesActual.total).toBe(5000) // neto, no bruto
    const byMetodo = Object.fromEntries(mesActual.metodos.map((m: any) => [m.metodo, m.monto]))
    expect(byMetodo.EFECTIVO).toBe(3000)
    expect(byMetodo.TRANSFERENCIA).toBe(2000)
    expect(byMetodo.SIN_ESPECIFICAR).toBeUndefined()
  })

  it("respects an explicit desde/hasta range and buckets by month across it", async () => {
    mockAuthSuccess()

    // Rango de 2 meses: mayo y junio 2026
    const mockVentas = [
      { id: "v1", total: 1210, iva_neto: 1000, iva_monto: 210, metodo_pago: "EFECTIVO", created_at: "2026-05-15T12:00:00.000Z" },
      { id: "v2", total: 2420, iva_neto: 2000, iva_monto: 420, metodo_pago: "TRANSFERENCIA", created_at: "2026-06-15T12:00:00.000Z" },
    ]

    const facturasChain = createChainMock([])
    facturasChain.then = (resolve: any) => resolve({ data: [], error: null })
    const ventasChain = createChainMock(mockVentas)
    ventasChain.then = (resolve: any) => resolve({ data: mockVentas, error: null })
    const cobrosChain = createChainMock([])
    cobrosChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({ facturas: facturasChain, ventas: ventasChain, cobros_orden: cobrosChain })

    const response = await GET(
      createGetRequest("http://localhost:3000/api/reportes/resumen-ingresos?desde=2026-05-01&hasta=2026-06-30")
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(200)
    expect(body.periodo.meses).toBe(2)
    expect(body.porMes).toHaveLength(2)

    const mayo = body.porMetodoPago.find((m: any) => m.mesKey === "2026-05")
    const junio = body.porMetodoPago.find((m: any) => m.mesKey === "2026-06")
    expect(mayo.total).toBe(1000)
    expect(junio.total).toBe(2000)
    expect(mayo.metodos[0]).toEqual({ metodo: "EFECTIVO", monto: 1000 })
    expect(junio.metodos[0]).toEqual({ metodo: "TRANSFERENCIA", monto: 2000 })
  })
})
