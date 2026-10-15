/**
 * Paper size of the printed service order (the PDF from `generateOrdenPDF`).
 *
 * `A4` is the layout the order has always had. `A5` and `A6` are single-column layouts
 * for small sheets (lib/pdf-orden-compact.ts), because printing the A4 page on an A6 sheet
 * scales every text to half its size.
 *
 * Source of truth for the three places that need to agree on what a valid size is: the
 * PDF generator, the PDF routes and the configuration API/screen. No imports on purpose, so
 * client components can use it too.
 *
 * The organization default lives in `organizations.orden_formato_papel`. That column is
 * added by a migration applied by hand AFTER the deploy, so every reader goes through
 * `normalizeOrdenPapel`: a missing column, a NULL or garbage all mean A4.
 */
export type OrdenPapel = "A4" | "A5" | "A6"

export const ORDEN_PAPEL_DEFAULT: OrdenPapel = "A4"

/** Page size of each paper, in PDF points (1pt = 1/72 in), portrait. */
export const ORDEN_PAGE_POINTS: Record<OrdenPapel, readonly [number, number]> = {
  A4: [595, 842],
  A5: [420, 595],
  A6: [298, 420],
}

/** What the user can pick. Labels are screen copy, in the voice of the app. */
export const ORDEN_PAPEL_OPCIONES: ReadonlyArray<{ value: OrdenPapel; label: string }> = [
  { value: "A4", label: "A4 (hoja entera)" },
  { value: "A5", label: "A5 (media hoja)" },
  { value: "A6", label: "A6 (un cuarto de hoja)" },
]

/** Strict parse of what a client sends: the size, or null when it is not a valid one. */
export function parseOrdenPapel(value: unknown): OrdenPapel | null {
  if (typeof value !== "string") return null
  const v = value.trim().toUpperCase()
  return v === "A4" || v === "A5" || v === "A6" ? v : null
}

/** Lenient read of what is stored: anything that is not a known size is A4. */
export function normalizeOrdenPapel(value: unknown): OrdenPapel {
  return parseOrdenPapel(value) ?? ORDEN_PAPEL_DEFAULT
}

/** The size of one print: what was asked for this time, else the organization default, else A4. */
export function resolveOrdenPapel(requested: unknown, orgDefault: unknown): OrdenPapel {
  return parseOrdenPapel(requested) ?? normalizeOrdenPapel(orgDefault)
}

/**
 * URL of the order PDF for one print. With no size (or an invalid one) it names none and the
 * server prints on the organization default; with one, that size is used for this print only.
 */
export function ordenPdfUrl(ordenId: string, papel?: OrdenPapel | null): string {
  const base = `/api/ordenes/${encodeURIComponent(ordenId)}/pdf`
  const size = parseOrdenPapel(papel)
  return size ? `${base}?papel=${size}` : base
}
