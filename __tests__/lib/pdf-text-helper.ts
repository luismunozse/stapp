import { PDFDocument, PDFName, PDFDict, PDFStream, PDFArray, PDFPage } from "pdf-lib"
import zlib from "zlib"

// ─── PDF text extraction for tests ───
//
// lib/pdf.ts embeds custom (subsetted) TrueType fonts via pdf-lib, which
// always encodes drawn text as Type0/Identity-H: each `Tj` operator holds
// 2-byte-per-glyph CID codes, not literal characters, and pdf-lib subsets
// (and re-embeds) the font per distinct text run, so glyph IDs are NOT
// stable across calls or predictable from the source font file. A plain
// `buffer.toString().includes("some text")` check on a generated PDF will
// never pass, compressed or not.
//
// pdf-lib does generate a ToUnicode CMap for every embedded font (used by
// PDF readers for copy/paste and search), so the reliable way to assert
// "this text was rendered" is to decode the PDF's own content stream using
// its own embedded CMaps: for each font resource, build a CID -> Unicode
// map from its ToUnicode stream, then walk the content stream's `Tf`/`Tj`
// operators, translating each Tj's hex-encoded glyph codes via whichever
// font was last selected.
export async function extractPdfText(buffer: Buffer): Promise<string> {
  const loaded = await PDFDocument.load(buffer)
  let decodedText = ""
  for (let pageIndex = 0; pageIndex < loaded.getPageCount(); pageIndex++) {
    decodedText += extractPageText(loaded, pageIndex)
  }
  return decodedText
}

// Builds a CID -> Unicode map per font resource key, from each font's own
// ToUnicode CMap stream. Shared by both the flat-text and the positioned
// extractors below so there's one implementation of the CMap decoding.
function buildPageCmaps(loaded: PDFDocument, page: PDFPage): Record<string, Map<string, number>> {
  const resources = page.node.Resources()
  const fontDict = resources?.lookup(PDFName.of("Font"), PDFDict)

  const cmaps: Record<string, Map<string, number>> = {}
  if (fontDict) {
    for (const [key, ref] of fontDict.entries()) {
      const fd = loaded.context.lookup(ref, PDFDict)
      const toUnicodeRef = fd.get(PDFName.of("ToUnicode"))
      if (!toUnicodeRef) continue
      const stream = loaded.context.lookup(toUnicodeRef, PDFStream)
      const cmapText = zlib.inflateSync(Buffer.from(stream.getContents())).toString("latin1")
      const map = new Map<string, number>()
      const bfCharRegex = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g
      let m: RegExpExecArray | null
      while ((m = bfCharRegex.exec(cmapText)) !== null) {
        map.set(m[1].toUpperCase(), parseInt(m[2].slice(0, 4), 16))
      }
      const keyStr = (key.asString ? key.asString() : String(key)).replace(/^\//, "")
      cmaps[keyStr] = map
    }
  }
  return cmaps
}

// Decompresses and joins a page's own content stream(s) — same source both
// extractors below walk line by line.
function getPageContentText(loaded: PDFDocument, page: PDFPage): string {
  const contentsRef = page.node.Contents()
  const streams = contentsRef instanceof PDFArray
    ? Array.from({ length: contentsRef.size() }, (_, i) => loaded.context.lookup(contentsRef.get(i), PDFStream))
    : [loaded.context.lookup(contentsRef, PDFStream)]
  return streams
    .map((s) => zlib.inflateSync(Buffer.from(s.getContents())).toString("latin1"))
    .join("\n")
}

function decodeTj(hex: string, cmap: Map<string, number>): string {
  let text = ""
  for (let i = 0; i < hex.length; i += 4) {
    const codePoint = cmap.get(hex.slice(i, i + 4).toUpperCase())
    if (codePoint) text += String.fromCodePoint(codePoint)
  }
  return text
}

// Decodes a single page's own content stream via its own Resources/Font
// dict — an embedded Form XObject (see orden-pdf.test.ts) carries separate
// Resources and is intentionally NOT walked here, only genuine PDF pages.
function extractPageText(loaded: PDFDocument, pageIndex: number): string {
  const page = loaded.getPage(pageIndex)
  const cmaps = buildPageCmaps(loaded, page)
  const contentText = getPageContentText(loaded, page)

  let currentFont: string | null = null
  let decodedText = ""
  for (const line of contentText.split("\n")) {
    const tfMatch = line.match(/^\/(\S+)\s+[\d.]+\s+Tf/)
    if (tfMatch) currentFont = tfMatch[1]
    const tjMatch = line.match(/<([0-9A-Fa-f]+)>\s*Tj/)
    if (tjMatch && currentFont && cmaps[currentFont]) {
      decodedText += decodeTj(tjMatch[1], cmaps[currentFont]) + " "
    }
  }

  return decodedText
}

export interface PositionedText {
  /** Decoded text of this single Tj draw call. */
  text: string
  /** X of the `Tm` immediately preceding this Tj — page-space points, origin bottom-left. */
  x: number
  /** Y of the `Tm` immediately preceding this Tj — same space as pdf-lib's drawText y. */
  y: number
}

// Same content-stream walk as extractPageText, but also tracks the most
// recent text-position operator and pairs each Tj's decoded text with it —
// lets tests assert WHERE something was drawn, not just THAT it was drawn.
// lib/pdf.ts draws every string through a single `page.drawText` call (see
// its "single-drawText" convention), and pdf-lib always emits that as an
// unrotated, unscaled absolute placement: `1 0 0 1 x y Tm` right before the
// `Tj` — confirmed against actual generated output, not assumed — so a
// simple regex on that exact operator form is enough; no need to handle
// `Td`/general `Tm` matrices nobody in this codebase produces.
function extractPagePositions(loaded: PDFDocument, pageIndex: number): PositionedText[] {
  const page = loaded.getPage(pageIndex)
  const cmaps = buildPageCmaps(loaded, page)
  const contentText = getPageContentText(loaded, page)

  let currentFont: string | null = null
  let currentX = 0
  let currentY = 0
  const out: PositionedText[] = []
  for (const line of contentText.split("\n")) {
    const tfMatch = line.match(/^\/(\S+)\s+[\d.]+\s+Tf/)
    if (tfMatch) currentFont = tfMatch[1]
    const tmMatch = line.match(/^1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm$/)
    if (tmMatch) {
      currentX = parseFloat(tmMatch[1])
      currentY = parseFloat(tmMatch[2])
    }
    const tjMatch = line.match(/<([0-9A-Fa-f]+)>\s*Tj/)
    if (tjMatch && currentFont && cmaps[currentFont]) {
      const text = decodeTj(tjMatch[1], cmaps[currentFont])
      if (text) out.push({ text, x: currentX, y: currentY })
    }
  }

  return out
}

// Flat list of every decoded Tj draw call across all pages, each tagged
// with the page coordinates it was drawn at. See extractPagePositions for
// why the `1 0 0 1 x y Tm` assumption is safe for this codebase.
export async function extractPdfTextPositions(buffer: Buffer): Promise<PositionedText[]> {
  const loaded = await PDFDocument.load(buffer)
  const out: PositionedText[] = []
  for (let pageIndex = 0; pageIndex < loaded.getPageCount(); pageIndex++) {
    out.push(...extractPagePositions(loaded, pageIndex))
  }
  return out
}
