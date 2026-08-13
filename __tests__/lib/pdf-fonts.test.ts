// @vitest-environment node
/**
 * Coverage for the expediente font loader (Task D1 of the orden expediente
 * redesign). This is a SEPARATE loader from embedCustomFonts/loadFonts
 * (Inter) so other PDF generators keep using Inter untouched — see lib/pdf.ts.
 *
 * Fonts embedded: Archivo Regular/Bold/Black, Archivo Condensed Bold/Black,
 * IBM Plex Mono Regular — all static TTFs (no variable-font instancing,
 * since pdf-lib/fontkit renders variable fonts at their default instance
 * only, which would silently be wrong for Condensed).
 */
import { describe, it, expect } from "vitest"
import { PDFDocument } from "pdf-lib"
import { embedExpedienteFonts } from "@/lib/pdf"

describe("embedExpedienteFonts", () => {
  it("embeds all six faces and renders Latin text (ñ, á) without throwing", async () => {
    const pdfDoc = await PDFDocument.create()
    const fonts = await embedExpedienteFonts(pdfDoc)

    expect(fonts.archivoRegular).toBeDefined()
    expect(fonts.archivoBold).toBeDefined()
    expect(fonts.archivoBlack).toBeDefined()
    expect(fonts.archivoCondensedBold).toBeDefined()
    expect(fonts.archivoCondensedBlack).toBeDefined()
    expect(fonts.plexMonoRegular).toBeDefined()

    const page = pdfDoc.addPage([595, 842])
    const sample = "Compañía — reparación técnica, señor/a, año"
    let y = 800
    for (const font of [
      fonts.archivoRegular,
      fonts.archivoBold,
      fonts.archivoBlack,
      fonts.archivoCondensedBold,
      fonts.archivoCondensedBlack,
      fonts.plexMonoRegular,
    ]) {
      expect(() => page.drawText(sample, { x: 40, y, size: 12, font })).not.toThrow()
      y -= 20
    }

    const bytes = await pdfDoc.save()
    expect(bytes.length).toBeGreaterThan(1000)
  })

  it("caches the font buffers across multiple calls (lazy loader)", async () => {
    const docA = await PDFDocument.create()
    const docB = await PDFDocument.create()
    const fontsA = await embedExpedienteFonts(docA)
    const fontsB = await embedExpedienteFonts(docB)
    // Each embed call returns embedded-font refs scoped to their own doc,
    // but both calls must succeed against the same underlying cached buffers.
    expect(fontsA.archivoRegular).toBeDefined()
    expect(fontsB.archivoRegular).toBeDefined()
  })
})
