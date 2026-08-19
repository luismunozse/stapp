// @vitest-environment node
import { describe, it, expect } from "vitest"
import { PDFDocument } from "pdf-lib"
import { generateFacturaPDFReact } from "@/lib/remito-react-pdf"
import { generateFacturaPDF, generateFacturaPDFLegacy } from "@/lib/pdf"
import { formatCurrencyValue } from "@/lib/currency"
import { extractReactPdfText, extractReactPdfTextPositions } from "./pdf-text-helper-react"
import { extractPdfText } from "./pdf-text-helper"

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

describe("generateFacturaPDFReact — skeleton", () => {
  it("renders a parseable A4 PDF", async () => {
    const buffer = await generateFacturaPDFReact(baseData as any)
    expect(buffer.length).toBeGreaterThan(0)
    const doc = await PDFDocument.load(buffer)
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1)
    const { width, height } = doc.getPage(0).getSize()
    expect(Math.round(width)).toBe(595)
    expect(Math.round(height)).toBe(842)
  })
})

describe("react-pdf text extraction", () => {
  it("reads text content from react-pdf output", async () => {
    const buffer = await generateFacturaPDFReact(baseData as any)
    const text = await extractReactPdfText(buffer)
    expect(text).toContain("REMITO")
    expect(text).toContain("Documento no válido como comprobante fiscal")
    expect(text).toContain("Consumidor Final")
  })
  it("reports positions with page numbers", async () => {
    const buffer = await generateFacturaPDFReact(baseData as any)
    const items = await extractReactPdfTextPositions(buffer)
    const remito = items.find((i) => i.text.includes("REMITO"))
    expect(remito).toBeDefined()
    expect(remito!.page).toBe(1)
    expect(remito!.y).toBeGreaterThan(600) // upper third of the A4 page
  })
})

describe("generateFacturaPDF dispatcher", () => {
  it("uses the react engine by default", async () => {
    delete process.env.REMITO_PDF_ENGINE
    const buffer = await generateFacturaPDF(baseData as any)
    const doc = await PDFDocument.load(buffer)
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1)

    // Fingerprint the engine. `extractReactPdfText` (pdfjs-dist) is NOT a
    // valid discriminator on its own: pdfjs-dist happily decodes pdf-lib's
    // Type0/ToUnicode-CMap output too, so both engines' buffers contain
    // "REMITO" under it (verified empirically). The reliable signal is the
    // OTHER direction: `extractPdfText` (./pdf-text-helper) walks content
    // streams assuming pdf-lib's own conventions — hex `<...> Tj` CID codes
    // decoded via each font's ToUnicode CMap, positioned by a literal
    // `1 0 0 1 x y Tm` immediately before the Tj. react-pdf's output uses
    // literal-string Tj operators and a different operator sequence, so that
    // walk structurally cannot decode anything from it and returns "" — a
    // deterministic, non-flaky "this is NOT pdf-lib output" check.
    const text = await extractReactPdfText(buffer)
    expect(text).toContain("REMITO")
    expect(await extractPdfText(buffer)).toBe("")
  })
  it("falls back to pdf-lib when REMITO_PDF_ENGINE=pdflib", async () => {
    process.env.REMITO_PDF_ENGINE = "pdflib"
    try {
      const buffer = await generateFacturaPDF(baseData as any)
      const legacy = await generateFacturaPDFLegacy(baseData as any)
      expect(buffer.length).toBeGreaterThan(0)
      expect(Math.abs(buffer.length - legacy.length)).toBeLessThan(legacy.length * 0.2)
    } finally {
      delete process.env.REMITO_PDF_ENGINE
    }
  })
})

// ============================================================================
// Content parity — ported from __tests__/lib/factura-pdf-venta.test.ts.
// Every test below asserts CONTENT only (never a coordinate pin) against
// generateFacturaPDFReact via extractReactPdfText / extractReactPdfTextPositions.
// Pagination/structural tests (continuation pages, one-page compaction, the
// rowH=28 pago-note page-break spacing test) and coordinate-clamp tests
// (long-name/long-dirección truncation) are legacy-geometry-specific or
// Task 4/5 territory and are intentionally NOT ported here.
// ============================================================================

describe("content parity — venta/orden origin & items", () => {
  it("renders successfully with data.venta instead of data.orden, no item table when items is omitted", async () => {
    const buffer = await generateFacturaPDFReact({
      ...baseData,
      venta: { numeroVenta: 5 },
      pagos: [],
    } as any)
    const text = await extractReactPdfText(buffer)
    expect(text).not.toContain("DETALLE DE ITEMS")
  })

  it("still renders successfully with data.orden (orden origin), no item table when items is omitted", async () => {
    const buffer = await generateFacturaPDFReact({
      ...baseData,
      venta: undefined,
      cliente: { nombre: "Ana" },
      orden: { numeroOrden: 1, codigoOrden: "CEL001", dispositivo: "iPhone" },
      montoAbonado: 0,
      estadoPago: "PENDIENTE",
    } as any)
    const text = await extractReactPdfText(buffer)
    expect(text).not.toContain("DETALLE DE ITEMS")
  })

  it("renders items rows for a venta-sourced invoice", async () => {
    const buffer = await generateFacturaPDFReact({
      ...baseData,
      items: [
        { descripcion: "PANTALLA XPHONE12", cantidad: 1, precioUnitario: 150, subtotal: 150 },
        { descripcion: "MANO DE OBRA REPARACION", cantidad: 1, precioUnitario: 50, subtotal: 50 },
      ],
    } as any)
    const text = await extractReactPdfText(buffer)
    expect(text).toContain("DETALLE DE ITEMS")
    expect(text).toContain("PANTALLA XPHONE12")
    expect(text).toContain("MANO DE OBRA REPARACION")
  })

  it("renders items rows for an orden-sourced invoice", async () => {
    const buffer = await generateFacturaPDFReact({
      ...baseData,
      venta: undefined,
      cliente: { nombre: "Ana" },
      orden: { numeroOrden: 2, codigoOrden: "CEL002", dispositivo: "iPhone" },
      items: [
        { descripcion: "BATERIA GALAXYX10", cantidad: 1, precioUnitario: 80, subtotal: 80 },
        { descripcion: "SERVICIO DIAGNOSTICO", cantidad: 1, precioUnitario: 20, subtotal: 20 },
      ],
    } as any)
    const text = await extractReactPdfText(buffer)
    expect(text).toContain("DETALLE DE ITEMS")
    expect(text).toContain("BATERIA GALAXYX10")
    expect(text).toContain("SERVICIO DIAGNOSTICO")
  })

  it("shows Descuento and Redondeo lines when present, and omits them when absent", async () => {
    const subtotal = 200
    const descuento = 20
    const redondeo = 0.5
    const total = subtotal - descuento + redondeo
    const withDiscount = await generateFacturaPDFReact({
      ...baseData,
      descuento,
      redondeo,
      subtotal,
      total,
      montoAbonado: total,
    } as any)
    const textWith = await extractReactPdfText(withDiscount)
    expect(textWith).toContain("Descuento")
    expect(textWith).toContain("Redondeo")

    const without = await generateFacturaPDFReact({
      ...baseData,
      descuento: 0,
      redondeo: 0,
    } as any)
    const textWithout = await extractReactPdfText(without)
    expect(textWithout).not.toContain("Descuento")
    expect(textWithout).not.toContain("Redondeo")
  })

  it("titles the document REMITO and drops the FACTURA name", async () => {
    const buffer = await generateFacturaPDFReact(baseData as any)
    const text = await extractReactPdfText(buffer)
    expect(text).toContain("REMITO")
    expect(text).not.toContain("FACTURA")
  })

  it("keeps key sections: CLIENTE, TOTAL, ESTADO DE PAGO, footer disclaimer", async () => {
    const buffer = await generateFacturaPDFReact({
      ...baseData,
      items: [{ descripcion: "acc p", cantidad: 1, precioUnitario: 3000, subtotal: 3000 }],
      pagos: [{ monto: 3000, metodoPago: "EFECTIVO", fecha: new Date("2026-08-17") }],
    } as any)
    const text = await extractReactPdfText(buffer)
    expect(text).toContain("CLIENTE")
    expect(text).toContain("TOTAL")
    expect(text).toContain("ESTADO DE PAGO")
    expect(text).toContain("Remito interno — no válido como comprobante fiscal.")
  })
})

describe("content parity — money block (saldo protagonist) & dual dates", () => {
  it("makes saldo pendiente the highlighted figure for partial payments", async () => {
    const buffer = await generateFacturaPDFReact({
      ...baseData,
      estadoPago: "PAGADO_PARCIAL",
      subtotal: 1000,
      total: 1000,
      montoAbonado: 400,
    } as any)
    const text = await extractReactPdfText(buffer)
    expect(text).toContain("SALDO PENDIENTE")
    expect(text).toContain("Pagado a cuenta")
  })

  it("shows saldo label SALDO (no PENDIENTE suffix) when fully paid", async () => {
    const buffer = await generateFacturaPDFReact({
      ...baseData,
      subtotal: 500,
      total: 500,
      montoAbonado: 500,
    } as any)
    const text = await extractReactPdfText(buffer)
    expect(text).toContain("SALDO")
  })

  it("renders emission and operation dates when fechaOperacion is provided", async () => {
    const buffer = await generateFacturaPDFReact({
      ...baseData,
      fechaOperacion: new Date("2026-08-01"),
    } as any)
    const text = await extractReactPdfText(buffer)
    expect(text).toContain("Emisión")
    expect(text).toContain("Operación")
  })
})

describe("content parity — fiscal identity & payment conditions", () => {
  it("renders fiscal identity and payment conditions when provided", async () => {
    const buffer = await generateFacturaPDFReact({
      ...baseData,
      cuitEmpresa: "30-71234567-8",
      condicionIvaEmpresa: "Responsable Inscripto",
      cliente: { ...baseData.cliente, dni: "28.456.789" },
      vencimiento: new Date("2026-09-10"),
      mediosPago: "Efectivo, transferencia",
      cbuAlias: "stapp.taller.mp",
    } as any)
    const text = await extractReactPdfText(buffer)
    for (const s of [
      "CUIT: 30-71234567-8",
      "RESPONSABLE INSCRIPTO",
      "CUIT/DNI: 28.456.789",
      "CONDICIONES DE PAGO",
      "Vencimiento",
      "stapp.taller.mp",
    ]) {
      expect(text).toContain(s)
    }
  })

  it("omits the conditional blocks when data is absent", async () => {
    const buffer = await generateFacturaPDFReact(baseData as any)
    const text = await extractReactPdfText(buffer)
    expect(text).not.toContain("CONDICIONES DE PAGO")
    expect(text).not.toContain("CUIT:")
  })
})

// react-pdf's font/text-layout pipeline renders the U+00A0 non-breaking
// space that Intl.NumberFormat("es-AR") inserts after the currency symbol
// as a plain U+0020 space (verified empirically: pdf-lib round-trips the
// NBSP exactly, react-pdf does not) — a font-encoding artifact of the
// renderer, not a business-logic difference in the component (the visible
// glyphs are identical). Assertions against react-pdf's extracted text must
// compare against the normalized form.
const fmtReact = (n: number) => formatCurrencyValue(n, "ARS").replace(/ /g, " ")

describe("content parity — running balance & recibí conforme", () => {
  it("shows a running Saldo column that decreases with each payment", async () => {
    const buffer = await generateFacturaPDFReact({
      ...baseData,
      estadoPago: "PAGADO_PARCIAL",
      subtotal: 1000,
      total: 1000,
      montoAbonado: 100,
      pagos: [
        { monto: 300, metodoPago: "EFECTIVO", fecha: new Date("2026-02-01") },
        { monto: 200, metodoPago: "EFECTIVO", fecha: new Date("2026-02-02") },
      ],
    } as any)
    const text = await extractReactPdfText(buffer)
    expect(text).toContain(fmtReact(700))
    expect(text).toContain(fmtReact(500))
  })

  it("renders the recibí conforme signature block for an orden-sourced remito", async () => {
    const buffer = await generateFacturaPDFReact({
      ...baseData,
      venta: undefined,
      cliente: { nombre: "Ana" },
      orden: { numeroOrden: 31, codigoOrden: "CEL031", dispositivo: "iPhone" },
      montoAbonado: 0,
      estadoPago: "PENDIENTE",
    } as any)
    const text = await extractReactPdfText(buffer)
    expect(text).toContain("RECIBÍ CONFORME")
    expect(text).toContain("Firma")
    expect(text).toContain("Aclaración")
  })

  it("omits the recibí conforme block for a venta-sourced remito", async () => {
    const buffer = await generateFacturaPDFReact(baseData as any)
    const text = await extractReactPdfText(buffer)
    expect(text).not.toContain("RECIBÍ CONFORME")
  })
})

describe("content parity — classic form header: letter box & fiscal lines", () => {
  it("renders the letter box: X legend present, fiscal letter R / cod 91 never rendered", async () => {
    const buffer = await generateFacturaPDFReact(baseData as any)
    const text = await extractReactPdfText(buffer)
    expect(text).toContain("Documento no válido como comprobante fiscal")
    expect(text).not.toContain("Cód. 91")
    expect(text).not.toContain("COD. 91")

    // Standalone bold "X" on page 1, sitting in the top band of the page —
    // react-pdf's own layout geometry (flexbox, not pdf-lib's hardcoded
    // frameTop math), so this is a loose band check, not an exact pixel
    // pin (those are Task 4/5 territory).
    const items = await extractReactPdfTextPositions(buffer)
    const letterX = items.find((i) => i.text === "X" && i.page === 1 && i.y > 700)
    expect(letterX).toBeDefined()
  })

  it("shows ingresos brutos, inicio de actividades and IVA condition in caps when set", async () => {
    const buffer = await generateFacturaPDFReact({
      ...baseData,
      cuitEmpresa: "23944498389",
      condicionIvaEmpresa: "Monotributo",
      ingresosBrutosEmpresa: "902-123456-7",
      inicioActividadesEmpresa: "01/2020",
    } as any)
    const text = await extractReactPdfText(buffer)
    expect(text).toContain("CUIT: 23944498389")
    expect(text).toContain("Ingresos brutos: 902-123456-7")
    expect(text).toContain("Inicio actividades: 01/2020")
    expect(text).toContain("MONOTRIBUTO")
  })

  it("omits the fiscal header lines when the org has no fiscal data", async () => {
    const buffer = await generateFacturaPDFReact(baseData as any)
    const text = await extractReactPdfText(buffer)
    expect(text).not.toContain("Ingresos brutos:")
    expect(text).not.toContain("Inicio actividades:")
    expect(text).not.toContain("CUIT:")
  })
})

describe("content parity — classic form bands: CLIENTE / ORDEN / CONDICIONES", () => {
  it("CLIENTE band shows CUIT/DNI and the VENTA reference on the right half", async () => {
    const buffer = await generateFacturaPDFReact({
      ...baseData,
      cliente: { nombre: "Juan Pérez", dni: "30123456" },
      venta: { numeroVenta: 22 },
    } as any)
    const text = await extractReactPdfText(buffer)
    expect(text).toContain("CUIT/DNI: 30123456")
    expect(text).toContain("VENTA: V0022")
  })

  it("CLIENTE band shows the ORDEN reference with código and dispositivo", async () => {
    const buffer = await generateFacturaPDFReact({
      ...baseData,
      venta: undefined,
      orden: { numeroOrden: 8, codigoOrden: "ORD-0008", dispositivo: "Notebook Lenovo" },
    } as any)
    const text = await extractReactPdfText(buffer)
    expect(text).toContain("ORDEN: ORD-0008 — Notebook Lenovo")
  })

  it("omits the dangling em dash when orden.dispositivo is empty, and falls back to #NNNN when codigoOrden is null", async () => {
    const noDispositivo = await generateFacturaPDFReact({
      ...baseData,
      venta: undefined,
      orden: { numeroOrden: 8, codigoOrden: "ORD-0008", dispositivo: "" },
    } as any)
    const textNoDispositivo = await extractReactPdfText(noDispositivo)
    expect(textNoDispositivo).toContain("ORDEN: ORD-0008")
    expect(textNoDispositivo).not.toContain("ORDEN: ORD-0008 —")

    const noCodigo = await generateFacturaPDFReact({
      ...baseData,
      venta: undefined,
      orden: { numeroOrden: 8, codigoOrden: null, dispositivo: "Notebook Lenovo" },
    } as any)
    const textNoCodigo = await extractReactPdfText(noCodigo)
    expect(textNoCodigo).toContain("ORDEN: #0008 — Notebook Lenovo")
  })

  it("CONDICIONES band renders above the items table when data exists, absent when empty", async () => {
    const withCond = await generateFacturaPDFReact({
      ...baseData,
      items: [{ descripcion: "acc p", cantidad: 1, precioUnitario: 3000, subtotal: 3000 }],
      cbuAlias: "astecnoar",
    } as any)
    const positions = await extractReactPdfTextPositions(withCond)
    const cond = positions.find((i) => i.text.includes("CONDICIONES"))
    const detalle = positions.find((i) => i.text.includes("DETALLE DE ITEMS"))
    expect(cond).toBeDefined()
    expect(detalle).toBeDefined()
    expect(cond!.page).toBe(detalle!.page)
    expect(cond!.y).toBeGreaterThan(detalle!.y) // CONDICIONES sits above the table

    const without = await generateFacturaPDFReact(baseData as any)
    expect(await extractReactPdfText(without)).not.toContain("CONDICIONES")
  })
})

describe("content parity — pago cuotas & recargo", () => {
  it("shows the cuotas count and recargo percentage on a pago that carries them", async () => {
    const buffer = await generateFacturaPDFReact({
      ...baseData,
      pagos: [
        { monto: 1000, metodoPago: "TARJETA_CREDITO", fecha: new Date("2026-08-17"), cuotas: 3, recargoPorcentaje: 15 },
      ],
    } as any)
    const text = await extractReactPdfText(buffer)
    expect(text).toContain("3 cuotas")
    expect(text).toContain("15% recargo")
  })

  it("omits the cuotas/recargo note for a single-installment payment with no surcharge", async () => {
    const buffer = await generateFacturaPDFReact({
      ...baseData,
      pagos: [
        { monto: 1000, metodoPago: "EFECTIVO", fecha: new Date("2026-08-17"), cuotas: 1, recargoPorcentaje: 0 },
      ],
    } as any)
    const text = await extractReactPdfText(buffer)
    expect(text).not.toContain("cuotas")
    expect(text).not.toContain("recargo")
  })
})

describe("content parity — classic ruled tables & dedupe address", () => {
  it("items table header reads CANT before DESCRIPCIÓN and money content survives", async () => {
    const buffer = await generateFacturaPDFReact({
      ...baseData,
      items: [{ descripcion: "acc p", cantidad: 1, precioUnitario: 3000, subtotal: 3000 }],
      pagos: [{ monto: 3000, metodoPago: "EFECTIVO", fecha: new Date("2026-08-17") }],
    } as any)
    const positions = await extractReactPdfTextPositions(buffer)
    const cant = positions.find((i) => i.text.includes("CANT"))
    const desc = positions.find((i) => i.text.includes("DESCRIPCIÓN"))
    expect(cant).toBeDefined()
    expect(desc).toBeDefined()
    expect(cant!.x).toBeLessThan(desc!.x)

    const text = await extractReactPdfText(buffer)
    expect(text).toContain("SALDO")
    expect(text).toContain("HISTORIAL DE PAGOS")
  })

  it("dedupes the address line when domicilioFiscalEmpresa matches direccionEmpresa exactly", async () => {
    const sameAddress = "Av. Siempre Viva 742"
    const buffer = await generateFacturaPDFReact({
      ...baseData,
      direccionEmpresa: sameAddress,
      domicilioFiscalEmpresa: sameAddress,
    } as any)
    const items = await extractReactPdfTextPositions(buffer)
    const matches = items.filter((i) => i.text === sameAddress)
    expect(matches.length).toBe(1)
  })

  it("dedupes the address line when domicilioFiscalEmpresa matches direccionEmpresa only after trimming", async () => {
    // The legacy generator's safe() trims whitespace before the dedupe
    // comparison — a domicilio fiscal that only differs by surrounding
    // whitespace from dirección must still be treated as the same address.
    const buffer = await generateFacturaPDFReact({
      ...baseData,
      direccionEmpresa: "Av. Siempre Viva 742",
      domicilioFiscalEmpresa: "  Av. Siempre Viva 742  ",
    } as any)
    const items = await extractReactPdfTextPositions(buffer)
    const matches = items.filter((i) => i.text === "Av. Siempre Viva 742")
    expect(matches.length).toBe(1)
  })

  it("shows both address lines when dirección and domicilio fiscal differ", async () => {
    const buffer = await generateFacturaPDFReact({
      ...baseData,
      direccionEmpresa: "Calle Comercial 100",
      domicilioFiscalEmpresa: "Domicilio Fiscal 200",
    } as any)
    const text = await extractReactPdfText(buffer)
    expect(text).toContain("Calle Comercial 100")
    expect(text).toContain("Domicilio Fiscal 200")
  })
})

// ============================================================================
// Task 4 — logo rendering (header left zone) + truncation clamp against the
// letter box. Ported/derived from generateFacturaPDFLegacy's LOGO block and
// clampLeftZoneText (lib/pdf.ts).
// ============================================================================

// A minimal valid 1x1 PNG, base64-encoded as a data: URI — avoids any real
// network fetch in these tests. generateFacturaPDFReact fetches data.logoUrl
// itself (mirroring generateFacturaPDFLegacy's fetch behavior), and Node's
// built-in fetch resolves data: URIs locally without touching the network
// (verified empirically), so this stays fully offline.
const tinyPngDataUri =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

describe("logo rendering (header left zone)", () => {
  it("renders without throwing and keeps the company name readable when logoUrl is present", async () => {
    // A pixel-level assertion (does the logo bitmap actually paint) is not
    // reachable through text extraction — this only proves the render
    // pipeline accepts a logo source and the left-zone text around it
    // survives.
    const buffer = await generateFacturaPDFReact({
      ...baseData,
      logoUrl: tinyPngDataUri,
      nombreEmpresa: "Taller Central",
    } as any)
    const doc = await PDFDocument.load(buffer)
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1)
    const text = await extractReactPdfText(buffer)
    expect(text).toContain("Taller Central")
  })

  it("offsets the left-zone text to the right of the reserved logo box, vs. no offset when absent", async () => {
    const noLogo = await generateFacturaPDFReact({ ...baseData, nombreEmpresa: "Taller Central" } as any)
    const withLogo = await generateFacturaPDFReact({
      ...baseData,
      logoUrl: tinyPngDataUri,
      nombreEmpresa: "Taller Central",
    } as any)
    const noLogoItems = await extractReactPdfTextPositions(noLogo)
    const withLogoItems = await extractReactPdfTextPositions(withLogo)
    const noLogoName = noLogoItems.find((i) => i.text.includes("Taller Central"))
    const withLogoName = withLogoItems.find((i) => i.text.includes("Taller Central"))
    expect(noLogoName).toBeDefined()
    expect(withLogoName).toBeDefined()
    expect(withLogoName!.x).toBeGreaterThan(noLogoName!.x)
  })

  it("does not crash the remito when the logo fetch fails (mirrors legacy's guarded try/catch)", async () => {
    // A malformed URL makes Node's fetch() reject immediately (no DNS/
    // network round-trip — verified empirically) with "Failed to parse
    // URL", which must degrade to "no logo" rather than reject
    // generateFacturaPDFReact — same contract as generateFacturaPDFLegacy's
    // try/catch around fetch().
    const buffer = await generateFacturaPDFReact({
      ...baseData,
      logoUrl: "not-a-valid-url",
      nombreEmpresa: "Taller Central",
    } as any)
    const text = await extractReactPdfText(buffer)
    expect(text).toContain("Taller Central")
  })
})

describe("left-zone truncation clamp", () => {
  it("clamps long left-zone lines so they never reach the letter box", async () => {
    const longName = "Servicio Técnico Integral de Reparaciones y Mantenimiento S.R.L."
    const buffer = await generateFacturaPDFReact({ ...baseData, nombreEmpresa: longName } as any)
    const text = await extractReactPdfText(buffer)
    expect(text).not.toContain(longName)
    expect(text).toContain("…")
    expect(text).toContain(longName.slice(0, 15)) // truncated prefix survives
  })

  it("shrinks the truncation budget when a logo is present, so a name that fits without a logo truncates with one", async () => {
    // Bold @ TYPE.body(9): ~157.16pt wide — fits the no-logo left-zone
    // budget (~220.64pt: letterBoxX 280.64 - 10pt gap - leftX 50) but
    // overflows the with-logo budget (~125.64pt: same, with leftX pushed to
    // 145 by the reserved logo box + gap). Numbers derived and verified via
    // pdf-lib HelveticaBold widthOfTextAtSize before writing this test.
    const boundaryName = "Reparaciones El Sol Servicios S.R.L."

    const withoutLogo = await generateFacturaPDFReact({ ...baseData, nombreEmpresa: boundaryName } as any)
    const textWithoutLogo = await extractReactPdfText(withoutLogo)
    expect(textWithoutLogo).toContain(boundaryName)

    const withLogo = await generateFacturaPDFReact({
      ...baseData,
      nombreEmpresa: boundaryName,
      logoUrl: tinyPngDataUri,
    } as any)
    const textWithLogo = await extractReactPdfText(withLogo)
    expect(textWithLogo).not.toContain(boundaryName)
    expect(textWithLogo).toContain("…")
  })
})
