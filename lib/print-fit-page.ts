/**
 * Fits a print document's `@page` height to its rendered content.
 *
 * Windows thermal printer drivers often report a fixed paper length (e.g.
 * 80x297mm) instead of honoring `@page { size: 80mm auto }`. When that
 * happens the browser prints one full page at the driver's fixed length,
 * so the printer feeds a mostly blank page before cutting.
 *
 * The fix is to measure the rendered content height in the print document
 * and inject an explicit `@page { size: <width>mm <height>mm }` rule sized
 * to that content. The rule is appended to `doc.head` so it comes after any
 * existing `@page` rule in the document and wins the CSS cascade.
 */
export function fitPrintPageToContent(doc: Document, el: HTMLElement | null, widthMm: number): void {
  if (!el?.offsetHeight || el.offsetHeight <= 0) return

  // 1in = 96 CSS reference pixels (spec-fixed, independent of zoom/DPI).
  // +2mm buffer guards against clipping from sub-pixel rounding.
  const heightMm = Math.ceil((el.offsetHeight * 25.4) / 96) + 2

  const pageStyle = doc.createElement("style")
  pageStyle.textContent = `@page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }`
  doc.head.appendChild(pageStyle)
}
