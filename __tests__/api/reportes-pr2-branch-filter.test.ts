/**
 * Tests: PR2 — Branch filter on MEDIUM report endpoints (join-filter via embedded resource)
 *
 * Each endpoint covers 2 key scenarios per spec:
 *  (a) branch-A cookie → only that branch's rows (verifies .eq called with dotted path or direct)
 *  (b) verTodas → no branch filter applied
 *
 * For multi-source endpoints (comparativa-ingresos, resumen-ingresos, ingresos-unificados):
 *  tests verify each source (ventas, facturas→ordenes, cobros→ordenes) gets filtered.
 *
 * prediccion-repuestos: usage filtered by branch; stock stays org-wide; scope = "mixed".
 * performance-vendedores: filtro resolution wired (PR2 placeholder); RPC call unchanged.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  mockSupabaseFrom,
  createChainMock,
  parseResponse,
  createGetRequest,
} from "./helpers"
import { cookies } from "next/headers"
import { supabaseAdmin } from "@/lib/supabase"
import { NextRequest } from "next/server"

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn(),
}))

import { hasPlanFeature } from "@/lib/subscriptions"

function mockCookie(value: string | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn((name: string) =>
      name === "stapp-sucursal-activa" && value ? { value } : undefined
    ),
    set: vi.fn(),
  } as any)
}

// ─── garantias-ventas ─────────────────────────────────────────────────────────

describe("GET /api/reportes/garantias-ventas — branch filter via ventas!inner", () => {
  let GET: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    const mod = await import("@/app/api/reportes/garantias-ventas/route")
    GET = mod.GET
  })

  it("branch-A cookie → .eq('ventas.sucursal_id', 'suc-A') called on garantias_venta chain", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-A")

    const garantiasChain = createChainMock([])
    garantiasChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({ garantias_venta: garantiasChain })

    const response = await GET()
    const { status } = await parseResponse(response)

    expect(status).toBe(200)
    expect(garantiasChain.eq).toHaveBeenCalledWith("ventas.sucursal_id", "suc-A")
  })

  it("verTodas → no ventas.sucursal_id filter applied", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("todas")

    const garantiasChain = createChainMock([])
    garantiasChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({ garantias_venta: garantiasChain })

    await GET()

    const eqCalls = vi.mocked(garantiasChain.eq).mock.calls
    expect(eqCalls.find((c: any[]) => c[0] === "ventas.sucursal_id")).toBeUndefined()
  })
})

// ─── ingresos ─────────────────────────────────────────────────────────────────

describe("GET /api/reportes/ingresos — branch filter via facturas→ordenes_servicio!inner", () => {
  let GET: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    const mod = await import("@/app/api/reportes/ingresos/route")
    GET = mod.GET
  })

  it("branch-A cookie → .eq('ordenes_servicio.sucursal_id', 'suc-A') called on facturas chain", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-A")

    const facturasChain = createChainMock([])
    facturasChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({ facturas: facturasChain })

    const response = await GET(createGetRequest())
    const { status } = await parseResponse(response)

    expect(status).toBe(200)
    expect(facturasChain.eq).toHaveBeenCalledWith("ordenes_servicio.sucursal_id", "suc-A")
  })

  it("verTodas → no ordenes_servicio.sucursal_id filter", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("todas")

    const facturasChain = createChainMock([])
    facturasChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({ facturas: facturasChain })

    await GET(createGetRequest())

    const eqCalls = vi.mocked(facturasChain.eq).mock.calls
    expect(eqCalls.find((c: any[]) => c[0] === "ordenes_servicio.sucursal_id")).toBeUndefined()
  })
})

// ─── comparativa-ingresos ─────────────────────────────────────────────────────

describe("GET /api/reportes/comparativa-ingresos — branch filter on 3 sources", () => {
  let GET: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    const mod = await import("@/app/api/reportes/comparativa-ingresos/route")
    GET = mod.GET
  })

  it("branch-A cookie → ventas filtered by sucursal_id", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-A")

    const ventasChain = createChainMock([])
    ventasChain.then = (resolve: any) => resolve({ data: [], error: null })

    const facturasChain = createChainMock([])
    facturasChain.then = (resolve: any) => resolve({ data: [], error: null })

    const cobrosChain = createChainMock([])
    cobrosChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({
      ventas: ventasChain,
      facturas: facturasChain,
      cobros_orden: cobrosChain,
    })

    const response = await GET()
    const { status } = await parseResponse(response)

    expect(status).toBe(200)
    expect(ventasChain.eq).toHaveBeenCalledWith("sucursal_id", "suc-A")
  })

  it("branch-A cookie → facturas filtered via ordenes_servicio.sucursal_id", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-A")

    const ventasChain = createChainMock([])
    ventasChain.then = (resolve: any) => resolve({ data: [], error: null })

    const facturasChain = createChainMock([])
    facturasChain.then = (resolve: any) => resolve({ data: [], error: null })

    const cobrosChain = createChainMock([])
    cobrosChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({
      ventas: ventasChain,
      facturas: facturasChain,
      cobros_orden: cobrosChain,
    })

    await GET()

    expect(facturasChain.eq).toHaveBeenCalledWith("ordenes_servicio.sucursal_id", "suc-A")
  })

  it("branch-A cookie → cobros filtered via ordenes_servicio.sucursal_id", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-A")

    const ventasChain = createChainMock([])
    ventasChain.then = (resolve: any) => resolve({ data: [], error: null })

    const facturasChain = createChainMock([])
    facturasChain.then = (resolve: any) => resolve({ data: [], error: null })

    const cobrosChain = createChainMock([])
    cobrosChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({
      ventas: ventasChain,
      facturas: facturasChain,
      cobros_orden: cobrosChain,
    })

    await GET()

    expect(cobrosChain.eq).toHaveBeenCalledWith("ordenes_servicio.sucursal_id", "suc-A")
  })

  it("verTodas → no branch filter on any source", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("todas")

    const ventasChain = createChainMock([])
    ventasChain.then = (resolve: any) => resolve({ data: [], error: null })

    const facturasChain = createChainMock([])
    facturasChain.then = (resolve: any) => resolve({ data: [], error: null })

    const cobrosChain = createChainMock([])
    cobrosChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({
      ventas: ventasChain,
      facturas: facturasChain,
      cobros_orden: cobrosChain,
    })

    await GET()

    expect(ventasChain.eq.mock.calls.find((c: any[]) => c[0] === "sucursal_id")).toBeUndefined()
    expect(facturasChain.eq.mock.calls.find((c: any[]) => c[0] === "ordenes_servicio.sucursal_id")).toBeUndefined()
    expect(cobrosChain.eq.mock.calls.find((c: any[]) => c[0] === "ordenes_servicio.sucursal_id")).toBeUndefined()
  })
})

// ─── resumen-ingresos ─────────────────────────────────────────────────────────

describe("GET /api/reportes/resumen-ingresos — branch filter on 3 sources", () => {
  let GET: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    const mod = await import("@/app/api/reportes/resumen-ingresos/route")
    GET = mod.GET
  })

  it("branch-A cookie → facturas filtered via ordenes_servicio.sucursal_id", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-A")

    const facturasChain = createChainMock([])
    facturasChain.then = (resolve: any) => resolve({ data: [], error: null })

    const ventasChain = createChainMock([])
    ventasChain.then = (resolve: any) => resolve({ data: [], error: null })

    const cobrosChain = createChainMock([])
    cobrosChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({
      facturas: facturasChain,
      ventas: ventasChain,
      cobros_orden: cobrosChain,
    })

    const response = await GET(createGetRequest())
    const { status } = await parseResponse(response)

    expect(status).toBe(200)
    expect(facturasChain.eq).toHaveBeenCalledWith("ordenes_servicio.sucursal_id", "suc-A")
  })

  it("branch-A cookie → ventas filtered by sucursal_id", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-A")

    const facturasChain = createChainMock([])
    facturasChain.then = (resolve: any) => resolve({ data: [], error: null })

    const ventasChain = createChainMock([])
    ventasChain.then = (resolve: any) => resolve({ data: [], error: null })

    const cobrosChain = createChainMock([])
    cobrosChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({
      facturas: facturasChain,
      ventas: ventasChain,
      cobros_orden: cobrosChain,
    })

    await GET(createGetRequest())

    expect(ventasChain.eq).toHaveBeenCalledWith("sucursal_id", "suc-A")
  })

  it("branch-A cookie → cobros filtered via ordenes_servicio.sucursal_id", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-A")

    const facturasChain = createChainMock([])
    facturasChain.then = (resolve: any) => resolve({ data: [], error: null })

    const ventasChain = createChainMock([])
    ventasChain.then = (resolve: any) => resolve({ data: [], error: null })

    const cobrosChain = createChainMock([])
    cobrosChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({
      facturas: facturasChain,
      ventas: ventasChain,
      cobros_orden: cobrosChain,
    })

    await GET(createGetRequest())

    expect(cobrosChain.eq).toHaveBeenCalledWith("ordenes_servicio.sucursal_id", "suc-A")
  })

  it("verTodas → no branch filter on any source", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("todas")

    const facturasChain = createChainMock([])
    facturasChain.then = (resolve: any) => resolve({ data: [], error: null })

    const ventasChain = createChainMock([])
    ventasChain.then = (resolve: any) => resolve({ data: [], error: null })

    const cobrosChain = createChainMock([])
    cobrosChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({
      facturas: facturasChain,
      ventas: ventasChain,
      cobros_orden: cobrosChain,
    })

    await GET(createGetRequest())

    expect(facturasChain.eq.mock.calls.find((c: any[]) => c[0] === "ordenes_servicio.sucursal_id")).toBeUndefined()
    expect(ventasChain.eq.mock.calls.find((c: any[]) => c[0] === "sucursal_id")).toBeUndefined()
    expect(cobrosChain.eq.mock.calls.find((c: any[]) => c[0] === "ordenes_servicio.sucursal_id")).toBeUndefined()
  })
})

// ─── ingresos-unificados ──────────────────────────────────────────────────────

describe("GET /api/reportes/ingresos-unificados — branch filter on 3 sources", () => {
  let GET: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    const mod = await import("@/app/api/reportes/ingresos-unificados/route")
    GET = mod.GET
  })

  it("branch-A cookie → ventas filtered by sucursal_id", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-A")

    const ventasChain = createChainMock([])
    ventasChain.then = (resolve: any) => resolve({ data: [], error: null })

    const facturasChain = createChainMock([])
    facturasChain.then = (resolve: any) => resolve({ data: [], error: null })

    const cobrosChain = createChainMock([])
    cobrosChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({
      ventas: ventasChain,
      facturas: facturasChain,
      cobros_orden: cobrosChain,
    })

    const response = await GET(createGetRequest())
    const { status } = await parseResponse(response)

    expect(status).toBe(200)
    expect(ventasChain.eq).toHaveBeenCalledWith("sucursal_id", "suc-A")
  })

  it("branch-A cookie → facturas filtered via ordenes_servicio.sucursal_id", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-A")

    const ventasChain = createChainMock([])
    ventasChain.then = (resolve: any) => resolve({ data: [], error: null })

    const facturasChain = createChainMock([])
    facturasChain.then = (resolve: any) => resolve({ data: [], error: null })

    const cobrosChain = createChainMock([])
    cobrosChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({
      ventas: ventasChain,
      facturas: facturasChain,
      cobros_orden: cobrosChain,
    })

    await GET(createGetRequest())

    expect(facturasChain.eq).toHaveBeenCalledWith("ordenes_servicio.sucursal_id", "suc-A")
  })

  it("branch-A cookie → cobros filtered via ordenes_servicio.sucursal_id", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-A")

    const ventasChain = createChainMock([])
    ventasChain.then = (resolve: any) => resolve({ data: [], error: null })

    const facturasChain = createChainMock([])
    facturasChain.then = (resolve: any) => resolve({ data: [], error: null })

    const cobrosChain = createChainMock([])
    cobrosChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({
      ventas: ventasChain,
      facturas: facturasChain,
      cobros_orden: cobrosChain,
    })

    await GET(createGetRequest())

    expect(cobrosChain.eq).toHaveBeenCalledWith("ordenes_servicio.sucursal_id", "suc-A")
  })

  it("verTodas → no branch filter on any source", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("todas")

    const ventasChain = createChainMock([])
    ventasChain.then = (resolve: any) => resolve({ data: [], error: null })

    const facturasChain = createChainMock([])
    facturasChain.then = (resolve: any) => resolve({ data: [], error: null })

    const cobrosChain = createChainMock([])
    cobrosChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({
      ventas: ventasChain,
      facturas: facturasChain,
      cobros_orden: cobrosChain,
    })

    await GET(createGetRequest())

    expect(ventasChain.eq.mock.calls.find((c: any[]) => c[0] === "sucursal_id")).toBeUndefined()
    expect(facturasChain.eq.mock.calls.find((c: any[]) => c[0] === "ordenes_servicio.sucursal_id")).toBeUndefined()
    expect(cobrosChain.eq.mock.calls.find((c: any[]) => c[0] === "ordenes_servicio.sucursal_id")).toBeUndefined()
  })
})

// ─── top-clientes ─────────────────────────────────────────────────────────────

describe("GET /api/reportes/top-clientes — branch filter on ordenes_servicio", () => {
  let GET: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    const mod = await import("@/app/api/reportes/top-clientes/route")
    GET = mod.GET
  })

  it("branch-A cookie → ordenes_servicio filtered by sucursal_id", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-A")

    const clientesChain = createChainMock([{ id: "c1", nombre: "Cliente A", telefono: null, email: null }])
    clientesChain.then = (resolve: any) => resolve({ data: [{ id: "c1", nombre: "Cliente A", telefono: null, email: null }], error: null })

    const ordenesChain = createChainMock([])
    ordenesChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({ clientes: clientesChain, ordenes_servicio: ordenesChain })

    const response = await GET(new NextRequest("http://localhost:3000/api/reportes/top-clientes"))
    const { status } = await parseResponse(response)

    expect(status).toBe(200)
    expect(ordenesChain.eq).toHaveBeenCalledWith("sucursal_id", "suc-A")
  })

  it("verTodas → no sucursal_id filter on ordenes_servicio", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("todas")

    const clientesChain = createChainMock([])
    clientesChain.then = (resolve: any) => resolve({ data: [], error: null })

    const ordenesChain = createChainMock([])
    ordenesChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({ clientes: clientesChain, ordenes_servicio: ordenesChain })

    await GET(new NextRequest("http://localhost:3000/api/reportes/top-clientes"))

    expect(ordenesChain.eq.mock.calls.find((c: any[]) => c[0] === "sucursal_id")).toBeUndefined()
  })
})

// ─── clientes-analytics ───────────────────────────────────────────────────────

describe("GET /api/reportes/clientes-analytics — branch filter on ventas", () => {
  let GET: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    const mod = await import("@/app/api/reportes/clientes-analytics/route")
    GET = mod.GET
  })

  it("branch-A cookie → ventas filtered by sucursal_id", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-A")

    const clientesChain = createChainMock([])
    clientesChain.then = (resolve: any) => resolve({ data: [], error: null })

    const ventasChain = createChainMock([])
    ventasChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({ clientes: clientesChain, ventas: ventasChain })

    const response = await GET()
    const { status } = await parseResponse(response)

    expect(status).toBe(200)
    expect(ventasChain.eq).toHaveBeenCalledWith("sucursal_id", "suc-A")
  })

  it("verTodas → no sucursal_id filter on ventas", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("todas")

    const clientesChain = createChainMock([])
    clientesChain.then = (resolve: any) => resolve({ data: [], error: null })

    const ventasChain = createChainMock([])
    ventasChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({ clientes: clientesChain, ventas: ventasChain })

    await GET()

    expect(ventasChain.eq.mock.calls.find((c: any[]) => c[0] === "sucursal_id")).toBeUndefined()
  })
})

// ─── prediccion-repuestos ─────────────────────────────────────────────────────

describe("GET /api/reportes/prediccion-repuestos — branch filter on usage, stock org-wide, scope=mixed", () => {
  let GET: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.mocked(hasPlanFeature).mockResolvedValue(true)
    const mod = await import("@/app/api/reportes/prediccion-repuestos/route")
    GET = mod.GET
  })

  it("branch-A cookie → repuestos_orden filtered via ordenes_servicio.sucursal_id", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-A")

    const inventarioChain = createChainMock([{ id: "inv1", nombre: "Pantalla", codigo: "P1", stock: 5, precio_compra: 100 }])
    inventarioChain.then = (resolve: any) =>
      resolve({ data: [{ id: "inv1", nombre: "Pantalla", codigo: "P1", stock: 5, precio_compra: 100 }], error: null })

    const repuestosChain = createChainMock([])
    repuestosChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({ inventario: inventarioChain, repuestos_orden: repuestosChain })

    const response = await GET()
    const { status, body } = await parseResponse(response)

    expect(status).toBe(200)
    expect(repuestosChain.eq).toHaveBeenCalledWith("ordenes_servicio.sucursal_id", "suc-A")
  })

  it("branch-A cookie → response includes scope='mixed'", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-A")

    const inventarioChain = createChainMock([])
    inventarioChain.then = (resolve: any) => resolve({ data: [], error: null })

    const repuestosChain = createChainMock([])
    repuestosChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({ inventario: inventarioChain, repuestos_orden: repuestosChain })

    const response = await GET()
    const { status, body } = await parseResponse(response)

    expect(status).toBe(200)
    expect(body.scope).toBe("mixed")
    expect(body.scopeNote).toBeDefined()
  })

  it("verTodas → no ordenes_servicio.sucursal_id filter on repuestos_orden", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("todas")

    const inventarioChain = createChainMock([])
    inventarioChain.then = (resolve: any) => resolve({ data: [], error: null })

    const repuestosChain = createChainMock([])
    repuestosChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({ inventario: inventarioChain, repuestos_orden: repuestosChain })

    await GET()

    expect(repuestosChain.eq.mock.calls.find((c: any[]) => c[0] === "ordenes_servicio.sucursal_id")).toBeUndefined()
  })

  it("verTodas → response still includes scope='mixed'", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("todas")

    const inventarioChain = createChainMock([])
    inventarioChain.then = (resolve: any) => resolve({ data: [], error: null })

    const repuestosChain = createChainMock([])
    repuestosChain.then = (resolve: any) => resolve({ data: [], error: null })

    mockSupabaseFrom({ inventario: inventarioChain, repuestos_orden: repuestosChain })

    const response = await GET()
    const { body } = await parseResponse(response)

    expect(body.scope).toBe("mixed")
  })
})

// ─── performance-vendedores (PR2 placeholder — filtro wired, RPC unchanged) ──

describe("GET /api/reportes/performance-vendedores — filtro resolution wired (PR2 placeholder)", () => {
  let GET: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    const mod = await import("@/app/api/reportes/performance-vendedores/route")
    GET = mod.GET
  })

  it("route resolves without error when branch-A cookie is active", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-A")

    const usersChain = createChainMock([{ id: "v1", nombre: "Vendedor A" }])
    usersChain.then = (resolve: any) => resolve({ data: [{ id: "v1", nombre: "Vendedor A" }], error: null })

    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: [], error: null } as any)

    mockSupabaseFrom({ users: usersChain })

    const response = await GET(createGetRequest())
    const { status } = await parseResponse(response)

    // Should still return 200 — RPC call unchanged in PR2
    expect(status).toBe(200)
  })

  it("route resolves without error when verTodas", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("todas")

    const usersChain = createChainMock([])
    usersChain.then = (resolve: any) => resolve({ data: [], error: null })

    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: [], error: null } as any)

    mockSupabaseFrom({ users: usersChain })

    const response = await GET(createGetRequest())
    const { status } = await parseResponse(response)

    expect(status).toBe(200)
  })
})
