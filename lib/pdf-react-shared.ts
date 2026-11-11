// Primitives shared by every @react-pdf/renderer document engine in the app
// (lib/remito-react-pdf.tsx, lib/cuenta-corriente-react-pdf.tsx, ...).
//
// Scope is deliberate: only pieces that carry NO layout geometry live here.
// Each document's own frame math — the remito's letter box and centered
// legend, the recibo's wider left zone — stays in its own module, because
// those constants are derived from that document's specific composition and
// sharing them would couple two layouts that are free to diverge.
//
// The monochrome tokens are the same values as lib/pdf-style.ts's MONO/TYPE,
// restated as plain hex/number literals because react-pdf styles take CSS
// colors while pdf-lib takes RGB objects.
import { PDFDocument, StandardFonts, type PDFFont } from "pdf-lib"

export const MONO = {
  ink: "#111111",
  label: "#555555",
  faint: "#999999",
  rule: "#cccccc",
  totalBg: "#f2f2f2",
}

export const TYPE = {
  docNumber: 18,
  docTitle: 10,
  sectionLabel: 6.5,
  body: 9,
  small: 8,
  fine: 6.5,
  total: 12,
}

export const RULE_WIDTH = 0.5

/**
 * A4 page width in points, as @react-pdf/layout's own PAGE_SIZES.A4[0]
 * reports it. Documents derive their horizontal budgets from this rather
 * than rounding to 595.
 */
export const PAGE_WIDTH_A4 = 595.28

/**
 * Collapses anything user-supplied into a single safe PDF line: newlines
 * become spaces (a raw \n inside a react-pdf <Text> silently reflows the
 * row it sits in) and non-string, non-number values become "".
 */
export const safe = (val: unknown): string => {
  if (val === null || val === undefined) return ""
  if (typeof val === "string") return val.replace(/[\r\n]+/g, " ").trim()
  if (typeof val === "number") return String(val)
  return ""
}

// Logo: descarga + normalización (EXIF, recorte de bordes, formatos) viven
// en lib/pdf-logo.ts, compartidas con los documentos de pdf-lib.
export { fetchLogo, type PdfLogo } from "./pdf-logo"

/**
 * Helvetica metrics for pre-render text measurement. pdf-lib's StandardFonts
 * expose the same Helvetica/Helvetica-Bold glyph widths react-pdf itself
 * renders with, so widths measured here match the actual output — which is
 * what makes truncateToWidth below trustworthy.
 *
 * Cached module-wide: embedding the standard fonts costs a PDFDocument
 * allocation, and every engine measures against the same two faces.
 */
let helvCache: { regular: PDFFont; bold: PDFFont } | null = null

export async function helveticaMetrics() {
  if (!helvCache) {
    const doc = await PDFDocument.create()
    helvCache = {
      regular: await doc.embedFont(StandardFonts.Helvetica),
      bold: await doc.embedFont(StandardFonts.HelveticaBold),
    }
  }
  return helvCache
}

export type HelveticaMetrics = Awaited<ReturnType<typeof helveticaMetrics>>

/** Truncates with an ellipsis so the rendered string fits maxWidth points. */
export function truncateToWidth(font: PDFFont, text: string, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text
  let t = text
  while (t.length > 0 && font.widthOfTextAtSize(`${t}…`, size) > maxWidth) t = t.slice(0, -1)
  return `${t}…`
}
