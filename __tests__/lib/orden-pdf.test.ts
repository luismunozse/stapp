// @vitest-environment node
/**
 * Regression coverage for generateOrdenPDF.
 *
 * Task D3 (orden expediente redesign) replaced the old "copia cliente" +
 * "copia local" pair — merged onto one A4 page by embedding each rendered
 * page as a Form XObject via `finalDoc.embedPages` — with a single
 * RECEPCIÓN sheet drawn directly on ONE page: client part on top, a ✂ cut
 * line, and the business "talón interno" stub below. There is no more
 * embedPages/XObject indirection for this document, so extractPdfText
 * (which only decodes Tj operators on a page's OWN content stream via its
 * OWN Resources/Font dict) now sees the client part AND the stub directly
 * on the same page — both variants (soloCliente and full) are real content
 * assertions, not just "doesn't throw".
 */
import { describe, it, expect } from "vitest"
import { PDFDocument } from "pdf-lib"
import { generateOrdenPDF } from "@/lib/pdf"
import { extractPdfText } from "./pdf-text-helper"
import { buildOrdenFixture } from "./orden-fixture"
import { formatCurrencyValue } from "@/lib/currency"
import { formatDateValue } from "@/lib/timezone"

describe("generateOrdenPDF", () => {
  it("renders the soloCliente variant with all key sections and no talón", async () => {
    const buffer = await generateOrdenPDF({ ...buildOrdenFixture(), soloCliente: true })
    const text = await extractPdfText(buffer)
    for (const section of [
      "CLIENTE", // section label, drawSectionLabel forces uppercase
      "FALLA DECLARADA",
      "ACCESORIOS RECIBIDOS",
      "Juan Pérez", // body content survives
      "DNI 28.456.789",
      "CEL-1042", // codigoOrden, client idbox
    ]) {
      expect(text).toContain(section)
    }
    // client part only: no cut line, no business stub
    expect(text).not.toContain("TALÓN")
    expect(buffer.length).toBeGreaterThan(1000)
  })

  it("renders the default (client part + ✂ + talón, one page) variant with all key sections", async () => {
    const buffer = await generateOrdenPDF(buildOrdenFixture())
    const text = await extractPdfText(buffer)
    for (const section of [
      "Juan Pérez",
      "DNI 28.456.789",
      "CEL-1042",
      "TALÓN INTERNO", // business stub heading
      "M. GÓMEZ", // recibidoPorNombre, uppercased in the "Recibió —" signature line
      "PARTE SUPERIOR", // cut line label
      "TALÓN INFERIOR", // cut line label
    ]) {
      expect(text).toContain(section)
    }
    expect(buffer.length).toBeGreaterThan(1000)
  })

  it("hides the access code from the soloCliente variant but shows it on the talón of the full variant", async () => {
    // Patrón codes render as a graphic (dots + lines), not literal text — use
    // a plain PIN here so the actual secret value is a real text assertion,
    // not just the "Código de acceso" section label.
    const fixture = { ...buildOrdenFixture(), codigoAccesoDispositivo: "PIN 4471" }

    const soloClienteBuffer = await generateOrdenPDF({ ...fixture, soloCliente: true })
    const soloClienteText = await extractPdfText(soloClienteBuffer)
    expect(soloClienteText).not.toContain("4471")

    const fullBuffer = await generateOrdenPDF(fixture)
    const fullText = await extractPdfText(fullBuffer)
    expect(fullText).toContain("4471")
  })

  it("still renders the pattern-code graphic on the talón without leaking it as text", async () => {
    // Default fixture uses "Patrón: 1-2-5-8-9" — asserts the pattern-drawing
    // path (dots + connecting lines, no digits as text) doesn't throw and
    // still labels the block correctly.
    const buffer = await generateOrdenPDF(buildOrdenFixture())
    const text = await extractPdfText(buffer)
    expect(text).toContain("Patrón")
    expect(buffer.length).toBeGreaterThan(1000)
  })

  it("marks a non-canonical estado (CANCELADO) over the closest reached timeline step", async () => {
    const buffer = await generateOrdenPDF({
      ...buildOrdenFixture(),
      estado: "CANCELADO",
      timeline: [
        { estado: "RECIBIDO", fecha: new Date(Date.now() - 3 * 86400000) },
        { estado: "EN_DIAGNOSTICO", fecha: new Date(Date.now() - 2 * 86400000) },
      ],
    })
    const text = await extractPdfText(buffer)
    // A bare `toContain("CANCELADO")` passes unconditionally: the header
    // idbox tag always draws the raw estado, independent of the timeline
    // fallback below. The actual thing under test is the *closest-reached*
    // mapping in generateOrdenPDF — with a timeline of RECIBIDO +
    // EN_DIAGNOSTICO dates, the CANCELADO tag must land specifically in the
    // DIAGNÓSTICO (index 1) column's date slot: RECIBIDO keeps its real
    // "DD/MM HH:mm" date, and every later step still shows the untouched
    // "—" placeholder. Confirmed against the real extracted text before
    // writing this regex — the timeline row decodes to exactly:
    //   "RECIBIDO 09/08 13:40 DIAGNÓSTICO CANCELADO PRESUPUESTADO — APROBADO — ..."
    // A broken/off-by-one closest-reached-step loop (e.g. defaulting to
    // index 0, or landing one column off) would break this exact
    // adjacency, even though the header tag alone would still trivially
    // contain "CANCELADO".
    expect(text).toMatch(/RECIBIDO \d{2}\/\d{2} \d{2}:\d{2} DIAGNÓSTICO CANCELADO PRESUPUESTADO — APROBADO — /)
    // Cheap explicit guard alongside the adjacency regex: exactly 2
    // occurrences total (header idbox tag + the one timeline date slot the
    // fallback picked) — not 1 (fallback never drew) or 3+ (leaked onto
    // more than one column).
    expect((text.match(/CANCELADO/g) || []).length).toBe(2)
    expect(buffer.length).toBeGreaterThan(1000)
  })

  it("renders the ENTREGADO variant with fotos as a separate appended page (signatures now live on the entrega sheet itself)", async () => {
    // Minimal 1x1 PNG, embedded as a data: URL so the fotos-de-ingreso fetch
    // works offline (fetch() resolves data: URLs in Node 18+), and reused as
    // a stand-in signature image — same trick as pdf-samples.test.ts.
    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

    const buffer = await generateOrdenPDF({
      ...buildOrdenFixture(),
      estado: "ENTREGADO",
      fotosIngreso: [
        { url: `data:image/png;base64,${pngBase64}`, descripcion: "Pantalla con manchas de humedad" },
        { url: `data:image/png;base64,${pngBase64}`, descripcion: "Puerto de carga oxidado" },
      ],
      fechaEntrega: new Date(),
      firmaClienteEntrega: pngBase64,
      firmaEncargadoEntrega: pngBase64,
      entregadoPor: "María Gómez",
      notasEntrega: "Se entrega el equipo funcionando correctamente. Cliente conforme.",
    })
    expect(buffer.length).toBeGreaterThan(1000)
    // Task D4: terminal delivery estados now render the full ENTREGA
    // expediente sheet as page 1 (replacing the old recepción+cut+stub
    // layout for this estado) — no more separate "comprobante de entrega"
    // page, its content (attribution + signatures) now lives on that same
    // sheet. Only the fotos-de-ingreso page still appends separately.
    const doc = await PDFDocument.load(buffer)
    expect(doc.getPageCount()).toBe(2)
    const text = await extractPdfText(buffer)
    expect(text).toContain("ENTREGÓ")
    expect(text).toContain("MARÍA GÓMEZ")
  })

  describe("ENTREGA expediente sheet (Task D4)", () => {
    it("renders trabajos, totals, garantía, cobros and diagnóstico for a terminal delivery estado", async () => {
      const fixture = buildOrdenFixture()
      const buffer = await generateOrdenPDF({
        ...fixture,
        estado: "ENTREGADO",
        diagnostico: "Sulfatación en el conector de batería; se reemplaza la celda dañada.",
        costoFinal: 50000,
        totalCobrado: 30000,
        estadoCobro: "PARCIAL",
        descuentoCobro: 2000,
        fechaCompletado: new Date(),
        fechaEntrega: new Date(),
        entregadoPor: "María Gómez",
        codigoAccesoDispositivo: "PIN 9911",
        trabajos: [
          { nombre: "Batería iPhone 13", cantidad: 1, importe: 48000 },
          { nombre: "Repuesto legado sin precio", cantidad: 1, importe: 0 },
        ],
      })
      const text = await extractPdfText(buffer)

      // Trabajo realizado: priced item shown, legacy $0 row filtered out
      // (documented decision — see task-D4-report.md) with a footer note.
      expect(text).toContain("TRABAJO REALIZADO")
      expect(text).toContain("Batería iPhone 13")
      expect(text).not.toContain("Repuesto legado sin precio")
      expect(text).toContain("sin precio omitido")

      // Totals arithmetic via the same formatter production code uses —
      // never a hand-typed currency string.
      expect(text).toContain(formatCurrencyValue(45000, "ARS")) // presupuesto (fixture default)
      expect(text).toContain(formatCurrencyValue(48000, "ARS")) // subtotal trabajo (0-item contributes nothing)
      expect(text).toContain(`-${formatCurrencyValue(2000, "ARS")}`) // descuento
      expect(text).toContain(formatCurrencyValue(50000, "ARS")) // TOTAL FINAL = costoFinal
      // saldo pendiente = costoFinal - descuentoCobro - totalCobrado (same
      // formula as orden-costos-card.tsx / cobrar-orden-dialog.tsx) =
      // 50000 - 2000 - 30000 = 18000, NOT 20000 (that would omit the
      // discount, which is drawn as its own "-$X" line right above it).
      expect(text).toContain(formatCurrencyValue(18000, "ARS")) // saldo pendiente

      // Garantía box (fixture default: 90 días).
      expect(text).toContain("GARANTÍA")
      expect(text).toContain("90 DÍAS")
      const vigenteStr = formatDateValue(fixture.garantia!.fechaVencimiento, fixture.zonaHoraria)
      expect(text).toContain(vigenteStr)

      // Pagos registrados (cobros).
      expect(text).toContain(formatCurrencyValue(10000, "ARS")) // fixture cobros default monto

      // Diagnóstico técnico present.
      expect(text).toContain("Sulfatación")

      // Security: access code NEVER renders on this client-facing sheet.
      expect(text).not.toContain("9911")
      expect(text).not.toContain("CÓDIGO DE ACCESO")

      // No cut line / business stub on the entrega sheet.
      expect(text).not.toContain("TALÓN")

      expect(buffer.length).toBeGreaterThan(1000)
    })

    it("omits the GARANTÍA box entirely when garantia is absent", async () => {
      const buffer = await generateOrdenPDF({
        ...buildOrdenFixture(),
        estado: "ENTREGADO",
        garantia: null,
      })
      const text = await extractPdfText(buffer)
      expect(text).not.toContain("GARANTÍA")
    })

    it("shows a SIN COBRO band with the motivo label instead of a saldo amount", async () => {
      const buffer = await generateOrdenPDF({
        ...buildOrdenFixture(),
        estado: "ENTREGADO_SIN_COBRO",
        motivoSinCobro: "NO_REPARABLE",
        costoFinal: null,
        totalCobrado: null,
      })
      const text = await extractPdfText(buffer)
      expect(text).toContain("SIN COBRO")
      expect(text).toContain("No reparable")
      expect(text).not.toContain("TALÓN")
    })

    it("marks the saldo band PAGADO when totalCobrado covers the total", async () => {
      const buffer = await generateOrdenPDF({
        ...buildOrdenFixture(),
        estado: "ENTREGADO",
        costoFinal: 45000,
        totalCobrado: 45000,
      })
      const text = await extractPdfText(buffer)
      expect(text).toContain("PAGADO")
    })

    it("subtracts descuentoCobro from the saldo band, distinct from the no-discount case", async () => {
      // Pins that the discount actually participates in the SALDO math
      // (not just that it's drawn as its own line): same costoFinal/
      // totalCobrado as the comprehensive test above, but WITHOUT a
      // descuentoCobro — saldo here must be costoFinal - totalCobrado =
      // 20000, the figure the discounted case must NOT show.
      const buffer = await generateOrdenPDF({
        ...buildOrdenFixture(),
        estado: "ENTREGADO",
        costoFinal: 50000,
        totalCobrado: 30000,
      })
      const text = await extractPdfText(buffer)
      expect(text).toContain(formatCurrencyValue(20000, "ARS"))
      expect(text).not.toContain(formatCurrencyValue(18000, "ARS"))
    })

    it("renders notasEntrega as a labeled client-facing line", async () => {
      const buffer = await generateOrdenPDF({
        ...buildOrdenFixture(),
        estado: "ENTREGADO",
        notasEntrega: "Se entrega el equipo funcionando correctamente. Cliente conforme.",
      })
      const text = await extractPdfText(buffer)
      expect(text).toContain("Notas de entrega")
      expect(text).toContain("Se entrega el equipo funcionando correctamente")
    })

    it("omits the notas de entrega line when absent", async () => {
      const buffer = await generateOrdenPDF({
        ...buildOrdenFixture(),
        estado: "ENTREGADO",
      })
      const text = await extractPdfText(buffer)
      expect(text).not.toContain("Notas de entrega")
    })
  })
})
