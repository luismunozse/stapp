/**
 * Tests: PR1 — Branch filter on EASY report endpoints + inventory scope field
 *
 * Each EASY endpoint test covers 3 scenarios:
 *  (a) specific branch cookie → only that branch's rows returned
 *  (b) verTodas (cookie = "todas") → org-wide, no filter
 *  (c) no cookie → treated as verTodas (ADMIN default)
 *
 * Inventory tests assert scope: "organization" regardless of cookie.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, parseResponse, createGetRequest } from "./helpers"
import { cookies } from "next/headers"

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn(),
}))

import { hasPlanFeature } from "@/lib/subscriptions"

// Helper: configure the cookies mock for sucursal tests
function mockCookie(value: string | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn((name: string) => (name === "stapp-sucursal-activa" && value ? { value } : undefined)),
    set: vi.fn(),
  } as any)
}

// Rows for branch A and B
const BRANCH_A_ORDEN = { sucursal_id: "suc-A", tipo_dispositivo: "CELULAR", estado: "ENTREGADO", fecha_ingreso: "2024-01-10T00:00:00Z", fecha_completado: "2024-01-12T00:00:00Z", tecnico_id: "t1", costo_final: "5000", porcentaje_comision: "0", costo_mano_obra: "0", horas_trabajadas: "1", problema_reportado: "Pantalla rota", diagnostico: null, cliente_id: "c1", repuestos_orden: [], cotizaciones: [], tecnico: { nombre: "Tecnico A" } }
const BRANCH_B_ORDEN = { sucursal_id: "suc-B", tipo_dispositivo: "CELULAR", estado: "ENTREGADO", fecha_ingreso: "2024-01-10T00:00:00Z", fecha_completado: "2024-01-12T00:00:00Z", tecnico_id: "t2", costo_final: "3000", porcentaje_comision: "0", costo_mano_obra: "0", horas_trabajadas: "1", problema_reportado: "No enciende", diagnostico: null, cliente_id: "c2", repuestos_orden: [], cotizaciones: [], tecnico: { nombre: "Tecnico B" } }

// ─── performance-tecnicos ───────────────────────────────────────────────────

describe("GET /api/reportes/performance-tecnicos — branch filter", () => {
  let GET: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(hasPlanFeature).mockResolvedValue(true)
    const mod = await import("@/app/api/reportes/performance-tecnicos/route")
    GET = mod.GET
  })

  it("branch-A cookie → ordenes query is filtered by sucursal_id", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-A")

    const usersChain = createChainMock([{ id: "t1", nombre: "Tecnico A" }])
    usersChain.then = (resolve: any) => resolve({ data: [{ id: "t1", nombre: "Tecnico A" }], error: null })

    const ordenesChain = createChainMock([BRANCH_A_ORDEN])
    ordenesChain.then = (resolve: any) => resolve({ data: [BRANCH_A_ORDEN], error: null })

    mockSupabaseFrom({ users: usersChain, ordenes_servicio: ordenesChain })

    const response = await GET()
    const { status, body } = await parseResponse(response)

    expect(status).toBe(200)
    // The eq("sucursal_id", "suc-A") chain method must have been called
    expect(ordenesChain.eq).toHaveBeenCalledWith("sucursal_id", "suc-A")
  })

  it("verTodas cookie → no sucursal_id filter applied", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("todas")

    const usersChain = createChainMock([])
    usersChain.then = (resolve: any) => resolve({ data: [], error: null })

    const ordenesChain = createChainMock([BRANCH_A_ORDEN, BRANCH_B_ORDEN])
    ordenesChain.then = (resolve: any) => resolve({ data: [BRANCH_A_ORDEN, BRANCH_B_ORDEN], error: null })

    mockSupabaseFrom({ users: usersChain, ordenes_servicio: ordenesChain })

    const response = await GET()
    const { status } = await parseResponse(response)

    expect(status).toBe(200)
    const eqCalls = vi.mocked(ordenesChain.eq).mock.calls
    const sucursalFilter = eqCalls.find((c: any[]) => c[0] === "sucursal_id")
    expect(sucursalFilter).toBeUndefined()
  })

  it("no cookie → treated as verTodas (no sucursal_id filter)", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie(null)

    const usersChain = createChainMock([])
    usersChain.then = (resolve: any) => resolve({ data: [], error: null })

    const ordenesChain = createChainMock([BRANCH_A_ORDEN, BRANCH_B_ORDEN])
    ordenesChain.then = (resolve: any) => resolve({ data: [BRANCH_A_ORDEN, BRANCH_B_ORDEN], error: null })

    mockSupabaseFrom({ users: usersChain, ordenes_servicio: ordenesChain })

    const response = await GET()
    const { status } = await parseResponse(response)

    expect(status).toBe(200)
    const eqCalls = vi.mocked(ordenesChain.eq).mock.calls
    const sucursalFilter = eqCalls.find((c: any[]) => c[0] === "sucursal_id")
    expect(sucursalFilter).toBeUndefined()
  })
})

// ─── tiempo-reparacion ──────────────────────────────────────────────────────

describe("GET /api/reportes/tiempo-reparacion — branch filter", () => {
  let GET: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(hasPlanFeature).mockResolvedValue(true)
    const mod = await import("@/app/api/reportes/tiempo-reparacion/route")
    GET = mod.GET
  })

  it("branch-A cookie → ordenes filtered by sucursal_id", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-A")

    const ordenesChain = createChainMock([BRANCH_A_ORDEN])
    ordenesChain.then = (resolve: any) => resolve({ data: [BRANCH_A_ORDEN], error: null })

    mockSupabaseFrom({ ordenes_servicio: ordenesChain })

    const response = await GET(createGetRequest())
    const { status } = await parseResponse(response)

    expect(status).toBe(200)
    expect(ordenesChain.eq).toHaveBeenCalledWith("sucursal_id", "suc-A")
  })

  it("verTodas → no sucursal_id filter", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("todas")

    const ordenesChain = createChainMock([BRANCH_A_ORDEN, BRANCH_B_ORDEN])
    ordenesChain.then = (resolve: any) => resolve({ data: [BRANCH_A_ORDEN, BRANCH_B_ORDEN], error: null })

    mockSupabaseFrom({ ordenes_servicio: ordenesChain })

    await GET(createGetRequest())

    const eqCalls = vi.mocked(ordenesChain.eq).mock.calls
    expect(eqCalls.find((c: any[]) => c[0] === "sucursal_id")).toBeUndefined()
  })

  it("no cookie → no sucursal_id filter", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie(null)

    const ordenesChain = createChainMock([])
    ordenesChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({ ordenes_servicio: ordenesChain })

    const response = await GET(createGetRequest())
    const { status } = await parseResponse(response)

    expect(status).toBe(200)
    expect(vi.mocked(ordenesChain.eq).mock.calls.find((c: any[]) => c[0] === "sucursal_id")).toBeUndefined()
  })
})

// ─── fallas-comunes ─────────────────────────────────────────────────────────

describe("GET /api/reportes/fallas-comunes — branch filter", () => {
  let GET: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(hasPlanFeature).mockResolvedValue(true)
    const mod = await import("@/app/api/reportes/fallas-comunes/route")
    GET = mod.GET
  })

  it("branch-A cookie → ordenes filtered by sucursal_id", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-A")

    const ordenesChain = createChainMock([BRANCH_A_ORDEN])
    ordenesChain.then = (resolve: any) => resolve({ data: [BRANCH_A_ORDEN], error: null })

    mockSupabaseFrom({ ordenes_servicio: ordenesChain })

    const response = await GET(createGetRequest())
    const { status } = await parseResponse(response)

    expect(status).toBe(200)
    expect(ordenesChain.eq).toHaveBeenCalledWith("sucursal_id", "suc-A")
  })

  it("verTodas → no sucursal_id filter", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("todas")

    const ordenesChain = createChainMock([BRANCH_A_ORDEN, BRANCH_B_ORDEN])
    ordenesChain.then = (resolve: any) => resolve({ data: [BRANCH_A_ORDEN, BRANCH_B_ORDEN], error: null })

    mockSupabaseFrom({ ordenes_servicio: ordenesChain })

    await GET(createGetRequest())

    expect(vi.mocked(ordenesChain.eq).mock.calls.find((c: any[]) => c[0] === "sucursal_id")).toBeUndefined()
  })

  it("no cookie → no sucursal_id filter", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie(null)

    const ordenesChain = createChainMock([])
    ordenesChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({ ordenes_servicio: ordenesChain })

    await GET(createGetRequest())

    expect(vi.mocked(ordenesChain.eq).mock.calls.find((c: any[]) => c[0] === "sucursal_id")).toBeUndefined()
  })
})

// ─── tasa-retorno ────────────────────────────────────────────────────────────

describe("GET /api/reportes/tasa-retorno — branch filter", () => {
  let GET: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(hasPlanFeature).mockResolvedValue(true)
    const mod = await import("@/app/api/reportes/tasa-retorno/route")
    GET = mod.GET
  })

  it("branch-A cookie → ordenes filtered by sucursal_id", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-A")

    const clientesChain = createChainMock([{ id: "c1", nombre: "C1", telefono: "1" }])
    clientesChain.then = (resolve: any) => resolve({ data: [{ id: "c1", nombre: "C1", telefono: "1" }], error: null })

    const ordenesChain = createChainMock([BRANCH_A_ORDEN])
    ordenesChain.then = (resolve: any) => resolve({ data: [BRANCH_A_ORDEN], error: null })

    mockSupabaseFrom({ clientes: clientesChain, ordenes_servicio: ordenesChain })

    const response = await GET()
    const { status } = await parseResponse(response)

    expect(status).toBe(200)
    expect(ordenesChain.eq).toHaveBeenCalledWith("sucursal_id", "suc-A")
  })

  it("verTodas → no sucursal_id filter", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("todas")

    const clientesChain = createChainMock([])
    clientesChain.then = (resolve: any) => resolve({ data: [], error: null })

    const ordenesChain = createChainMock([])
    ordenesChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({ clientes: clientesChain, ordenes_servicio: ordenesChain })

    await GET()

    expect(vi.mocked(ordenesChain.eq).mock.calls.find((c: any[]) => c[0] === "sucursal_id")).toBeUndefined()
  })

  it("no cookie → no sucursal_id filter", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie(null)

    const clientesChain = createChainMock([])
    clientesChain.then = (resolve: any) => resolve({ data: [], error: null })

    const ordenesChain = createChainMock([])
    ordenesChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({ clientes: clientesChain, ordenes_servicio: ordenesChain })

    await GET()

    expect(vi.mocked(ordenesChain.eq).mock.calls.find((c: any[]) => c[0] === "sucursal_id")).toBeUndefined()
  })
})

// ─── rentabilidad ────────────────────────────────────────────────────────────

describe("GET /api/reportes/rentabilidad — branch filter", () => {
  let GET: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(hasPlanFeature).mockResolvedValue(true)
    const mod = await import("@/app/api/reportes/rentabilidad/route")
    GET = mod.GET
  })

  it("branch-A cookie → ordenes filtered by sucursal_id", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-A")

    const ordenesChain = createChainMock([BRANCH_A_ORDEN])
    ordenesChain.then = (resolve: any) => resolve({ data: [BRANCH_A_ORDEN], error: null })

    mockSupabaseFrom({ ordenes_servicio: ordenesChain })

    const response = await GET()
    const { status } = await parseResponse(response)

    expect(status).toBe(200)
    expect(ordenesChain.eq).toHaveBeenCalledWith("sucursal_id", "suc-A")
  })

  it("verTodas → no sucursal_id filter", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("todas")

    const ordenesChain = createChainMock([])
    ordenesChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({ ordenes_servicio: ordenesChain })

    await GET()

    expect(vi.mocked(ordenesChain.eq).mock.calls.find((c: any[]) => c[0] === "sucursal_id")).toBeUndefined()
  })

  it("no cookie → no sucursal_id filter", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie(null)

    const ordenesChain = createChainMock([])
    ordenesChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({ ordenes_servicio: ordenesChain })

    await GET()

    expect(vi.mocked(ordenesChain.eq).mock.calls.find((c: any[]) => c[0] === "sucursal_id")).toBeUndefined()
  })
})

// ─── rentabilidad-tecnicos ───────────────────────────────────────────────────

describe("GET /api/reportes/rentabilidad-tecnicos — branch filter", () => {
  let GET: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(hasPlanFeature).mockResolvedValue(true)
    const mod = await import("@/app/api/reportes/rentabilidad-tecnicos/route")
    GET = mod.GET
  })

  it("branch-A cookie → ordenes filtered by sucursal_id", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-A")

    const ordenesChain = createChainMock([BRANCH_A_ORDEN])
    ordenesChain.then = (resolve: any) => resolve({ data: [BRANCH_A_ORDEN], error: null })

    mockSupabaseFrom({ ordenes_servicio: ordenesChain })

    const response = await GET(createGetRequest())
    const { status } = await parseResponse(response)

    expect(status).toBe(200)
    expect(ordenesChain.eq).toHaveBeenCalledWith("sucursal_id", "suc-A")
  })

  it("verTodas → no sucursal_id filter", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("todas")

    const ordenesChain = createChainMock([])
    ordenesChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({ ordenes_servicio: ordenesChain })

    await GET(createGetRequest())

    expect(vi.mocked(ordenesChain.eq).mock.calls.find((c: any[]) => c[0] === "sucursal_id")).toBeUndefined()
  })

  it("no cookie → no sucursal_id filter", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie(null)

    const ordenesChain = createChainMock([])
    ordenesChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({ ordenes_servicio: ordenesChain })

    await GET(createGetRequest())

    expect(vi.mocked(ordenesChain.eq).mock.calls.find((c: any[]) => c[0] === "sucursal_id")).toBeUndefined()
  })
})

// ─── ventas-analytics ────────────────────────────────────────────────────────

const BRANCH_A_VENTA = { id: "v1", sucursal_id: "suc-A", total: 5000, descuento: 0, tipo_descuento: null, porcentaje_descuento: null, estado: "COMPLETADA", metodo_pago: "EFECTIVO", vendedor_id: null, created_at: new Date().toISOString(), monto_abonado: 5000, estado_pago: "PAGADO" }
const BRANCH_B_VENTA = { id: "v2", sucursal_id: "suc-B", total: 3000, descuento: 0, tipo_descuento: null, porcentaje_descuento: null, estado: "COMPLETADA", metodo_pago: "EFECTIVO", vendedor_id: null, created_at: new Date().toISOString(), monto_abonado: 3000, estado_pago: "PAGADO" }

describe("GET /api/reportes/ventas-analytics — branch filter", () => {
  let GET: any

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import("@/app/api/reportes/ventas-analytics/route")
    GET = mod.GET
  })

  it("branch-A cookie → ventas filtered by sucursal_id", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-A")

    const ventasChain = createChainMock([BRANCH_A_VENTA])
    ventasChain.then = (resolve: any) => resolve({ data: [BRANCH_A_VENTA], error: null })

    const emptyChain = createChainMock([])
    emptyChain.then = (resolve: any) => resolve({ data: [], error: null })

    const usersChain = createChainMock([])
    usersChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({
      ventas: ventasChain,
      items_venta: emptyChain,
      users: usersChain,
    })

    const response = await GET()
    const { status } = await parseResponse(response)

    expect(status).toBe(200)
    expect(ventasChain.eq).toHaveBeenCalledWith("sucursal_id", "suc-A")
  })

  it("verTodas → no sucursal_id filter on ventas", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("todas")

    const ventasChain = createChainMock([BRANCH_A_VENTA, BRANCH_B_VENTA])
    ventasChain.then = (resolve: any) => resolve({ data: [BRANCH_A_VENTA, BRANCH_B_VENTA], error: null })

    const emptyChain = createChainMock([])
    emptyChain.then = (resolve: any) => resolve({ data: [], error: null })

    const usersChain = createChainMock([])
    usersChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({
      ventas: ventasChain,
      items_venta: emptyChain,
      users: usersChain,
    })

    await GET()

    expect(vi.mocked(ventasChain.eq).mock.calls.find((c: any[]) => c[0] === "sucursal_id")).toBeUndefined()
  })

  it("no cookie → no sucursal_id filter on ventas", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie(null)

    const ventasChain = createChainMock([])
    ventasChain.then = (resolve: any) => resolve({ data: [], error: null })

    const emptyChain = createChainMock([])
    emptyChain.then = (resolve: any) => resolve({ data: [], error: null })

    const usersChain = createChainMock([])
    usersChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({
      ventas: ventasChain,
      items_venta: emptyChain,
      users: usersChain,
    })

    await GET()

    expect(vi.mocked(ventasChain.eq).mock.calls.find((c: any[]) => c[0] === "sucursal_id")).toBeUndefined()
  })
})

// ─── analisis-inventario — scope field ────────────────────────────────────────

describe("GET /api/reportes/analisis-inventario — scope field", () => {
  let GET: any

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import("@/app/api/reportes/analisis-inventario/route")
    GET = mod.GET
  })

  it('returns scope: "organization" with branch-A cookie active', async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-A")

    const inventarioChain = createChainMock([])
    inventarioChain.then = (resolve: any) => resolve({ data: [], error: null })

    const orgChain = createChainMock({ umbral_stock_bajo: 5 })
    orgChain.then = (resolve: any) => resolve({ data: { umbral_stock_bajo: 5 }, error: null })

    const movChain = createChainMock([])
    movChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({
      inventario: inventarioChain,
      organizations: orgChain,
      movimientos_inventario: movChain,
    })

    const response = await GET()
    const { status, body } = await parseResponse(response)

    expect(status).toBe(200)
    expect(body.scope).toBe("organization")
  })

  it('returns scope: "organization" with verTodas cookie', async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("todas")

    const inventarioChain = createChainMock([])
    inventarioChain.then = (resolve: any) => resolve({ data: [], error: null })

    const orgChain = createChainMock({ umbral_stock_bajo: 5 })
    orgChain.then = (resolve: any) => resolve({ data: { umbral_stock_bajo: 5 }, error: null })

    const movChain = createChainMock([])
    movChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({
      inventario: inventarioChain,
      organizations: orgChain,
      movimientos_inventario: movChain,
    })

    const response = await GET()
    const { status, body } = await parseResponse(response)

    expect(status).toBe(200)
    expect(body.scope).toBe("organization")
  })
})

// ─── inventario-analytics — scope field ──────────────────────────────────────

describe("GET /api/reportes/inventario-analytics — scope field", () => {
  let GET: any

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import("@/app/api/reportes/inventario-analytics/route")
    GET = mod.GET
  })

  it('returns scope: "organization" with branch-A cookie active', async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-A")

    const inventarioChain = createChainMock([])
    inventarioChain.then = (resolve: any) => resolve({ data: [], error: null })

    const movChain = createChainMock([])
    movChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({
      inventario: inventarioChain,
      movimientos_inventario: movChain,
    })

    const response = await GET()
    const { status, body } = await parseResponse(response)

    expect(status).toBe(200)
    expect(body.scope).toBe("organization")
  })

  it('returns scope: "organization" regardless of cookie', async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie(null)

    const inventarioChain = createChainMock([])
    inventarioChain.then = (resolve: any) => resolve({ data: [], error: null })

    const movChain = createChainMock([])
    movChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({
      inventario: inventarioChain,
      movimientos_inventario: movChain,
    })

    const response = await GET()
    const { status, body } = await parseResponse(response)

    expect(status).toBe(200)
    expect(body.scope).toBe("organization")
  })
})
