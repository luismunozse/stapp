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
import { extractPdfText, extractPdfTextPositions } from "./pdf-text-helper"

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
    // condición IVA now renders in the header's right zone, uppercased (see
    // "classic form header" describe block below) — content is still
    // present, just no longer in its original mixed-case form.
    // CUIT/DNI now renders in the CLIENTE band's right half (label order
    // flipped from the old "DNI/CUIT" — see "classic form bands" describe
    // block below) — content is still present, just relabeled.
    for (const s of ["CUIT: 30-71234567-8", "RESPONSABLE INSCRIPTO", "CUIT/DNI: 28.456.789",
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

// Shared fixture for the classic-form describe blocks below (header bands
// and CLIENTE/CONDICIONES bands) — every optional field (cliente.dni,
// vencimiento, mediosPago, cbuAlias, items) is absent by default so
// baseData alone never draws any of the conditional band content.
const baseData = {
  numeroFactura: "0001-00000008",
  fecha: new Date("2026-08-17"),
  estadoPago: "PAGADO",
  cliente: { nombre: "Consumidor Final" },
  venta: { numeroVenta: 22 },
  subtotal: 3000,
  iva: 0,
  total: 3000,
  montoAbonado: 3000,
  pagos: [],
}

describe("generateFacturaPDF — classic form header", () => {
  it("renders the letter box: X legend present, fiscal letter R / cod 91 never rendered", async () => {
    const buffer = await generateFacturaPDF(baseData as any)
    const text = await extractPdfText(buffer)
    expect(text).toContain("Documento no válido como comprobante fiscal")
    expect(text).not.toContain("Cód. 91")
    expect(text).not.toContain("COD. 91")
    // pdf-text-helper's PositionedText only carries {text, x, y} (no font
    // size — Tf's size operand is parsed and discarded, see its Tf regex),
    // so instead of asserting on size we assert the "X" draw call sits
    // inside the letter box's geometry: box is 34x30 centered horizontally
    // on the default A4 page (595pt wide) at x=(595-34)/2=280.5..314.5,
    // straddling frameTop (802) from 787 to 817.
    const items = await extractPdfTextPositions(buffer)
    const letterX = items.find(
      (i) => i.text === "X" && i.x > 275 && i.x < 320 && i.y > 785 && i.y < 820
    )
    expect(letterX).toBeDefined()
  })

  it("clamps left-zone lines so a long company name never collides with the centered letter box", async () => {
    // Well over the ~200-220pt left-zone budget at TYPE.body (9pt) bold —
    // long enough that, unclamped, it would run underneath/into the
    // letter box (x ~ 280.5-314.5 on the default 595pt-wide A4 page).
    const longName = "Servicio Técnico Integral de Reparaciones Celulares y Computadoras S.R.L."
    const buffer = await generateFacturaPDF({ ...baseData, nombreEmpresa: longName } as any)

    const items = await extractPdfTextPositions(buffer)
    // Left-zone header band: from the company name's line down through the
    // deepest possible optional left-zone line (name + tel/dirección/
    // domicilio fiscal @ 12pt each) — same geometry the header uses to
    // compute headerBottomY. frameTop is 802 on the default A4 page
    // (height 842 - margin 40).
    const frameTop = 802
    const letterBoxLeftX = 280.5 // (595 - 34) / 2, letter box's left edge
    const leftZoneItems = items.filter(
      (i) => i.x < letterBoxLeftX && i.y <= frameTop && i.y > frameTop - 16 - 12 * 4
    )
    expect(leftZoneItems.length).toBeGreaterThan(0)
    // None of them may carry the full, untruncated name — a draw call
    // with that exact text would mean it ran unclamped past the box.
    for (const item of leftZoneItems) {
      expect(item.text).not.toBe(longName)
    }

    const text = await extractPdfText(buffer)
    expect(text).not.toContain(longName)
    // A truncated, ellipsized prefix of the name must still render — the
    // fix must clamp, not drop, the line.
    expect(text).toContain(longName.slice(0, 15))
  })

  it("shows ingresos brutos, inicio de actividades and IVA condition in caps when set", async () => {
    const buffer = await generateFacturaPDF({
      ...baseData,
      cuitEmpresa: "23944498389",
      condicionIvaEmpresa: "Monotributo",
      ingresosBrutosEmpresa: "902-123456-7",
      inicioActividadesEmpresa: "01/2020",
    } as any)
    const text = await extractPdfText(buffer)
    expect(text).toContain("CUIT: 23944498389")
    expect(text).toContain("Ingresos brutos: 902-123456-7")
    expect(text).toContain("Inicio actividades: 01/2020")
    expect(text).toContain("MONOTRIBUTO")
  })

  it("omits the fiscal header lines when the org has no fiscal data", async () => {
    const buffer = await generateFacturaPDF(baseData as any)
    const text = await extractPdfText(buffer)
    expect(text).not.toContain("Ingresos brutos:")
    expect(text).not.toContain("Inicio actividades:")
    expect(text).not.toContain("CUIT:")
  })
})

describe("generateFacturaPDF — classic form bands", () => {
  it("CLIENTE band shows CUIT/DNI and the VENTA reference on the right half", async () => {
    const buffer = await generateFacturaPDF({
      ...baseData,
      cliente: { nombre: "Juan Pérez", dni: "30123456" },
      venta: { numeroVenta: 22 },
    } as any)
    const text = await extractPdfText(buffer)
    expect(text).toContain("CUIT/DNI: 30123456")
    expect(text).toContain("VENTA: V0022")
  })

  it("CLIENTE band shows the ORDEN reference with código and dispositivo", async () => {
    const buffer = await generateFacturaPDF({
      ...baseData,
      venta: undefined,
      orden: { numeroOrden: 8, codigoOrden: "ORD-0008", dispositivo: "Notebook Lenovo" },
    } as any)
    const text = await extractPdfText(buffer)
    expect(text).toContain("ORDEN: ORD-0008 — Notebook Lenovo")
  })

  it("CONDICIONES band renders above the items table when data exists, absent when empty", async () => {
    const withCond = await generateFacturaPDF({
      ...baseData,
      items: [{ descripcion: "acc p", cantidad: 1, precioUnitario: 3000, subtotal: 3000 }],
      cbuAlias: "astecnoar",
    } as any)
    const positions = await extractPdfTextPositions(withCond)
    const cond = positions.find((i) => i.text.includes("CONDICIONES"))
    const detalle = positions.find((i) => i.text.includes("DETALLE DE ITEMS"))
    expect(cond).toBeDefined()
    expect(detalle).toBeDefined()
    expect(cond!.y).toBeGreaterThan(detalle!.y) // CONDICIONES sits above the table
    const without = await generateFacturaPDF(baseData as any)
    expect(await extractPdfText(without)).not.toContain("CONDICIONES")
  })
})
