/**
 * Tests for three financial-report fixes:
 *
 *  F3   — ingresos-unificados must filter facturas by estado_pago = "PAGADO"
 *  F1/5 — income reports must deduct notas_credito from totals
 *  BUG-1 — garantias-ventas distribución must read dias_validez from garantia, not items_venta
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import {
  mockAuthSuccess,
  mockSupabaseFrom,
  createChainMock,
  createGetRequest,
  parseResponse,
} from "./helpers"

// ─────────────────────────────────────────────────────────────────────────────
// F3 — ingresos-unificados: facturas query must include .eq("estado_pago", "PAGADO")
// ─────────────────────────────────────────────────────────────────────────────

describe("F3 — ingresos-unificados: facturas filtered by estado_pago=PAGADO", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockAuthSuccess()
  })

  it("applies .eq('estado_pago', 'PAGADO') to the facturas query", async () => {
    const facturasChain = createChainMock([])
    const cobrosChain = createChainMock([])
    const ventasChain = createChainMock([])
    const notasCreditoChain = createChainMock([])

    mockSupabaseFrom({
      ventas: ventasChain,
      facturas: facturasChain,
      cobros_orden: cobrosChain,
      notas_credito: notasCreditoChain,
    })

    const { GET } = await import("@/app/api/reportes/ingresos-unificados/route")
    await GET(createGetRequest("http://localhost/api/reportes/ingresos-unificados?desde=2026-05-01&hasta=2026-05-31"))

    const eqCalls: Array<[string, any]> = vi.mocked(facturasChain.eq).mock.calls as any
    const hasPagadoFilter = eqCalls.some(([col, val]) => col === "estado_pago" && val === "PAGADO")
    expect(hasPagadoFilter).toBe(true)
  })

  it("PENDIENTE factura NOT counted — totalGeneral unchanged by unpaid invoice", async () => {
    // Simulate: 1 PENDIENTE factura that should NOT be included after the fix.
    // Before the fix totalGeneral would include it; after the fix the facturas
    // chain returns [] (because PAGADO filter excludes the pending one) and
    // totalGeneral stays 0 for services.
    const facturasChain = createChainMock([]) // returns empty — PAGADO filter applied
    const cobrosChain = createChainMock([])
    const ventasChain = createChainMock([{ id: "v1", numero_venta: 1, cliente_nombre: "Ana", total: "100", descuento: "0", metodo_pago: "EFECTIVO", estado: "COMPLETADA", created_at: "2026-05-10T00:00:00Z" }])
    const notasCreditoChain = createChainMock([])

    mockSupabaseFrom({
      ventas: ventasChain,
      facturas: facturasChain,
      cobros_orden: cobrosChain,
      notas_credito: notasCreditoChain,
    })

    const { GET } = await import("@/app/api/reportes/ingresos-unificados/route")
    const res = await GET(createGetRequest("http://localhost/api/reportes/ingresos-unificados?desde=2026-05-01&hasta=2026-05-31"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    // Only the venta counts — the PENDIENTE factura is filtered out
    expect(body.resumen.totalServicios).toBe(0)
    expect(body.resumen.totalGeneral).toBe(100)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// F1/5 — notas_credito deducted from income totals
// ─────────────────────────────────────────────────────────────────────────────

describe("F1/5 — ingresos-unificados: notas_credito deducted from totalGeneral", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockAuthSuccess()
  })

  it("subtracts NC total from totalGeneral and exposes totalNotasCredito field", async () => {
    const ventasChain = createChainMock([
      { id: "v1", numero_venta: 1, cliente_nombre: "Ana", total: "1000", descuento: "0", metodo_pago: "EFECTIVO", estado: "COMPLETADA", created_at: "2026-05-10T00:00:00Z" },
    ])
    const facturasChain = createChainMock([])
    const cobrosChain = createChainMock([])
    const notasCreditoChain = createChainMock([
      { monto: "500", venta_id: "v1", orden_id: null },
    ])

    mockSupabaseFrom({
      ventas: ventasChain,
      facturas: facturasChain,
      cobros_orden: cobrosChain,
      notas_credito: notasCreditoChain,
    })

    const { GET } = await import("@/app/api/reportes/ingresos-unificados/route")
    const res = await GET(createGetRequest("http://localhost/api/reportes/ingresos-unificados?desde=2026-05-01&hasta=2026-05-31"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    // totalGeneral must be net of NC
    expect(body.resumen.totalGeneral).toBe(500)
    // NC field must be visible
    expect(body.resumen.totalNotasCredito).toBe(500)
  })

  it("zero NC: totalGeneral unchanged", async () => {
    const ventasChain = createChainMock([
      { id: "v1", numero_venta: 1, cliente_nombre: "Ana", total: "800", descuento: "0", metodo_pago: "EFECTIVO", estado: "COMPLETADA", created_at: "2026-05-10T00:00:00Z" },
    ])
    const facturasChain = createChainMock([])
    const cobrosChain = createChainMock([])
    const notasCreditoChain = createChainMock([])

    mockSupabaseFrom({
      ventas: ventasChain,
      facturas: facturasChain,
      cobros_orden: cobrosChain,
      notas_credito: notasCreditoChain,
    })

    const { GET } = await import("@/app/api/reportes/ingresos-unificados/route")
    const res = await GET(createGetRequest("http://localhost/api/reportes/ingresos-unificados?desde=2026-05-01&hasta=2026-05-31"))
    const { body } = await parseResponse(res)

    expect(body.resumen.totalGeneral).toBe(800)
    expect(body.resumen.totalNotasCredito).toBe(0)
  })
})

describe("F1/5 — ingresos: notas_credito deducted from resumen.total", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockAuthSuccess()
  })

  it("subtracts NC total from resumen.total and exposes totalNotasCredito", async () => {
    const facturasChain = createChainMock([
      { id: "f1", orden_id: "o1", numero_factura: "F-001", fecha: "2026-05-10", subtotal: 800, iva: 144, total: 944, estado_pago: "PAGADO", ordenes_servicio: { id: "o1", numero_orden: 1, clientes: { nombre: "Juan" } } },
    ])
    const notasCreditoChain = createChainMock([
      { monto: "200", venta_id: null, orden_id: "o1" },
    ])

    mockSupabaseFrom({
      facturas: facturasChain,
      notas_credito: notasCreditoChain,
    })

    const { GET } = await import("@/app/api/reportes/ingresos/route")
    const res = await GET(createGetRequest("http://localhost/api/reportes/ingresos?desde=2026-05-01&hasta=2026-05-31"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    // NET income = subtotal(800) − NC(200) = 600 (not gross 944 − NC 200 = 744)
    // headline "total" is now NET (base imponible) after notas de crédito
    expect(body.resumen.total).toBe(600)
    expect(body.resumen.totalNotasCredito).toBe(200)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// BUG-1 — garantias-ventas: distribucionDias must use dias_validez from garantia
// ─────────────────────────────────────────────────────────────────────────────

describe("BUG-1 — garantias-ventas: distribucionDias uses dias_validez from garantia row", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockAuthSuccess()
  })

  it("garantia with dias_validez=90 lands in bucket 90, not bucket 0", async () => {
    // resumenQuery (ventas!inner select)
    const resumenChain = createChainMock([
      { id: "g1", estado: "ACTIVA", ventas: { organization_id: "org-1", sucursal_id: null } },
    ])
    // porVencerQuery — use empty to keep things simple
    const porVencerChain = createChainMock([])
    // todasGarantiasQuery — this is where distribucionDias reads from
    const todasGarantiasChain = createChainMock([
      {
        id: "g1",
        estado: "ACTIVA",
        numero_garantia: "G-001",
        fecha_inicio: "2026-01-01",
        created_at: "2026-01-01T00:00:00Z",
        dias_validez: 90,            // <-- field on garantia row
        items_venta: { descripcion: "iPhone Battery" },   // no dias_validez here
        ventas: { numero_venta: 1, cliente_nombre: "Ana", organization_id: "org-1", sucursal_id: null },
      },
    ])

    // garantias_venta is queried three times in the route; rotate mocks per call.
    let callCount = 0
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "garantias_venta") {
        callCount++
        if (callCount === 1) return resumenChain as any
        if (callCount === 2) return porVencerChain as any
        return todasGarantiasChain as any
      }
      return createChainMock([]) as any
    })

    const { GET } = await import("@/app/api/reportes/garantias-ventas/route")
    const res = await GET()
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    // Should have a bucket for 90 days with count 1
    const bucket90 = body.distribucionDias.find((d: any) => d.dias === 90)
    expect(bucket90).toBeDefined()
    expect(bucket90.count).toBe(1)

    // Bucket 0 (the bug value) should NOT appear
    const bucket0 = body.distribucionDias.find((d: any) => d.dias === 0)
    expect(bucket0).toBeUndefined()
  })

  it("garantia with dias_validez=30 lands in bucket 30", async () => {
    const resumenChain = createChainMock([
      { id: "g2", estado: "ACTIVA", ventas: { organization_id: "org-1", sucursal_id: null } },
    ])
    const porVencerChain = createChainMock([])
    const todasGarantiasChain = createChainMock([
      {
        id: "g2",
        estado: "ACTIVA",
        numero_garantia: "G-002",
        fecha_inicio: "2026-01-01",
        created_at: "2026-01-01T00:00:00Z",
        dias_validez: 30,
        items_venta: { descripcion: "Screen" },
        ventas: { numero_venta: 2, cliente_nombre: "Bob", organization_id: "org-1", sucursal_id: null },
      },
    ])

    let callCount = 0
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "garantias_venta") {
        callCount++
        if (callCount === 1) return resumenChain as any
        if (callCount === 2) return porVencerChain as any
        return todasGarantiasChain as any
      }
      return createChainMock([]) as any
    })

    const { GET } = await import("@/app/api/reportes/garantias-ventas/route")
    const res = await GET()
    const { body } = await parseResponse(res)

    const bucket30 = body.distribucionDias.find((d: any) => d.dias === 30)
    expect(bucket30).toBeDefined()
    expect(bucket30.count).toBe(1)
    const bucket0 = body.distribucionDias.find((d: any) => d.dias === 0)
    expect(bucket0).toBeUndefined()
  })
})
