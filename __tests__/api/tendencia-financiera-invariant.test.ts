/**
 * PR3b — Invariant tests: tendencia-financiera branch filtering.
 *
 * Same 11-source checklist as estado-resultados, but data is bucketed per month.
 * Key assertions:
 *  (a) branch cookie → sucursal_id filter on each source chain
 *  (b) verTodas → no sucursal_id filter on any source
 *  (c) per-month invariant: sum(bucketA[m]) + sum(bucketB[m]) == bucketTotal[m] for all m
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

function mockCookie(value: string | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn((name: string) =>
      name === "stapp-sucursal-activa" && value ? { value } : undefined
    ),
    set: vi.fn(),
  } as any)
}

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

function getEqCalls(chain: any): Array<[string, any]> {
  return (vi.mocked(chain.eq).mock.calls as Array<[string, any]>)
}

function hasEqCall(chain: any, column: string, value: any): boolean {
  return getEqCalls(chain).some(([col, val]) => col === column && val === value)
}

function hasNoEqCall(chain: any, column: string): boolean {
  return !getEqCalls(chain).some(([col]) => col === column)
}

describe("tendencia-financiera — branch filter applied to all sources (PR3b)", () => {
  let GET: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    const mod = await import("@/app/api/reportes/tendencia-financiera/route")
    GET = mod.GET
  })

  // ─── Source 1: ventas direct filter ─────────────────────────────────────────

  it("source 1 (ventas): .eq('sucursal_id', 'suc-A') applied when branch-A active", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-A")
    const chains = buildChains()

    await GET(createGetRequest("http://localhost/api/reportes/tendencia-financiera?meses=3"))

    expect(hasEqCall(chains.ventas, "sucursal_id", "suc-A")).toBe(true)
  })

  it("source 1 (ventas): no sucursal_id filter when verTodas", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("todas")
    const chains = buildChains()

    await GET(createGetRequest("http://localhost/api/reportes/tendencia-financiera?meses=3"))

    expect(hasNoEqCall(chains.ventas, "sucursal_id")).toBe(true)
  })

  // ─── Source 2: ordenes_servicio direct filter ────────────────────────────────

  it("source 2 (ordenes_servicio): .eq('sucursal_id', 'suc-A') applied when branch-A active", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-A")
    const chains = buildChains()

    await GET(createGetRequest("http://localhost/api/reportes/tendencia-financiera?meses=3"))

    expect(hasEqCall(chains.ordenes, "sucursal_id", "suc-A")).toBe(true)
  })

  it("source 2 (ordenes_servicio): no sucursal_id filter when verTodas", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("todas")
    const chains = buildChains()

    await GET(createGetRequest("http://localhost/api/reportes/tendencia-financiera?meses=3"))

    expect(hasNoEqCall(chains.ordenes, "sucursal_id")).toBe(true)
  })

  // ─── Source 4: cobros_orden adelantos via ordenes_servicio!inner ─────────────

  it("source 4 (cobros_orden adelantos): .eq('ordenes_servicio.sucursal_id', 'suc-A') applied when branch-A active", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-A")
    const chains = buildChains()

    await GET(createGetRequest("http://localhost/api/reportes/tendencia-financiera?meses=3"))

    expect(hasEqCall(chains.cobros, "ordenes_servicio.sucursal_id", "suc-A")).toBe(true)
  })

  it("source 4 (cobros_orden adelantos): no ordenes_servicio.sucursal_id filter when verTodas", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("todas")
    const chains = buildChains()

    await GET(createGetRequest("http://localhost/api/reportes/tendencia-financiera?meses=3"))

    expect(hasNoEqCall(chains.cobros, "ordenes_servicio.sucursal_id")).toBe(true)
  })

  // ─── Source 5+11: movimientos_caja (INGRESO + EGRESO) direct filter ──────────

  it("source 5+11 (movimientos_caja): .eq('sucursal_id', 'suc-A') applied when branch-A active", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-A")
    const chains = buildChains()

    await GET(createGetRequest("http://localhost/api/reportes/tendencia-financiera?meses=3"))

    expect(hasEqCall(chains.movimientos, "sucursal_id", "suc-A")).toBe(true)
  })

  it("source 5+11 (movimientos_caja): no sucursal_id filter when verTodas", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("todas")
    const chains = buildChains()

    await GET(createGetRequest("http://localhost/api/reportes/tendencia-financiera?meses=3"))

    expect(hasNoEqCall(chains.movimientos, "sucursal_id")).toBe(true)
  })

  // ─── Sources 6+7: pagos_venta/pagos_parciales via ventas!inner / facturas!inner ─

  it("source 6 (pagos_venta): .eq('ventas.sucursal_id', 'suc-A') applied when branch-A active", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-A")
    const chains = buildChains()

    await GET(createGetRequest("http://localhost/api/reportes/tendencia-financiera?meses=3"))

    expect(hasEqCall(chains.pagosVenta, "ventas.sucursal_id", "suc-A")).toBe(true)
  })

  it("source 6 (pagos_venta): no ventas.sucursal_id filter when verTodas", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("todas")
    const chains = buildChains()

    await GET(createGetRequest("http://localhost/api/reportes/tendencia-financiera?meses=3"))

    expect(hasNoEqCall(chains.pagosVenta, "ventas.sucursal_id")).toBe(true)
  })

  it("source 7 (pagos_parciales): .eq on facturas.ordenes_servicio.sucursal_id or equivalent applied when branch-A active", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-A")
    const chains = buildChains()

    await GET(createGetRequest("http://localhost/api/reportes/tendencia-financiera?meses=3"))

    // pagosParciales is joined via facturas!inner(ordenes_servicio!inner(...))
    // The branch filter lands on ordenes_servicio.sucursal_id within that chain
    expect(hasEqCall(chains.pagosParciales, "facturas.ordenes_servicio.sucursal_id", "suc-A")).toBe(true)
  })

  it("source 7 (pagos_parciales): no sucursal_id filter when verTodas", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("todas")
    const chains = buildChains()

    await GET(createGetRequest("http://localhost/api/reportes/tendencia-financiera?meses=3"))

    expect(hasNoEqCall(chains.pagosParciales, "facturas.ordenes_servicio.sucursal_id")).toBe(true)
  })

  // ─── Source 8: cobros_orden CF via ordenes_servicio!inner ────────────────────

  it("source 8 (cobros_orden CF): .eq('ordenes_servicio.sucursal_id', 'suc-A') applied when branch-A active", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-A")
    const chains = buildChains()

    await GET(createGetRequest("http://localhost/api/reportes/tendencia-financiera?meses=3"))

    expect(hasEqCall(chains.cobros, "ordenes_servicio.sucursal_id", "suc-A")).toBe(true)
  })

  // ─── Source 9: notas_credito direct filter ───────────────────────────────────

  it("source 9 (notas_credito): .eq('sucursal_id', 'suc-A') applied when branch-A active", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-A")
    const chains = buildChains()

    await GET(createGetRequest("http://localhost/api/reportes/tendencia-financiera?meses=3"))

    expect(hasEqCall(chains.notasCredito, "sucursal_id", "suc-A")).toBe(true)
  })

  it("source 9 (notas_credito): no sucursal_id filter when verTodas", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("todas")
    const chains = buildChains()

    await GET(createGetRequest("http://localhost/api/reportes/tendencia-financiera?meses=3"))

    expect(hasNoEqCall(chains.notasCredito, "sucursal_id")).toBe(true)
  })

  // ─── Source 10: ajustes_inventario direct filter ─────────────────────────────

  it("source 10 (ajustes_inventario): .eq('sucursal_id', 'suc-A') applied when branch-A active", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-A")
    const chains = buildChains()

    await GET(createGetRequest("http://localhost/api/reportes/tendencia-financiera?meses=3"))

    expect(hasEqCall(chains.ajustes, "sucursal_id", "suc-A")).toBe(true)
  })

  it("source 10 (ajustes_inventario): no sucursal_id filter when verTodas", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("todas")
    const chains = buildChains()

    await GET(createGetRequest("http://localhost/api/reportes/tendencia-financiera?meses=3"))

    expect(hasNoEqCall(chains.ajustes, "sucursal_id")).toBe(true)
  })

  // ─── Per-month invariant: branchA + branchB == verTodas ─────────────────────

  it("per-month invariant: branchA.totales.ingresos + branchB.totales.ingresos == verTodas.totales.ingresos", async () => {
    const url = "http://localhost/api/reportes/tendencia-financiera?meses=3"
    const now = new Date()
    const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
    const ventaA = {
      id: "v-a",
      total: "500",
      estado: "COMPLETADA",
      created_at: `${currentKey}-10T00:00:00Z`,
      porcentaje_comision: null,
      vendedor_id: null,
      items_venta: [],
      sucursal_id: "suc-A",
    }
    const ventaB = {
      id: "v-b",
      total: "300",
      estado: "COMPLETADA",
      created_at: `${currentKey}-10T00:00:00Z`,
      porcentaje_comision: null,
      vendedor_id: null,
      items_venta: [],
      sucursal_id: "suc-B",
    }

    const emptyTables = () => ({
      ordenes_servicio: createChainMock([]),
      cobros_orden: createChainMock([]),
      movimientos_caja: createChainMock([]),
      pagos_venta: createChainMock([]),
      pagos_parciales: createChainMock([]),
      facturas: createChainMock([]),
      notas_credito: createChainMock([]),
      ajustes_inventario: createChainMock([]),
    })

    // --- Branch A ---
    vi.resetModules()
    const modA = await import("@/app/api/reportes/tendencia-financiera/route")
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-A")
    mockSupabaseFrom({ ventas: createChainMock([ventaA]), ...emptyTables() })
    const resA = await modA.GET(createGetRequest(url))
    const { body: bodyA } = await parseResponse(resA)

    // --- Branch B ---
    vi.resetModules()
    const modB = await import("@/app/api/reportes/tendencia-financiera/route")
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("suc-B")
    mockSupabaseFrom({ ventas: createChainMock([ventaB]), ...emptyTables() })
    const resB = await modB.GET(createGetRequest(url))
    const { body: bodyB } = await parseResponse(resB)

    // --- verTodas ---
    vi.resetModules()
    const modAll = await import("@/app/api/reportes/tendencia-financiera/route")
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("todas")
    mockSupabaseFrom({ ventas: createChainMock([ventaA, ventaB]), ...emptyTables() })
    const resAll = await modAll.GET(createGetRequest(url))
    const { body: bodyAll } = await parseResponse(resAll)

    expect(bodyA.totales.ingresos).toBe(500)
    expect(bodyB.totales.ingresos).toBe(300)
    expect(bodyAll.totales.ingresos).toBe(800)

    // Per-month invariant: sum A + B = total for each month bucket
    for (const mes of bodyAll.porMes) {
      const mA = bodyA.porMes.find((m: any) => m.mesCompleto === mes.mesCompleto)
      const mB = bodyB.porMes.find((m: any) => m.mesCompleto === mes.mesCompleto)
      const sumAB = (mA?.ingresos ?? 0) + (mB?.ingresos ?? 0)
      expect(Math.abs(sumAB - mes.ingresos)).toBeLessThanOrEqual(0.01)
    }
  })
})

describe("tendencia-financiera — SIN_FALLA_DETECTADA nunca devenga", () => {
  let GET: any

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    const mod = await import("@/app/api/reportes/tendencia-financiera/route")
    GET = mod.GET
  })

  it("no cuenta como ingreso un cobro sobre una orden en SIN_FALLA_DETECTADA", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("todas")

    const now = new Date()
    const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`

    // Cobro sobre una orden que quedó en SIN_FALLA_DETECTADA (equipo OK, sin falla).
    // Debe ignorarse como ingreso, igual que SIN_REPARACION / CANCELADO.
    const cobro = {
      orden_id: "o-sfd",
      monto: "1000",
      created_at: `${currentKey}-10T00:00:00Z`,
      costo_financiero_monto: null,
      ordenes_servicio: {
        estado: "SIN_FALLA_DETECTADA",
        fecha_completado: null,
        organization_id: "org-1",
        sucursal_id: "suc-A",
      },
    }

    mockSupabaseFrom({
      ventas: createChainMock([]),
      ordenes_servicio: createChainMock([]),
      cobros_orden: createChainMock([cobro]),
      movimientos_caja: createChainMock([]),
      pagos_venta: createChainMock([]),
      pagos_parciales: createChainMock([]),
      facturas: createChainMock([]),
      notas_credito: createChainMock([]),
      ajustes_inventario: createChainMock([]),
    })

    const res = await GET(createGetRequest("http://localhost/api/reportes/tendencia-financiera?meses=3"))
    const { body } = await parseResponse(res)

    expect(body.totales.ingresos).toBe(0)
  })
})
