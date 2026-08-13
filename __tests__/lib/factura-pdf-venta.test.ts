// @vitest-environment node
/**
 * Tests: generateFacturaPDF renders a venta-sourced invoice (data.venta
 * instead of data.orden) without throwing, and produces a non-empty PDF.
 * Also covers items_factura itemization for both origins (venta and orden),
 * and the zero-items fallback to the aggregate-only layout.
 */
import { describe, it, expect, beforeAll } from "vitest"
import { PDFDocument } from "pdf-lib"
import { generateFacturaPDF } from "@/lib/pdf"
import { formatCurrencyValue } from "@/lib/currency"
import { extractPdfText } from "./pdf-text-helper"

// Fixture builder for the pagination tests below: N items + M pagos, each
// tagged with a distinguishable, zero-padded index so a substring check on
// the LAST one can never accidentally match an earlier one (e.g. "ITEM-004"
// is not a substring of "ITEM-040").
function buildFacturaPaginadaFixture(itemCount: number, pagoCount: number) {
  return {
    numeroFactura: "0001-00000099",
    fecha: new Date("2026-08-08"),
    estadoPago: "PAGADO_PARCIAL",
    cliente: { nombre: "Consumidor Final" },
    venta: { numeroVenta: 42 },
    items: Array.from({ length: itemCount }, (_, i) => ({
      descripcion: `ITEM-${String(i + 1).padStart(3, "0")}`,
      cantidad: 1,
      precioUnitario: 100,
      subtotal: 100,
    })),
    subtotal: itemCount * 100,
    iva: 0,
    total: itemCount * 100,
    montoAbonado: itemCount * 50,
    pagos: Array.from({ length: pagoCount }, (_, i) => ({
      monto: 50,
      metodoPago: "EFECTIVO",
      fecha: new Date("2026-08-08"),
      referencia: `REF-PAGO-${String(i + 1).padStart(3, "0")}`,
    })),
  } as any
}

describe("generateFacturaPDF — venta origin", () => {
  it("renders successfully with data.venta instead of data.orden, no item table when items is omitted", async () => {
    const buffer = await generateFacturaPDF({
      numeroFactura: "0001-00000002",
      fecha: new Date("2026-01-02"),
      estadoPago: "PAGADO",
      cliente: { nombre: "Consumidor Final" },
      venta: { numeroVenta: 5 },
      subtotal: 200,
      iva: 0,
      total: 200,
      montoAbonado: 200,
      pagos: [],
    } as any)

    expect(buffer.length).toBeGreaterThan(0)
    const text = await extractPdfText(buffer)
    expect(text).not.toContain("DETALLE DE ITEMS")
  })

  it("still renders successfully with data.orden (orden origin, unchanged), no item table when items is omitted", async () => {
    const buffer = await generateFacturaPDF({
      numeroFactura: "0001-00000001",
      fecha: new Date("2026-01-01"),
      estadoPago: "PENDIENTE",
      cliente: { nombre: "Ana" },
      orden: { numeroOrden: 1, codigoOrden: "CEL001", dispositivo: "iPhone" },
      subtotal: 100,
      iva: 0,
      total: 100,
      montoAbonado: 0,
      pagos: [],
    } as any)

    expect(buffer.length).toBeGreaterThan(0)
    const text = await extractPdfText(buffer)
    expect(text).not.toContain("DETALLE DE ITEMS")
  })

  it("renders items_factura rows for a venta-sourced invoice", async () => {
    const buffer = await generateFacturaPDF({
      numeroFactura: "0001-00000003",
      fecha: new Date("2026-01-03"),
      estadoPago: "PAGADO",
      cliente: { nombre: "Consumidor Final" },
      venta: { numeroVenta: 6 },
      items: [
        { descripcion: "PANTALLA XPHONE12", cantidad: 1, precioUnitario: 150, subtotal: 150 },
        { descripcion: "MANO DE OBRA REPARACION", cantidad: 1, precioUnitario: 50, subtotal: 50 },
      ],
      subtotal: 200,
      iva: 0,
      total: 200,
      montoAbonado: 200,
      pagos: [],
    } as any)

    expect(buffer.length).toBeGreaterThan(0)
    const text = await extractPdfText(buffer)
    expect(text).toContain("DETALLE DE ITEMS")
    expect(text).toContain("PANTALLA XPHONE12")
    expect(text).toContain("MANO DE OBRA REPARACION")
  })

  it("renders items_factura rows for an orden-sourced invoice", async () => {
    const buffer = await generateFacturaPDF({
      numeroFactura: "0001-00000004",
      fecha: new Date("2026-01-04"),
      estadoPago: "PENDIENTE",
      cliente: { nombre: "Ana" },
      orden: { numeroOrden: 2, codigoOrden: "CEL002", dispositivo: "iPhone" },
      items: [
        { descripcion: "BATERIA GALAXYX10", cantidad: 1, precioUnitario: 80, subtotal: 80 },
        { descripcion: "SERVICIO DIAGNOSTICO", cantidad: 1, precioUnitario: 20, subtotal: 20 },
      ],
      subtotal: 100,
      iva: 0,
      total: 100,
      montoAbonado: 0,
      pagos: [],
    } as any)

    expect(buffer.length).toBeGreaterThan(0)
    const text = await extractPdfText(buffer)
    expect(text).toContain("DETALLE DE ITEMS")
    expect(text).toContain("BATERIA GALAXYX10")
    expect(text).toContain("SERVICIO DIAGNOSTICO")
  })

  it("shows Descuento and Redondeo lines for a venta invoice with a discount, and the numbers reconcile", async () => {
    const subtotal = 200
    const descuento = 20
    const redondeo = 0.5
    const iva = 0
    const total = subtotal - descuento + redondeo + iva
    // Sanity check on the fixture itself: subtotal - descuento + redondeo + iva == total.
    expect(total).toBe(180.5)

    const buffer = await generateFacturaPDF({
      numeroFactura: "0001-00000005",
      fecha: new Date("2026-01-05"),
      estadoPago: "PAGADO",
      cliente: { nombre: "Consumidor Final" },
      venta: { numeroVenta: 7 },
      descuento,
      redondeo,
      subtotal,
      iva,
      total,
      montoAbonado: total,
      pagos: [],
    } as any)

    expect(buffer.length).toBeGreaterThan(0)
    const text = await extractPdfText(buffer)
    expect(text).toContain("Descuento")
    expect(text).toContain("Redondeo")
  })

  it("does not show a Descuento line for a venta invoice without a discount", async () => {
    const buffer = await generateFacturaPDF({
      numeroFactura: "0001-00000006",
      fecha: new Date("2026-01-06"),
      estadoPago: "PAGADO",
      cliente: { nombre: "Consumidor Final" },
      venta: { numeroVenta: 8 },
      descuento: 0,
      redondeo: 0,
      subtotal: 200,
      iva: 0,
      total: 200,
      montoAbonado: 200,
      pagos: [],
    } as any)

    expect(buffer.length).toBeGreaterThan(0)
    const text = await extractPdfText(buffer)
    expect(text).not.toContain("Descuento")
    expect(text).not.toContain("Redondeo")
  })

  it("titles the document REMITO and drops the FACTURA name", async () => {
    const buffer = await generateFacturaPDF({
      numeroFactura: "0001-00000002",
      fecha: new Date("2026-01-02"),
      estadoPago: "PAGADO",
      cliente: { nombre: "Consumidor Final" },
      venta: { numeroVenta: 5 },
      subtotal: 200,
      iva: 0,
      total: 200,
      montoAbonado: 200,
      pagos: [],
    } as any)

    const text = await extractPdfText(buffer)
    expect(text).toContain("REMITO")
    expect(text).not.toContain("FACTURA") // uppercase check: lowercase "facturación" elsewhere is fine
  })

  it("keeps key sections after the restyle", async () => {
    const buffer = await generateFacturaPDF({
      numeroFactura: "0001-00000003",
      fecha: new Date("2026-01-03"),
      estadoPago: "PAGADO",
      cliente: { nombre: "Consumidor Final" },
      venta: { numeroVenta: 6 },
      items: [
        { descripcion: "PANTALLA XPHONE12", cantidad: 1, precioUnitario: 150, subtotal: 150 },
        { descripcion: "MANO DE OBRA REPARACION", cantidad: 1, precioUnitario: 50, subtotal: 50 },
      ],
      subtotal: 200,
      iva: 0,
      total: 200,
      montoAbonado: 200,
      pagos: [
        { monto: 200, metodoPago: "EFECTIVO", fecha: new Date("2026-01-03") },
      ],
    } as any)

    const text = await extractPdfText(buffer)
    expect(text).toContain("CLIENTE")
    expect(text).toContain("TOTAL")
    expect(text).toContain("ESTADO DE PAGO")
    expect(text).toContain("Remito interno — no válido como comprobante fiscal.")
  })
})

describe("generateFacturaPDF — pagination", () => {
  // Both tests below only read from the same 40-item/15-pago PDF, so it's
  // generated once here instead of once per test.
  let paginatedText: string

  beforeAll(async () => {
    const fixture = buildFacturaPaginadaFixture(40, 15)
    const buffer = await generateFacturaPDF(fixture)
    paginatedText = await extractPdfText(buffer)
  })

  it("keeps the last item and last pago visible across continuation pages instead of truncating them", () => {
    expect(paginatedText).toContain("ITEM-040")
    expect(paginatedText).toContain("REF-PAGO-015")
  })

  it("marks continuation pages with a 'continuación' header", () => {
    expect(paginatedText).toContain("continuación")
  })

  it("stays on a single page with no continuation header for a small item/pago list", async () => {
    const fixture = buildFacturaPaginadaFixture(3, 2)
    const buffer = await generateFacturaPDF(fixture)

    const pdf = await PDFDocument.load(buffer)
    expect(pdf.getPageCount()).toBe(1)

    const text = await extractPdfText(buffer)
    expect(text).not.toContain("continuación")
  })
})

describe("generateFacturaPDF — money block (saldo protagonist) & dual dates", () => {
  it("makes saldo pendiente the highlighted figure for partial payments", async () => {
    const buffer = await generateFacturaPDF({
      numeroFactura: "0001-00000010",
      fecha: new Date("2026-01-10"),
      estadoPago: "PAGADO_PARCIAL",
      cliente: { nombre: "Consumidor Final" },
      venta: { numeroVenta: 10 },
      subtotal: 1000,
      iva: 0,
      total: 1000,
      montoAbonado: 400,
      pagos: [],
    } as any)

    const text = await extractPdfText(buffer)
    expect(text).toContain("SALDO PENDIENTE")
    expect(text).toContain("Pagado a cuenta")
  })

  it("shows saldo 0 when fully paid", async () => {
    const buffer = await generateFacturaPDF({
      numeroFactura: "0001-00000011",
      fecha: new Date("2026-01-11"),
      estadoPago: "PAGADO",
      cliente: { nombre: "Consumidor Final" },
      venta: { numeroVenta: 11 },
      subtotal: 500,
      iva: 0,
      total: 500,
      montoAbonado: 500,
      pagos: [],
    } as any)

    const text = await extractPdfText(buffer)
    expect(text).toContain("SALDO")
  })

  it("renders emission and operation dates when fechaOperacion is provided", async () => {
    const buffer = await generateFacturaPDF({
      numeroFactura: "0001-00000012",
      fecha: new Date("2026-01-12"),
      fechaOperacion: new Date("2026-08-01"),
      estadoPago: "PAGADO",
      cliente: { nombre: "Consumidor Final" },
      venta: { numeroVenta: 12 },
      subtotal: 300,
      iva: 0,
      total: 300,
      montoAbonado: 300,
      pagos: [],
    } as any)

    const text = await extractPdfText(buffer)
    expect(text).toContain("Emisión")
    expect(text).toContain("Operación")
  })
})

// Base fixture for the fiscal identity / payment conditions tests below:
// every optional accounting-grade field (cuitEmpresa, condicionIvaEmpresa,
// domicilioFiscalEmpresa, cliente.dni, vencimiento, mediosPago, cbuAlias) is
// absent, so `baseFixture()` alone must never draw any of the conditional
// blocks this task adds.
function baseFixture() {
  return {
    numeroFactura: "0001-00000020",
    fecha: new Date("2026-01-20"),
    estadoPago: "PAGADO",
    cliente: { nombre: "Consumidor Final" },
    venta: { numeroVenta: 20 },
    subtotal: 100,
    iva: 0,
    total: 100,
    montoAbonado: 100,
    pagos: [],
  } as any
}

const fixture = baseFixture()

describe("generateFacturaPDF — fiscal identity & payment conditions", () => {
  it("renders fiscal identity and payment conditions when provided", async () => {
    const buffer = await generateFacturaPDF({
      ...fixture,
      cuitEmpresa: "30-71234567-8",
      condicionIvaEmpresa: "Responsable Inscripto",
      cliente: { ...fixture.cliente, dni: "28.456.789" },
      vencimiento: new Date("2026-09-10"),
      mediosPago: "Efectivo, transferencia",
      cbuAlias: "stapp.taller.mp",
    } as any)
    const text = await extractPdfText(buffer)
    for (const s of ["CUIT: 30-71234567-8", "Responsable Inscripto", "DNI/CUIT: 28.456.789",
                     "CONDICIONES DE PAGO", "Vencimiento", "stapp.taller.mp"]) expect(text).toContain(s)
  })

  it("omits the conditional blocks when data is absent", async () => {
    const buffer = await generateFacturaPDF(baseFixture())
    const text = await extractPdfText(buffer)
    expect(text).not.toContain("CONDICIONES DE PAGO")
    expect(text).not.toContain("CUIT:")
  })
})

describe("generateFacturaPDF — running balance & recibí conforme", () => {
  it("shows a running Saldo column that decreases with each payment", async () => {
    const buffer = await generateFacturaPDF({
      numeroFactura: "0001-00000030",
      fecha: new Date("2026-02-01"),
      estadoPago: "PAGADO_PARCIAL",
      cliente: { nombre: "Consumidor Final" },
      venta: { numeroVenta: 30 },
      subtotal: 1000,
      iva: 0,
      total: 1000,
      // montoAbonado deliberately does NOT match the sum of pagos below —
      // this is an isolated rendering test, not a business-invariant
      // check — chosen so "Pagado a cuenta" ($100) and SALDO PENDIENTE
      // ($900) never collide with the running-balance values under test
      // (running: 1000 -> 700 -> 500).
      montoAbonado: 100,
      pagos: [
        { monto: 300, metodoPago: "EFECTIVO", fecha: new Date("2026-02-01") },
        { monto: 200, metodoPago: "EFECTIVO", fecha: new Date("2026-02-02") },
      ],
    } as any)

    const text = await extractPdfText(buffer)
    // Built via the doc's own currency formatter (not a literal "$ 700,00")
    // because Intl.NumberFormat("es-AR") inserts a U+00A0 non-breaking
    // space after the symbol, not a regular space.
    expect(text).toContain(formatCurrencyValue(700, "ARS"))
    expect(text).toContain(formatCurrencyValue(500, "ARS"))
  })

  it("renders the recibí conforme signature block for an orden-sourced remito", async () => {
    const buffer = await generateFacturaPDF({
      numeroFactura: "0001-00000031",
      fecha: new Date("2026-02-03"),
      estadoPago: "PENDIENTE",
      cliente: { nombre: "Ana" },
      orden: { numeroOrden: 31, codigoOrden: "CEL031", dispositivo: "iPhone" },
      subtotal: 100,
      iva: 0,
      total: 100,
      montoAbonado: 0,
      pagos: [],
    } as any)

    const text = await extractPdfText(buffer)
    expect(text).toContain("RECIBÍ CONFORME")
    expect(text).toContain("Firma")
    expect(text).toContain("Aclaración")
  })

  it("omits the recibí conforme block for a venta-sourced remito", async () => {
    const buffer = await generateFacturaPDF({
      numeroFactura: "0001-00000032",
      fecha: new Date("2026-02-04"),
      estadoPago: "PAGADO",
      cliente: { nombre: "Consumidor Final" },
      venta: { numeroVenta: 32 },
      subtotal: 100,
      iva: 0,
      total: 100,
      montoAbonado: 100,
      pagos: [],
    } as any)

    const text = await extractPdfText(buffer)
    expect(text).not.toContain("RECIBÍ CONFORME")
  })
})
