/**
 * Tests for NET income (base imponible) reporting — B3 fiscal fix.
 *
 * IVA collected is a fiscal liability, not income. These tests verify that:
 *  - income totals use NET (subtotal / iva_neto) instead of gross (total)
 *  - a separate totalIva is exposed per report
 *  - EXENTO / Monotributo orgs (iva_neto = NULL, facturas.iva = 0/null) are a no-op:
 *    net == gross (COALESCE fallback)
 *  - cobros_orden remain gross (no IVA breakdown available on direct order payments)
 *  - notas_credito deduction from prior PR stacks on top of the NET change
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import {
  mockAuthSuccess,
  mockSupabaseFrom,
  createChainMock,
  createGetRequest,
  parseResponse,
} from "./helpers"

// ─────────────────────────────────────────────────────────────────────────────
// ingresos-unificados — NET aggregation + totalIva
// ─────────────────────────────────────────────────────────────────────────────

describe("NET income — ingresos-unificados: IVA-active org", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockAuthSuccess()
  })

  it("venta net=100 iva=21 + factura subtotal=100 iva=21 → totalGeneral=200, totalIva=42", async () => {
    // Venta: total=121, iva_neto=100, iva_monto=21
    const ventasChain = createChainMock([
      {
        id: "v1",
        numero_venta: 1,
        cliente_nombre: "Ana",
        total: "121",
        iva_neto: "100",
        iva_monto: "21",
        descuento: "0",
        metodo_pago: "EFECTIVO",
        estado: "COMPLETADA",
        created_at: "2026-05-10T00:00:00Z",
      },
    ])
    // Factura: total=121, subtotal=100, iva=21
    const facturasChain = createChainMock([
      {
        id: "f1",
        numero_factura: "F-001",
        total: "121",
        subtotal: "100",
        iva: "21",
        estado_pago: "PAGADO",
        fecha: "2026-05-10",
        orden_id: "o1",
        ordenes_servicio: {
          id: "o1",
          organization_id: "org-1",
          sucursal_id: null,
          clientes: { nombre: "Carlos" },
        },
      },
    ])
    const cobrosChain = createChainMock([])
    const notasCreditoChain = createChainMock([])

    mockSupabaseFrom({
      ventas: ventasChain,
      facturas: facturasChain,
      cobros_orden: cobrosChain,
      notas_credito: notasCreditoChain,
    })

    const { GET } = await import("@/app/api/reportes/ingresos-unificados/route")
    const res = await GET(
      createGetRequest(
        "http://localhost/api/reportes/ingresos-unificados?desde=2026-05-01&hasta=2026-05-31"
      )
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    // NET: venta 100 + factura 100 = 200
    expect(body.resumen.totalGeneral).toBe(200)
    // IVA: 21 + 21 = 42
    expect(body.resumen.totalIva).toBe(42)
  })

  it("cobros_orden stay gross — no IVA breakdown on direct order payments", async () => {
    // One cobro of 121 — should be counted at face value; no IVA extracted
    const ventasChain = createChainMock([])
    const facturasChain = createChainMock([])
    const cobrosChain = createChainMock([
      {
        id: "c1",
        monto: "121",
        created_at: "2026-05-10T00:00:00Z",
        orden_id: "o1",
        metodo_pago: "EFECTIVO",
        ordenes_servicio: {
          id: "o1",
          organization_id: "org-1",
          sucursal_id: null,
          numero_orden: 1,
          codigo_orden: "OD-001",
          clientes: { nombre: "Juan" },
        },
      },
    ])
    const notasCreditoChain = createChainMock([])

    mockSupabaseFrom({
      ventas: ventasChain,
      facturas: facturasChain,
      cobros_orden: cobrosChain,
      notas_credito: notasCreditoChain,
    })

    const { GET } = await import("@/app/api/reportes/ingresos-unificados/route")
    const res = await GET(
      createGetRequest(
        "http://localhost/api/reportes/ingresos-unificados?desde=2026-05-01&hasta=2026-05-31"
      )
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    // cobro at face value
    expect(body.resumen.totalGeneral).toBe(121)
    // cobros contribute 0 to totalIva (no breakdown)
    expect(body.resumen.totalIva).toBe(0)
  })

  it("NC deduction stacks on NET: venta net=100 + factura net=100 - NC=50 → totalGeneral=150", async () => {
    const ventasChain = createChainMock([
      {
        id: "v1",
        numero_venta: 1,
        cliente_nombre: "Ana",
        total: "121",
        iva_neto: "100",
        iva_monto: "21",
        descuento: "0",
        metodo_pago: "EFECTIVO",
        estado: "COMPLETADA",
        created_at: "2026-05-10T00:00:00Z",
      },
    ])
    const facturasChain = createChainMock([
      {
        id: "f1",
        numero_factura: "F-001",
        total: "121",
        subtotal: "100",
        iva: "21",
        estado_pago: "PAGADO",
        fecha: "2026-05-10",
        orden_id: "o1",
        ordenes_servicio: {
          id: "o1",
          organization_id: "org-1",
          sucursal_id: null,
          clientes: { nombre: "Carlos" },
        },
      },
    ])
    const cobrosChain = createChainMock([])
    const notasCreditoChain = createChainMock([{ monto: "50" }])

    mockSupabaseFrom({
      ventas: ventasChain,
      facturas: facturasChain,
      cobros_orden: cobrosChain,
      notas_credito: notasCreditoChain,
    })

    const { GET } = await import("@/app/api/reportes/ingresos-unificados/route")
    const res = await GET(
      createGetRequest(
        "http://localhost/api/reportes/ingresos-unificados?desde=2026-05-01&hasta=2026-05-31"
      )
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    // net 200 - NC 50 = 150
    expect(body.resumen.totalGeneral).toBe(150)
    expect(body.resumen.totalNotasCredito).toBe(50)
    expect(body.resumen.totalIva).toBe(42)
  })
})

describe("NET income — ingresos-unificados: EXENTO no-op", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockAuthSuccess()
  })

  it("EXENTO org: iva_neto=null → COALESCE uses total; factura iva=0 → net==gross; totalIva=0", async () => {
    // EXENTO venta: total=100, iva_neto=NULL (legacy/exento)
    const ventasChain = createChainMock([
      {
        id: "v1",
        numero_venta: 1,
        cliente_nombre: "Ana",
        total: "100",
        iva_neto: null,
        iva_monto: null,
        descuento: "0",
        metodo_pago: "EFECTIVO",
        estado: "COMPLETADA",
        created_at: "2026-05-10T00:00:00Z",
      },
    ])
    // EXENTO factura: total=100, subtotal=100, iva=0
    const facturasChain = createChainMock([
      {
        id: "f1",
        numero_factura: "F-001",
        total: "100",
        subtotal: "100",
        iva: 0,
        estado_pago: "PAGADO",
        fecha: "2026-05-10",
        orden_id: "o1",
        ordenes_servicio: {
          id: "o1",
          organization_id: "org-1",
          sucursal_id: null,
          clientes: { nombre: "Carlos" },
        },
      },
    ])
    const cobrosChain = createChainMock([])
    const notasCreditoChain = createChainMock([])

    mockSupabaseFrom({
      ventas: ventasChain,
      facturas: facturasChain,
      cobros_orden: cobrosChain,
      notas_credito: notasCreditoChain,
    })

    const { GET } = await import("@/app/api/reportes/ingresos-unificados/route")
    const res = await GET(
      createGetRequest(
        "http://localhost/api/reportes/ingresos-unificados?desde=2026-05-01&hasta=2026-05-31"
      )
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    // net == gross for EXENTO: 100 + 100 = 200
    expect(body.resumen.totalGeneral).toBe(200)
    // No IVA collected
    expect(body.resumen.totalIva).toBe(0)
  })

  it("EXENTO org with null iva field on factura: treated as 0", async () => {
    const ventasChain = createChainMock([])
    const facturasChain = createChainMock([
      {
        id: "f1",
        numero_factura: "F-001",
        total: "100",
        subtotal: "100",
        iva: null, // null iva — treat as 0
        estado_pago: "PAGADO",
        fecha: "2026-05-10",
        orden_id: "o1",
        ordenes_servicio: {
          id: "o1",
          organization_id: "org-1",
          sucursal_id: null,
          clientes: { nombre: "Carlos" },
        },
      },
    ])
    const cobrosChain = createChainMock([])
    const notasCreditoChain = createChainMock([])

    mockSupabaseFrom({
      ventas: ventasChain,
      facturas: facturasChain,
      cobros_orden: cobrosChain,
      notas_credito: notasCreditoChain,
    })

    const { GET } = await import("@/app/api/reportes/ingresos-unificados/route")
    const res = await GET(
      createGetRequest(
        "http://localhost/api/reportes/ingresos-unificados?desde=2026-05-01&hasta=2026-05-31"
      )
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.resumen.totalGeneral).toBe(100)
    expect(body.resumen.totalIva).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// ingresos (facturas only) — NET income uses subtotal, totalIva = sum(iva)
// ─────────────────────────────────────────────────────────────────────────────

describe("NET income — ingresos: income uses subtotal, not total", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockAuthSuccess()
  })

  it("factura subtotal=100, iva=21, total=121 → resumen.total=100, totalIva=21", async () => {
    const facturasChain = createChainMock([
      {
        id: "f1",
        orden_id: "o1",
        numero_factura: "F-001",
        fecha: "2026-05-10",
        subtotal: 100,
        iva: 21,
        total: 121,
        estado_pago: "PAGADO",
        ordenes_servicio: {
          id: "o1",
          numero_orden: 1,
          clientes: { nombre: "Juan" },
        },
      },
    ])
    const notasCreditoChain = createChainMock([])

    mockSupabaseFrom({
      facturas: facturasChain,
      notas_credito: notasCreditoChain,
    })

    const { GET } = await import("@/app/api/reportes/ingresos/route")
    const res = await GET(
      createGetRequest(
        "http://localhost/api/reportes/ingresos?desde=2026-05-01&hasta=2026-05-31"
      )
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    // NET income = subtotal = 100 (not gross 121)
    expect(body.resumen.total).toBe(100)
    expect(body.resumen.totalIva).toBe(21)
    expect(body.resumen.totalNotasCredito).toBe(0)
  })

  it("EXENTO factura: subtotal=100, iva=0 → resumen.total=100 (no-op vs old gross)", async () => {
    const facturasChain = createChainMock([
      {
        id: "f1",
        orden_id: "o1",
        numero_factura: "F-001",
        fecha: "2026-05-10",
        subtotal: 100,
        iva: 0,
        total: 100,
        estado_pago: "PAGADO",
        ordenes_servicio: {
          id: "o1",
          numero_orden: 1,
          clientes: { nombre: "Juan" },
        },
      },
    ])
    const notasCreditoChain = createChainMock([])

    mockSupabaseFrom({
      facturas: facturasChain,
      notas_credito: notasCreditoChain,
    })

    const { GET } = await import("@/app/api/reportes/ingresos/route")
    const res = await GET(
      createGetRequest(
        "http://localhost/api/reportes/ingresos?desde=2026-05-01&hasta=2026-05-31"
      )
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.resumen.total).toBe(100)
    expect(body.resumen.totalIva).toBe(0)
  })

  it("NC stacks on NET: subtotal=100, iva=21, NC=20 → total=80, totalIva=21", async () => {
    const facturasChain = createChainMock([
      {
        id: "f1",
        orden_id: "o1",
        numero_factura: "F-001",
        fecha: "2026-05-10",
        subtotal: 100,
        iva: 21,
        total: 121,
        estado_pago: "PAGADO",
        ordenes_servicio: {
          id: "o1",
          numero_orden: 1,
          clientes: { nombre: "Juan" },
        },
      },
    ])
    const notasCreditoChain = createChainMock([{ monto: "20" }])

    mockSupabaseFrom({
      facturas: facturasChain,
      notas_credito: notasCreditoChain,
    })

    const { GET } = await import("@/app/api/reportes/ingresos/route")
    const res = await GET(
      createGetRequest(
        "http://localhost/api/reportes/ingresos?desde=2026-05-01&hasta=2026-05-31"
      )
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    // NET 100 - NC 20 = 80
    expect(body.resumen.total).toBe(80)
    expect(body.resumen.totalIva).toBe(21)
    expect(body.resumen.totalNotasCredito).toBe(20)
  })
})
