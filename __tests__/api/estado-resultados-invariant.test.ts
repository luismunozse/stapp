/**
 * PR3b — Invariant tests: estado-resultados branch filtering.
 *
 * Spec invariants:
 *  I-1: sum(per-branch P&L) == org-wide P&L (for all rows with non-NULL sucursal_id)
 *  I-2: Branch filter applied consistently to ALL sub-sources
 *  I-3: NULL sucursal_id rows excluded from branch queries, included in verTodas
 *
 * Strategy: mock each source with branch-scoped data. Assert:
 *  (a) branch-A cookie → .eq("sucursal_id", "suc-A") or .eq("ordenes_servicio.sucursal_id", "suc-A") called on each source
 *  (b) verTodas → no sucursal_id filter applied to any source
 *  (c) P&L math invariant via numeric fixture (A + B == total)
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

function mockCookie(value: string | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn((name: string) =>
      name === "stapp-sucursal-activa" && value ? { value } : undefined
    ),
    set: vi.fn(),
  } as any)
}

/**
 * Setup per-table chains and return them so we can inspect .eq calls.
 */
function buildChains() {
  const ventas = createChainMock([])
  const ordenes = createChainMock([])
  const cobros = createChainMock([])
  const movimientos = createChainMock([])
  const pagosVenta = createChainMock([])
  const pagosParciales = createChainMock([])
  const facturas = createChainMock([])
  const notasCredito = createChainMock([])
  const ajustes = createChainMock([])

  mockSupabaseFrom({
    ventas,
    ordenes_servicio: ordenes,
    cobros_orden: cobros,
    movimientos_caja: movimientos,
    pagos_venta: pagosVenta,
    pagos_parciales: pagosParciales,
    facturas,
    notas_credito: notasCredito,
    ajustes_inventario: ajustes,
  })

  return { ventas, ordenes, cobros, movimientos, pagosVenta, pagosParciales, facturas, notasCredito, ajustes }
}

/**
 * Extract all arguments passed to .eq() calls on a chain.
 */
function getEqCalls(chain: any): Array<[string, any]> {
  return (vi.mocked(chain.eq).mock.calls as Array<[string, any]>)
}

function hasEqCall(chain: any, column: string, value: any): boolean {
  return getEqCalls(chain).some(([col, val]) => col === column && val === value)
}

function hasNoEqCall(chain: any, column: string): boolean {
  return !getEqCalls(chain).some(([col]) => col === column)
}

describe("estado-resultados — branch filter applied to all sources (PR3b)", () => {
  let GET: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    const mod = await import("@/app/api/reportes/estado-resultados/route")
    GET = mod.GET
  })

  // ─── Source 1: ventas direct filter ─────────────────────────────────────────

  it("source 1 (ventas): .eq('sucursal_id', 'suc-A') applied when branch-A active", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-A")
    const chains = buildChains()

    await GET(createGetRequest("http://localhost/api/reportes/estado-resultados?desde=2026-05-01&hasta=2026-05-31"))

    expect(hasEqCall(chains.ventas, "sucursal_id", "suc-A")).toBe(true)
  })

  it("source 1 (ventas): no sucursal_id filter when verTodas", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("todas")
    const chains = buildChains()

    await GET(createGetRequest("http://localhost/api/reportes/estado-resultados?desde=2026-05-01&hasta=2026-05-31"))

    expect(hasNoEqCall(chains.ventas, "sucursal_id")).toBe(true)
  })

  // ─── Source 2: ordenes_servicio direct filter ────────────────────────────────

  it("source 2 (ordenes_servicio): .eq('sucursal_id', 'suc-A') applied when branch-A active", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-A")
    const chains = buildChains()

    await GET(createGetRequest("http://localhost/api/reportes/estado-resultados?desde=2026-05-01&hasta=2026-05-31"))

    expect(hasEqCall(chains.ordenes, "sucursal_id", "suc-A")).toBe(true)
  })

  it("source 2 (ordenes_servicio): no sucursal_id filter when verTodas", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("todas")
    const chains = buildChains()

    await GET(createGetRequest("http://localhost/api/reportes/estado-resultados?desde=2026-05-01&hasta=2026-05-31"))

    expect(hasNoEqCall(chains.ordenes, "sucursal_id")).toBe(true)
  })

  // ─── Source 4: cobros_orden adelantos via ordenes_servicio!inner ─────────────

  it("source 4 (cobros_orden adelantos): .eq('ordenes_servicio.sucursal_id', 'suc-A') applied when branch-A active", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-A")
    const chains = buildChains()

    await GET(createGetRequest("http://localhost/api/reportes/estado-resultados?desde=2026-05-01&hasta=2026-05-31"))

    expect(hasEqCall(chains.cobros, "ordenes_servicio.sucursal_id", "suc-A")).toBe(true)
  })

  it("source 4 (cobros_orden adelantos): no ordenes_servicio.sucursal_id filter when verTodas", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("todas")
    const chains = buildChains()

    await GET(createGetRequest("http://localhost/api/reportes/estado-resultados?desde=2026-05-01&hasta=2026-05-31"))

    expect(hasNoEqCall(chains.cobros, "ordenes_servicio.sucursal_id")).toBe(true)
  })

  // ─── Source 5: movimientos_caja INGRESO direct filter ───────────────────────

  it("source 5 (movimientos_caja INGRESO): .eq('sucursal_id', 'suc-A') applied when branch-A active", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-A")
    const chains = buildChains()

    await GET(createGetRequest("http://localhost/api/reportes/estado-resultados?desde=2026-05-01&hasta=2026-05-31"))

    expect(hasEqCall(chains.movimientos, "sucursal_id", "suc-A")).toBe(true)
  })

  it("source 5 (movimientos_caja): no sucursal_id filter when verTodas", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("todas")
    const chains = buildChains()

    await GET(createGetRequest("http://localhost/api/reportes/estado-resultados?desde=2026-05-01&hasta=2026-05-31"))

    expect(hasNoEqCall(chains.movimientos, "sucursal_id")).toBe(true)
  })

  // ─── Source 8: cobros_orden CF directos via ordenes_servicio!inner ──────────

  it("source 8 (cobros_orden CF): .eq('ordenes_servicio.sucursal_id', 'suc-A') applied when branch-A active", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-A")
    const chains = buildChains()

    await GET(createGetRequest("http://localhost/api/reportes/estado-resultados?desde=2026-05-01&hasta=2026-05-31"))

    // cobros_orden chain is reused for source 3 (previos), source 4 (adelantos), and source 8 (CF)
    // We just verify the .eq was called with ordenes_servicio.sucursal_id at least once (source 4 or 8)
    expect(hasEqCall(chains.cobros, "ordenes_servicio.sucursal_id", "suc-A")).toBe(true)
  })

  // ─── Source 9: notas_credito direct filter ───────────────────────────────────

  it("source 9 (notas_credito): .eq('sucursal_id', 'suc-A') applied when branch-A active", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-A")
    const chains = buildChains()

    await GET(createGetRequest("http://localhost/api/reportes/estado-resultados?desde=2026-05-01&hasta=2026-05-31"))

    expect(hasEqCall(chains.notasCredito, "sucursal_id", "suc-A")).toBe(true)
  })

  it("source 9 (notas_credito): no sucursal_id filter when verTodas", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("todas")
    const chains = buildChains()

    await GET(createGetRequest("http://localhost/api/reportes/estado-resultados?desde=2026-05-01&hasta=2026-05-31"))

    expect(hasNoEqCall(chains.notasCredito, "sucursal_id")).toBe(true)
  })

  // ─── Source 10: ajustes_inventario direct filter ─────────────────────────────

  it("source 10 (ajustes_inventario): .eq('sucursal_id', 'suc-A') applied when branch-A active", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-A")
    const chains = buildChains()

    await GET(createGetRequest("http://localhost/api/reportes/estado-resultados?desde=2026-05-01&hasta=2026-05-31"))

    expect(hasEqCall(chains.ajustes, "sucursal_id", "suc-A")).toBe(true)
  })

  it("source 10 (ajustes_inventario): no sucursal_id filter when verTodas", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("todas")
    const chains = buildChains()

    await GET(createGetRequest("http://localhost/api/reportes/estado-resultados?desde=2026-05-01&hasta=2026-05-31"))

    expect(hasNoEqCall(chains.ajustes, "sucursal_id")).toBe(true)
  })

  // ─── P&L numeric invariant: branch A + branch B == verTodas ────────────────

  it("P&L invariant: branchA.gananciaNeta + branchB.gananciaNeta == verTodas.gananciaNeta", async () => {
    const url = "http://localhost/api/reportes/estado-resultados?desde=2026-05-01&hasta=2026-05-31"

    // --- Branch A ---
    vi.resetModules()
    const modA = await import("@/app/api/reportes/estado-resultados/route")
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-A")
    mockSupabaseFrom({
      ventas: createChainMock([{
        id: "v-a",
        total: "500",
        estado: "COMPLETADA",
        created_at: "2026-05-10T00:00:00Z",
        porcentaje_comision: null,
        vendedor_id: null,
        items_venta: [],
        sucursal_id: "suc-A",
      }]),
      ordenes_servicio: createChainMock([]),
      cobros_orden: createChainMock([]),
      movimientos_caja: createChainMock([]),
      pagos_venta: createChainMock([]),
      pagos_parciales: createChainMock([]),
      facturas: createChainMock([]),
      notas_credito: createChainMock([]),
      ajustes_inventario: createChainMock([]),
    })
    const resA = await modA.GET(createGetRequest(url))
    const { body: bodyA } = await parseResponse(resA)

    // --- Branch B ---
    vi.resetModules()
    const modB = await import("@/app/api/reportes/estado-resultados/route")
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-B")
    mockSupabaseFrom({
      ventas: createChainMock([{
        id: "v-b",
        total: "300",
        estado: "COMPLETADA",
        created_at: "2026-05-10T00:00:00Z",
        porcentaje_comision: null,
        vendedor_id: null,
        items_venta: [],
        sucursal_id: "suc-B",
      }]),
      ordenes_servicio: createChainMock([]),
      cobros_orden: createChainMock([]),
      movimientos_caja: createChainMock([]),
      pagos_venta: createChainMock([]),
      pagos_parciales: createChainMock([]),
      facturas: createChainMock([]),
      notas_credito: createChainMock([]),
      ajustes_inventario: createChainMock([]),
    })
    const resB = await modB.GET(createGetRequest(url))
    const { body: bodyB } = await parseResponse(resB)

    // --- verTodas ---
    vi.resetModules()
    const modAll = await import("@/app/api/reportes/estado-resultados/route")
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("todas")
    mockSupabaseFrom({
      ventas: createChainMock([
        {
          id: "v-a",
          total: "500",
          estado: "COMPLETADA",
          created_at: "2026-05-10T00:00:00Z",
          porcentaje_comision: null,
          vendedor_id: null,
          items_venta: [],
          sucursal_id: "suc-A",
        },
        {
          id: "v-b",
          total: "300",
          estado: "COMPLETADA",
          created_at: "2026-05-10T00:00:00Z",
          porcentaje_comision: null,
          vendedor_id: null,
          items_venta: [],
          sucursal_id: "suc-B",
        },
      ]),
      ordenes_servicio: createChainMock([]),
      cobros_orden: createChainMock([]),
      movimientos_caja: createChainMock([]),
      pagos_venta: createChainMock([]),
      pagos_parciales: createChainMock([]),
      facturas: createChainMock([]),
      notas_credito: createChainMock([]),
      ajustes_inventario: createChainMock([]),
    })
    const resAll = await modAll.GET(createGetRequest(url))
    const { body: bodyAll } = await parseResponse(resAll)

    // Invariant: A + B = total (for the fixture where all rows have sucursal_id)
    const sumAB = bodyA.gananciaNeta + bodyB.gananciaNeta
    expect(Math.abs(sumAB - bodyAll.gananciaNeta)).toBeLessThanOrEqual(0.01)
    expect(bodyA.ingresos.total).toBe(500)
    expect(bodyB.ingresos.total).toBe(300)
    expect(bodyAll.ingresos.total).toBe(800)
  })
})

describe("estado-resultados — costos financieros scopeados por org (anti cross-tenant)", () => {
  let GET: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    const mod = await import("@/app/api/reportes/estado-resultados/route")
    GET = mod.GET
  })

  const url = "http://localhost/api/reportes/estado-resultados?desde=2026-05-01&hasta=2026-05-31"

  it("pagos_venta CF: la query scopea por ventas.organization_id (no fetch de todas las orgs)", async () => {
    mockAuthSuccess({ role: "ADMIN" }) // org-1 por defecto
    mockCookie("todas")
    const chains = buildChains()

    await GET(createGetRequest(url))

    // El bug traía pagos_venta sin scoping (truncado a 1000 filas cross-org).
    // El fix filtra por la org en la propia query vía ventas!inner.
    expect(hasEqCall(chains.pagosVenta, "ventas.organization_id", "org-1")).toBe(true)
  })

  it("pagos_parciales CF: la query scopea por facturas.ordenes_servicio.organization_id", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("todas")
    const chains = buildChains()

    await GET(createGetRequest(url))

    expect(hasEqCall(chains.pagosParciales, "facturas.ordenes_servicio.organization_id", "org-1")).toBe(true)
  })

  it("pagos_venta CF: aplica .eq('ventas.sucursal_id', 'suc-A') con branch activo", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-A")
    const chains = buildChains()

    await GET(createGetRequest(url))

    expect(hasEqCall(chains.pagosVenta, "ventas.sucursal_id", "suc-A")).toBe(true)
  })
})
