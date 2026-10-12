// pdfjs-dist reads react-pdf output (TJ arrays + WinAnsi + nested cm),
// which the pdf-lib-specific ./pdf-text-helper cannot. Legacy build path:
// the standard build requires a worker and DOM APIs vitest's node env lacks.
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs"

export interface ReactPdfTextItem {
  text: string
  x: number
  y: number
  page: number
}

export async function extractReactPdfTextPositions(buffer: Buffer): Promise<ReactPdfTextItem[]> {
  // NOTE: `PDFDocumentProxy` (the resolved `doc` below) has no `destroy()`
  // method on the installed pdfjs-dist ^6.2.108 — only the loading task
  // does (`PDFDocumentLoadingTask.destroy(): Promise<void>`). Verified by
  // reading node_modules/pdfjs-dist/legacy/build/pdf.mjs directly: the
  // `PDFDocumentProxy` class has no `destroy` member at all.
  const loadingTask = getDocument({ data: new Uint8Array(buffer), useSystemFonts: true })
  try {
    const doc = await loadingTask.promise
    const out: ReactPdfTextItem[] = []
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p)
      const content = await page.getTextContent()
      for (const item of content.items) {
        if ("str" in item && item.str.trim()) {
          out.push({ text: item.str, x: item.transform[4], y: item.transform[5], page: p })
        }
      }
    }
    return out
  } finally {
    // Runs even if getPage/getTextContent throws partway through (e.g. a
    // malformed fixture from Tasks 3-5) — otherwise the pdfjs transport
    // leaks instead of being cleaned up.
    await loadingTask.destroy()
  }
}

export async function extractReactPdfText(buffer: Buffer): Promise<string> {
  return (await extractReactPdfTextPositions(buffer)).map((i) => i.text).join("\n")
}
