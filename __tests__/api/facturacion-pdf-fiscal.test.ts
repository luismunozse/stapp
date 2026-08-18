// @vitest-environment node
/**
 * Covers GET /api/facturacion/[id]/pdf mapping the six fiscal identity /
 * collection org fields (migration 295) into FacturaPDFData — RC Task 6:
 * cuitEmpresa, condicionIvaEmpresa, domicilioFiscalEmpresa, cbuAlias,
 * mediosPago (from medios_pago_texto), and vencimiento (computed from
 * fecha + plazo_pago_dias, only when plazo_pago_dias is set).
 *
 * generateFacturaPDF is mocked out entirely — these tests assert on the
 * pdfData object the route builds and hands to it, not on rendered PDF
 * bytes (that's already covered by __tests__/lib/factura-pdf-venta.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, createGetRequest } from "./helpers"
import { addDaysInTimeZone } from "@/lib/timezone"

const generateFacturaPDF = vi.fn().mockResolvedValue(Buffer.from("fake-pdf"))
vi.mock("@/lib/pdf", () => ({
  generateFacturaPDF: (...args: any[]) => generateFacturaPDF(...args),
}))

function baseFacturaOrdenRow(orgOverrides: Record<string, any> = {}) {
  return {
    id: "f1",
    orden_id: "orden-1",
    venta_id: null,
    numero_factura: "0001-00000001",
    fecha: "2026-08-11T00:00:00.000Z",
    estado_pago: "PENDIENTE",
    subtotal: "100",
    iva: "0",
    total: "100",
    monto_abonado: "0",
    pagos_parciales: [],
    ordenes_servicio: {
      id: "orden-1",
      numero_orden: 1,
      codigo_orden: "CEL001",
      dispositivo: "iPhone",
      organization_id: "org-1",
      sucursal_id: null,
      fecha_ingreso: "2026-08-01T00:00:00.000Z",
      clientes: { nombre: "Ana", telefono: null, email: null, direccion: null, dni: null },
      organizations: {
        nombre: "Taller Test",
        nombre_mostrar: "Taller Test",
        telefono: "123",
        direccion: "Calle 1",
        logo_url: null,
        moneda: "ARS",
        zona_horaria: "America/Argentina/Buenos_Aires",
        cuit: null,
        condicion_iva: null,
        domicilio_fiscal: null,
        cbu_alias: null,
        medios_pago_texto: null,
        plazo_pago_dias: null,
        ingresos_brutos: null,
        inicio_actividades: null,
        ...orgOverrides,
      },
    },
  }
}

function baseFacturaVentaRow(orgOverrides: Record<string, any> = {}) {
  return {
    id: "f2",
    orden_id: null,
    venta_id: "venta-1",
    numero_factura: "0001-00000002",
    fecha: "2026-08-11T00:00:00.000Z",
    estado_pago: "PAGADO",
    subtotal: "100",
    iva: "0",
    total: "100",
    monto_abonado: "100",
    ventas: {
      id: "venta-1",
      numero_venta: 5,
      cliente_nombre: "Consumidor Final",
      descuento: "0",
      redondeo_monto: "0",
      organization_id: "org-1",
      sucursal_id: null,
      created_at: "2026-08-10T00:00:00.000Z",
      organizations: {
        nombre: "Taller Test",
        nombre_mostrar: "Taller Test",
        telefono: "123",
        direccion: "Calle 1",
        logo_url: null,
        moneda: "ARS",
        zona_horaria: "America/Argentina/Buenos_Aires",
        cuit: null,
        condicion_iva: null,
        domicilio_fiscal: null,
        cbu_alias: null,
        medios_pago_texto: null,
        plazo_pago_dias: null,
        ingresos_brutos: null,
        inicio_actividades: null,
        ...orgOverrides,
      },
    },
  }
}

describe("GET /api/facturacion/[id]/pdf — datos fiscales y de cobro", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
  })

  it("maps fiscal identity fields and computes vencimiento from fecha + plazo_pago_dias (orden origin)", async () => {
    const facturaRow = baseFacturaOrdenRow({
      cuit: "30-71234567-8",
      condicion_iva: "Responsable Inscripto",
      domicilio_fiscal: "Av. Siempreviva 742",
      cbu_alias: "taller.alias.mp",
      medios_pago_texto: "Efectivo, transferencia",
      plazo_pago_dias: 15,
    })
    mockSupabaseFrom({
      facturas: createChainMock(facturaRow),
      items_factura: createChainMock([]),
    })

    const { GET } = await import("@/app/api/facturacion/[id]/pdf/route")
    await GET(createGetRequest(), { params: Promise.resolve({ id: "f1" }) })

    expect(generateFacturaPDF).toHaveBeenCalledTimes(1)
    const pdfData = generateFacturaPDF.mock.calls[0][0]
    expect(pdfData.cuitEmpresa).toBe("30-71234567-8")
    expect(pdfData.condicionIvaEmpresa).toBe("Responsable Inscripto")
    expect(pdfData.domicilioFiscalEmpresa).toBe("Av. Siempreviva 742")
    expect(pdfData.cbuAlias).toBe("taller.alias.mp")
    expect(pdfData.mediosPago).toBe("Efectivo, transferencia")
    expect(pdfData.vencimiento).toBe(
      addDaysInTimeZone(15, "America/Argentina/Buenos_Aires", new Date(facturaRow.fecha))
    )
  })

  it("leaves vencimiento absent when plazo_pago_dias is not set (orden origin)", async () => {
    const facturaRow = baseFacturaOrdenRow({ cuit: "30-71234567-8" })
    mockSupabaseFrom({
      facturas: createChainMock(facturaRow),
      items_factura: createChainMock([]),
    })

    const { GET } = await import("@/app/api/facturacion/[id]/pdf/route")
    await GET(createGetRequest(), { params: Promise.resolve({ id: "f1" }) })

    const pdfData = generateFacturaPDF.mock.calls[0][0]
    expect(pdfData.cuitEmpresa).toBe("30-71234567-8")
    expect(pdfData.vencimiento).toBeFalsy()
  })

  it("maps fiscal identity fields for a venta-sourced remito", async () => {
    const facturaRow = baseFacturaVentaRow({
      cuit: "30-11111111-1",
      condicion_iva: "Monotributo",
      medios_pago_texto: "Tarjeta",
      plazo_pago_dias: 7,
    })
    mockSupabaseFrom({
      facturas: createChainMock(facturaRow),
      items_factura: createChainMock([]),
    })

    const { GET } = await import("@/app/api/facturacion/[id]/pdf/route")
    await GET(createGetRequest(), { params: Promise.resolve({ id: "f2" }) })

    const pdfData = generateFacturaPDF.mock.calls[0][0]
    expect(pdfData.cuitEmpresa).toBe("30-11111111-1")
    expect(pdfData.condicionIvaEmpresa).toBe("Monotributo")
    expect(pdfData.mediosPago).toBe("Tarjeta")
    expect(pdfData.vencimiento).toBe(
      addDaysInTimeZone(7, "America/Argentina/Buenos_Aires", new Date(facturaRow.fecha))
    )
  })

  it("degrades gracefully when migration 295 hasn't run (42703 on the fiscal columns), still generating the PDF without fiscal fields", async () => {
    const baseRow = { id: "f1", orden_id: "orden-1", venta_id: null }
    const fullRowNoFiscal = baseFacturaOrdenRow()
    // organizations embed in fullRowNoFiscal still has the fiscal keys (all
    // null) because that's how the fixture is built, but that's fine — the
    // route's fallback query wouldn't ask PostgREST for them at all in a
    // real DB; here we only need dbError to surface the failure once, then
    // succeed. This whole route is SELECT-only (no .update() anywhere), so
    // a real missing-column error here is Postgres' 42703 ("column ... does
    // not exist"), not PGRST204 — PGRST204 is specific to write payloads
    // naming an unknown column, which never happens on a GET.
    const chain = createChainMock()
    chain.single = vi
      .fn()
      .mockResolvedValueOnce({ data: baseRow, error: null }) // base lookup (id, orden_id, venta_id)
      .mockResolvedValueOnce({ data: null, error: { code: "42703", message: "column organizations.cuit does not exist" } }) // fiscal-embed query fails
      .mockResolvedValueOnce({ data: fullRowNoFiscal, error: null }) // fallback query succeeds
    mockSupabaseFrom({
      facturas: chain,
      items_factura: createChainMock([]),
    })

    const { GET } = await import("@/app/api/facturacion/[id]/pdf/route")
    const res = await GET(createGetRequest(), { params: Promise.resolve({ id: "f1" }) })

    expect(res.status).toBe(200)
    expect(generateFacturaPDF).toHaveBeenCalledTimes(1)
    const pdfData = generateFacturaPDF.mock.calls[0][0]
    expect(pdfData.numeroFactura).toBe("0001-00000001")
  })

  it("maps ingresos brutos and inicio actividades (migration 297 applied)", async () => {
    const facturaRow = baseFacturaOrdenRow({
      cuit: "30-71234567-8",
      condicion_iva: "Responsable Inscripto",
      ingresos_brutos: "902-123456-7",
      inicio_actividades: "01/2020",
    })
    mockSupabaseFrom({
      facturas: createChainMock(facturaRow),
      items_factura: createChainMock([]),
    })

    const { GET } = await import("@/app/api/facturacion/[id]/pdf/route")
    await GET(createGetRequest(), { params: Promise.resolve({ id: "f1" }) })

    const pdfData = generateFacturaPDF.mock.calls[0][0]
    expect(pdfData.ingresosBrutosEmpresa).toBe("902-123456-7")
    expect(pdfData.inicioActividadesEmpresa).toBe("01/2020")
  })

  it("degrades gracefully when migration 297 hasn't run (42703 on ingresos_brutos), keeping the 295 fiscal fields intact", async () => {
    const baseRow = { id: "f1", orden_id: "orden-1", venta_id: null }
    const tier1Row = baseFacturaOrdenRow({
      cuit: "30-71234567-8",
      condicion_iva: "Responsable Inscripto",
    })
    const chain = createChainMock()
    chain.single = vi
      .fn()
      .mockResolvedValueOnce({ data: baseRow, error: null }) // base lookup (id, orden_id, venta_id)
      .mockResolvedValueOnce({
        data: null,
        error: { code: "42703", message: "column organizations.ingresos_brutos does not exist" },
      }) // tier 2 (295 + 297 cols) fails
      .mockResolvedValueOnce({ data: tier1Row, error: null }) // tier 1 (295-only cols) succeeds
    mockSupabaseFrom({
      facturas: chain,
      items_factura: createChainMock([]),
    })

    const { GET } = await import("@/app/api/facturacion/[id]/pdf/route")
    const res = await GET(createGetRequest(), { params: Promise.resolve({ id: "f1" }) })

    expect(res.status).toBe(200)
    expect(generateFacturaPDF).toHaveBeenCalledTimes(1)
    const pdfData = generateFacturaPDF.mock.calls[0][0]
    expect(pdfData.cuitEmpresa).toBe("30-71234567-8")
    expect(pdfData.condicionIvaEmpresa).toBe("Responsable Inscripto")
    expect(pdfData.ingresosBrutosEmpresa).toBeFalsy()
    expect(pdfData.inicioActividadesEmpresa).toBeFalsy()
  })

  it("degrades gracefully when migration 295 hasn't run either (42703 on both fiscal tiers), falling back to base org columns", async () => {
    const baseRow = { id: "f1", orden_id: "orden-1", venta_id: null }
    const tier0Row = baseFacturaOrdenRow()
    const chain = createChainMock()
    chain.single = vi
      .fn()
      .mockResolvedValueOnce({ data: baseRow, error: null }) // base lookup (id, orden_id, venta_id)
      .mockResolvedValueOnce({
        data: null,
        error: { code: "42703", message: "column organizations.ingresos_brutos does not exist" },
      }) // tier 2 (295 + 297 cols) fails
      .mockResolvedValueOnce({
        data: null,
        error: { code: "42703", message: "column organizations.cuit does not exist" },
      }) // tier 1 (295-only cols) fails too
      .mockResolvedValueOnce({ data: tier0Row, error: null }) // tier 0 (base cols) succeeds
    mockSupabaseFrom({
      facturas: chain,
      items_factura: createChainMock([]),
    })

    const { GET } = await import("@/app/api/facturacion/[id]/pdf/route")
    const res = await GET(createGetRequest(), { params: Promise.resolve({ id: "f1" }) })

    expect(res.status).toBe(200)
    expect(generateFacturaPDF).toHaveBeenCalledTimes(1)
    const pdfData = generateFacturaPDF.mock.calls[0][0]
    expect(pdfData.cuitEmpresa).toBeFalsy()
    expect(pdfData.ingresosBrutosEmpresa).toBeFalsy()
  })
})
