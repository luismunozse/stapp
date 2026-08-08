import { PDFDocument, PDFName, PDFDict, PDFStream, PDFArray } from "pdf-lib"
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
  const page = loaded.getPage(0)
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

  const contentsRef = page.node.Contents()
  const streams = contentsRef instanceof PDFArray
    ? Array.from({ length: contentsRef.size() }, (_, i) => loaded.context.lookup(contentsRef.get(i), PDFStream))
    : [loaded.context.lookup(contentsRef, PDFStream)]
  const contentText = streams
    .map((s) => zlib.inflateSync(Buffer.from(s.getContents())).toString("latin1"))
    .join("\n")

  let currentFont: string | null = null
  let decodedText = ""
  for (const line of contentText.split("\n")) {
    const tfMatch = line.match(/^\/(\S+)\s+[\d.]+\s+Tf/)
    if (tfMatch) currentFont = tfMatch[1]
    const tjMatch = line.match(/<([0-9A-Fa-f]+)>\s*Tj/)
    if (tjMatch && currentFont && cmaps[currentFont]) {
      const hex = tjMatch[1]
      let text = ""
      for (let i = 0; i < hex.length; i += 4) {
        const codePoint = cmaps[currentFont].get(hex.slice(i, i + 4).toUpperCase())
        if (codePoint) text += String.fromCodePoint(codePoint)
      }
      decodedText += text + " "
    }
  }

  return decodedText
}
