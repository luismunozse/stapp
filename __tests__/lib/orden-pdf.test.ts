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
      "OBSERVACIONES", // fix final-review D1: restored client-part block (fixture sets observaciones)
      "ACCESORIOS RECIBIDOS",
      "Juan Pérez", // body content survives
      "DNI 28.456.789",
      "CEL-1042", // codigoOrden, client idbox
    ]) {
      expect(text).toContain(section)
    }
    // Observaciones body content, not just the section label.
    expect(text).toContain("El cliente solicita que se lo contacte")
    // client part only: no cut line, no business stub
    expect(text).not.toContain("TALÓN")
    // RECEPCIÓN ajustes (feedback de la hoja impresa real): el email del
    // cliente ya no se imprime en la celda CLIENTE.
    expect(text).not.toContain("juan.perez@example.com")
    // La URL de seguimiento escrita junto al QR se reemplazó por un caption
    // corto — nada de URL como texto en la hoja (el link vive solo en el QR).
    expect(text).toContain("Escaneá el código para seguir tu reparación")
    expect(text).not.toContain("sample-public-token-1234")
    // El slot de firma "Recibió — {recibidoPorNombre}" se quitó de la parte
    // cliente (soloCliente comparte el mismo bloque QR/firma).
    expect(text).not.toContain("RECIBIÓ")
    expect(text).not.toContain("M. GÓMEZ")
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
      "PARTE SUPERIOR", // cut line label
      "TALÓN INFERIOR", // cut line label
      "OBSERVACIONES", // fix final-review D1: client-part block
    ]) {
      expect(text).toContain(section)
    }
    // fix final-review D1: short "OBS:" line restored on the talón's
    // notas-de-mostrador cell (distinct from the client-part block above).
    expect(text).toContain("OBS: El cliente solicita")
    // RECEPCIÓN ajustes (feedback de la hoja impresa real): client email,
    // tracking URL text and the "Recibió — {recibidoPorNombre}" signature
    // slot are gone from the client part; the QR now carries only a short
    // caption. `recibidoPorNombre` ("M. Gómez" in the fixture) no longer
    // surfaces anywhere on this sheet — the business stub never printed it
    // either (it only shows tecnicoNombre), so this is a hard absence now.
    expect(text).not.toContain("juan.perez@example.com")
    expect(text).not.toContain("RECIBIÓ")
    expect(text).not.toContain("M. GÓMEZ")
    expect(text).toContain("Escaneá el código para seguir tu reparación")
    expect(text).not.toContain("sample-public-token-1234")
    expect(buffer.length).toBeGreaterThan(1000)
  })

  it("omits the shop email from the header contact line but keeps address and phone", async () => {
    // Default fixture doesn't set emailEmpresa — override it explicitly so
    // this test actually exercises the removal, not just an absent field.
    const buffer = await generateOrdenPDF({ ...buildOrdenFixture(), emailEmpresa: "contacto@negocio-demo.com.ar" })
    const text = await extractPdfText(buffer)
    expect(text).not.toContain("contacto@negocio-demo.com.ar")
    // address/phone (shared by sucursal + direccionEmpresa/telefonoEmpresa
    // fallback in the fixture) still print on the header contact line.
    expect(text).toContain("Av. Rivadavia 5000, CABA")
    expect(text).toContain("+54 11 4000-1234")
  })

  it("embeds the reception signature image on the client part when firmaRecepcion is present", async () => {
    // Minimal 1x1 PNG, same trick used elsewhere in this suite.
    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
    const withoutFirma = await generateOrdenPDF(buildOrdenFixture())
    const withFirma = await generateOrdenPDF({ ...buildOrdenFixture(), firmaRecepcion: pngBase64 })
    // No-throw path, and the embedded image actually adds bytes to the
    // document (an /Image XObject + its data stream) — distinguishes a real
    // embed from a silently-skipped catch branch. The label itself doesn't
    // change either way (mirrors the ENTREGA sheet's firmaClienteEntrega).
    expect(withFirma.length).toBeGreaterThan(withoutFirma.length)
    const text = await extractPdfText(withFirma)
    expect(text).toContain("FIRMA DEL CLIENTE")
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
      expect(text).toContain("sin precio de venta cargado")

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

      // Fix final-review D3: the totals column reads top-to-bottom as
      // Presupuesto estimado -> Subtotal trabajo -> Mano de obra y otros
      // (derived: 50000 costoFinal - 48000 subtotal = 2000) -> TOTAL FINAL
      // -> Descuento -> SALDO band. Descuento used to sit BEFORE TOTAL
      // FINAL, so a reader would compute Subtotal - Descuento by eye and
      // land on a figure that didn't match TOTAL FINAL right below it.
      const presupIdx = text.indexOf("Presupuesto estimado")
      const subtotalIdx = text.indexOf("Subtotal trabajo")
      const manoDeObraIdx = text.indexOf("Mano de obra y otros")
      const totalFinalIdx = text.indexOf("TOTAL FINAL")
      const descuentoIdx = text.indexOf("Descuento")
      const saldoIdx = text.indexOf("SALDO")
      for (const idx of [presupIdx, subtotalIdx, manoDeObraIdx, totalFinalIdx, descuentoIdx, saldoIdx]) {
        expect(idx).toBeGreaterThan(-1)
      }
      expect(presupIdx).toBeLessThan(subtotalIdx)
      expect(subtotalIdx).toBeLessThan(manoDeObraIdx)
      expect(manoDeObraIdx).toBeLessThan(totalFinalIdx)
      expect(totalFinalIdx).toBeLessThan(descuentoIdx)
      expect(descuentoIdx).toBeLessThan(saldoIdx)

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
      // Fix final-review D4: costoFinal is set here, so the band must read
      // plain "SALDO" — never the "SALDO ESTIMADO" fallback label.
      expect(text).toContain("SALDO")
      expect(text).not.toContain("SALDO ESTIMADO")
      // Fix final-review D3: costoFinal (45000) does NOT exceed the fixture's
      // default subtotal trabajo (48000), so no derived "Mano de obra y
      // otros" line and no "Y MANO DE OBRA" heading suffix.
      expect(text).not.toContain("Mano de obra y otros")
      expect(text).not.toContain("Y MANO DE OBRA")
    })

    it("renders the derived 'Mano de obra y otros' line and heading suffix only when costoFinal exceeds subtotal trabajo", async () => {
      const buffer = await generateOrdenPDF({
        ...buildOrdenFixture(),
        estado: "ENTREGADO",
        trabajos: [{ nombre: "Batería iPhone 13", cantidad: 1, importe: 48000 }],
        costoFinal: 52500,
      })
      const text = await extractPdfText(buffer)
      expect(text).toContain("Mano de obra y otros")
      expect(text).toContain(formatCurrencyValue(4500, "ARS")) // 52500 - 48000
      expect(text).toContain("Y MANO DE OBRA") // heading suffix, uppercased by drawSectionLabel
    })

    it("labels the saldo band 'SALDO ESTIMADO' when costoFinal is null (falls back to presupuesto)", async () => {
      const buffer = await generateOrdenPDF({
        ...buildOrdenFixture(),
        estado: "ENTREGADO",
        costoFinal: null,
        totalCobrado: null,
      })
      const text = await extractPdfText(buffer)
      expect(text).toContain("SALDO ESTIMADO")
    })

    it("caps drawn trabajos rows and shows a '+N ítems más' footer when the priced list exceeds the budget", async () => {
      const trabajos = Array.from({ length: 25 }, (_, i) => ({
        nombre: `Repuesto de prueba ${String(i + 1).padStart(2, "0")}`,
        cantidad: 1,
        importe: 1000 + i,
      }))
      const buffer = await generateOrdenPDF({
        ...buildOrdenFixture(),
        estado: "ENTREGADO",
        trabajos,
      })
      const text = await extractPdfText(buffer)
      // Fix final-review D6: cap is 12 drawn rows — the 12th priced item is
      // the last one drawn, the 13th+ are not, and the footer accounts for
      // all 13 that got cut.
      expect(text).toContain("Repuesto de prueba 12")
      expect(text).not.toContain("Repuesto de prueba 13")
      expect(text).toContain("+13 ítems más")
      // The tail block (signature row, "ENTREGÓ") must still land on-page —
      // same MediaBox invariant as fix D5, exercised here with an oversized
      // trabajos list instead of the default fixture.
      expect(text).toContain("ENTREGÓ")
      const doc = await PDFDocument.load(buffer)
      const mediaBox = doc.getPage(0).getMediaBox()
      expect(mediaBox.y + mediaBox.height).toBe(842)
      expect(mediaBox.y).toBeGreaterThanOrEqual(0)
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

  describe("MediaBox invariant (fix final-review D5)", () => {
    // Pins the D5 crop-floor fix: the dynamic-height crop must always anchor
    // its TOP edge at the real page height (842, A4) and never push its
    // bottom edge below 0 — a regression here reintroduces the blank-strip-
    // above-header bug the original Task D5 fix addressed.
    it.each([
      ["recepción full (client part + cut line + talón)", buildOrdenFixture()],
      ["soloCliente (client part only)", { ...buildOrdenFixture(), soloCliente: true }],
      ["entrega (terminal delivery estado)", { ...buildOrdenFixture(), estado: "ENTREGADO" }],
    ] as const)("keeps a valid, non-negative-origin MediaBox for the %s variant", async (_label, data) => {
      const buffer = await generateOrdenPDF(data)
      const doc = await PDFDocument.load(buffer)
      const mediaBox = doc.getPage(0).getMediaBox()
      expect(mediaBox.y + mediaBox.height).toBe(842)
      expect(mediaBox.y).toBeGreaterThanOrEqual(0)
    })
  })
})
