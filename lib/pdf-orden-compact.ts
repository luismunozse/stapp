/**
 * Service-order PDF for small paper (A5 and A6).
 *
 * The A4 order (generateOrdenPDF in lib/pdf.ts) is a fixed two-zone page: customer part on
 * top, a cut line, the workshop stub below. Printed on an A6 sheet every text shrinks to
 * half its size and nobody can read it. This is a different layout, not a scaled copy:
 * ONE column, one customer copy, fonts sized for the sheet it is printed on.
 *
 * It is ALWAYS exactly one page. The workshop prints these on a single small sheet and an order
 * that spills onto a second one is useless to them, so the layout is fitted to the page instead
 * of flowing: `layout()` can run without drawing (it only measures and moves the cursor) and
 * `chooseParams()` uses that to find the gentlest parameters that fit, trying in this order and
 * stopping at the first that works:
 *
 *   a. the normal layout;
 *   b. tighter spacing (smaller gaps, paddings and line height);
 *   c. smaller terms and conditions, down to their own floor;
 *   d. every font and gap scaled down together, down to the text floor;
 *   e. last resort, cutting the longest free text with an ellipsis, in this order: the terms
 *      (the first one stays and a line says where to get the rest), the observaciones, the minor
 *      notes (delivery notes, extra fields, warranty note), the details of who attended, the
 *      branch address, the e-mail and the payment references, then the falla / diagnostico /
 *      accesorios, and last the reception checklist (it is liability evidence);
 *   f. the detail rows of the budget, shown up to a limit and the rest summed in one "+N more"
 *      row (the totals are never touched);
 *   g. absurdly long names (workshop, customer, razon social, device);
 *   h. the GUARANTEE: if even that does not fit, the scale keeps going down below the usual
 *      floor, to a hard minimum, then every paragraph is clamped to a maximum number of lines.
 *      An overflowing sheet is never drawn.
 *
 * Every search is a bisection over one parameter and the measuring passes are cheap (the width
 * of a string is memoized), so a fit costs a handful of passes, not a walk. Stages left at their
 * minimum get room back from the stage that settles it, most important first.
 *
 * Never cut before step g: workshop name, order number, dates, customer name and phone, device,
 * the budget / deposit / balance amounts, the QR and the signature lines.
 *
 * It is reached only through generateOrdenPDF({ ..., paperSize: "A5" | "A6" }); the A4
 * path in lib/pdf.ts does not run for these, and this file is not used for A4.
 *
 * What it leaves out on purpose: the device access code (PIN/pattern). On A4 it is printed
 * only on the workshop stub, never on the customer part; this sheet is the customer copy.
 */
import { PDFDocument as PDFLib, type PDFFont, type PDFImage, type PDFPage, type RGB } from "pdf-lib"
import QRCode from "qrcode"
import { embedExpedienteFonts, type OrdenPDFData } from "@/lib/pdf"
import { ORDEN_PAGE_POINTS } from "@/lib/orden-papel"
import { MONO, drawRule } from "@/lib/pdf-style"
import { formatCurrencyValue, type CurrencyCode, DEFAULT_CURRENCY } from "@/lib/currency"
import { formatDateValue, getZonedParts, DEFAULT_TIMEZONE } from "@/lib/timezone"
import { getTaxIdLabel, getPersonalIdLabel } from "@/lib/countries"
import { parseRecepcionTerminos } from "@/lib/terminos"
import { resolveTerminologia, t } from "@/lib/terminologia"
import { ESTADOS_COMPLETADOS, MOTIVO_SIN_COBRO_LABELS, type MotivoSinCobro } from "@/lib/seguimiento-state"

export type CompactPapel = "A5" | "A6"

interface Metrics {
  margin: number
  /** Main text: problem, device, customer. */
  body: number
  /** Secondary text. */
  small: number
  /** Uppercase section labels. */
  label: number
  /** Terms and conditions. */
  terms: number
  /** Workshop name. */
  heading: number
  /** Order number. */
  number: number
  qr: number
  logo: number
  /** Height of the area where a signature is drawn. */
  sigArea: number
}

/**
 * Sizes at "normal" fit (step a). Smallest text on A6 is 8pt and on A5 9pt (the A4 sheet
 * printed on A6 comes out at about 4.5pt). The tests pin these.
 */
const METRICS: Record<CompactPapel, Metrics> = {
  A6: { margin: 16, body: 8.5, small: 8, label: 8, terms: 8, heading: 12, number: 19, qr: 52, logo: 36, sigArea: 26 },
  A5: { margin: 24, body: 10, small: 9, label: 9, terms: 9, heading: 15, number: 24, qr: 60, logo: 46, sigArea: 32 },
}

/**
 * How far the fit may shrink the text. `text` is the smallest any text but the terms is ever
 * drawn (the scale of step d is capped so that the smallest of body / small / label lands on
 * it); `terms` is the floor of the terms block, which shrinks first and goes further.
 */
const FLOORS: Record<CompactPapel, { text: number; terms: number }> = {
  A6: { text: 6.5, terms: 5.5 },
  A5: { text: 7.5, terms: 6.5 },
}

/** Line height as a multiple of the font size: normal, and with the spacing tightened. */
const LINE = 1.25
const LINE_TIGHT = 1.12
/** Vertical gaps and paddings, as a fraction of their normal size, when the spacing is tightened. */
const GAP_TIGHT = 0.4
/** How much of the signature area a fully tightened layout gives back. */
const SIG_TIGHT = 0.3
/** A character-limit bisection stops when the limit that fits and the one that does not are this close: a cut field loses at most this many characters it could have kept. */
const CAP_TOLERANCE = 8
/** The least a cut field keeps (characters), so it is never just an ellipsis: terms (the first one), details, falla / diagnostico / accesorios, checklist. */
const MIN_KEEP = { terms: 40, details: 30, falla: 40, checklist: 24 } as const
/** The longest a name may be in the absurd case where nothing else is left to cut. */
const IDENTITY_FLOOR = 60
/** The smallest any text is ever drawn, reached only by the last-resort guarantee. */
const HARD_MIN_FONT = 5
/** Upper bound of the paragraph-length search of the guarantee. */
const MAX_LINES_BOUND = 400
/** Printed under the terms when they were cut. */
const TERMS_CUT_NOTE = "Términos completos: pedíselos al taller."

/**
 * Length of the longest prefix of `s` that fits in `maxWidth` (at least 1, so a glyph wider than
 * the line still advances; `s.length` when all of it fits). Width grows with the prefix, so it
 * gallops (doubling) to bracket the cut and then bisects: the cost is proportional to the
 * length of the CHUNK that fits, not to the length of `s`, which keeps wrapping a very long
 * token roughly linear (a walk-down from the full length was cubic: a 1500-character token
 * took 38 s).
 */
export function fitPrefix(s: string, measure: (s: string) => number, maxWidth: number): number {
  if (s.length <= 1) return s.length
  let lo = 1 // known to be acceptable (the minimum progress)
  let hi = 2
  while (hi < s.length && measure(s.slice(0, hi)) <= maxWidth) {
    lo = hi
    hi *= 2
  }
  if (hi >= s.length) {
    if (measure(s) <= maxWidth) return s.length
    hi = s.length
  }
  // lo fits (or is the minimum), hi does not
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (measure(s.slice(0, mid)) <= maxWidth) lo = mid
    else hi = mid
  }
  return lo
}

/**
 * Greedy word wrap with a hard split for a word wider than the line, so that no returned
 * line is wider than `maxWidth` (a pasted URL or a mash of characters cannot overflow).
 * Pure: the caller supplies how to measure.
 */
export function wrapText(text: string, measure: (s: string) => number, maxWidth: number): string[] {
  const lines: string[] = []
  let line = ""
  for (let word of text.split(/\s+/).filter(Boolean)) {
    while (word.length > 1) {
      const n = fitPrefix(word, measure, maxWidth)
      if (n >= word.length) break // the rest fits on one line
      if (line) {
        lines.push(line)
        line = ""
      }
      lines.push(word.slice(0, n))
      word = word.slice(n)
    }
    const candidate = line ? `${line} ${word}` : word
    if (measure(candidate) <= maxWidth || !line) {
      line = candidate
    } else {
      lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  return lines
}

/** `s` cut to at most `n` characters of its beginning, closed with an ellipsis (`s` itself when it already fits). */
export function cutText(s: string, n: number): string {
  if (s.length <= n) return s
  let end = Math.max(n, 0)
  const last = end > 0 ? s.charCodeAt(end - 1) : 0
  if (last >= 0xd800 && last <= 0xdbff) end -= 1 // never split a surrogate pair
  return s.slice(0, end).trimEnd() + "…"
}

/** The terms keeping `limit` characters in total: the first ones whole, the one that crosses the limit cut. */
function cutTerms(terms: string[], limit: number | undefined): string[] {
  if (limit === undefined) return terms
  const out: string[] = []
  let left = limit
  for (const term of terms) {
    if (term.length <= left) {
      out.push(term)
      left -= term.length
      continue
    }
    if (left > 0) out.push(cutText(term, left))
    break
  }
  return out
}

/**
 * Largest-possible-value search between a value known to work (`good`) and one known not to
 * (`bad`), in either direction. Returns the value closest to `bad` that was verified to work.
 * Stops when the two are within `tolerance`, so the number of calls to `ok` is log2(range / tolerance).
 */
function bisect(good: number, bad: number, ok: (v: number) => boolean, tolerance: number): number {
  while (Math.abs(bad - good) > tolerance) {
    const mid = (good + bad) / 2
    if (ok(mid)) good = mid
    else bad = mid
  }
  return good
}

/**
 * The first `n` of `lines`, the last one closed with an ellipsis that still fits `maxWidth`
 * (`lines` itself when it already has `n` or fewer). Pure: the caller supplies how to measure.
 */
export function clampLines(lines: string[], n: number, measure: (s: string) => number, maxWidth: number): string[] {
  if (lines.length <= n) return lines
  const kept = lines.slice(0, Math.max(n, 1))
  const last = kept[kept.length - 1]
  const cut = measure(last + "…") <= maxWidth ? last : last.slice(0, fitPrefix(last, (x) => measure(x + "…"), maxWidth))
  kept[kept.length - 1] = cut.trimEnd() + "…"
  return kept
}

const safe = (val: unknown): string => {
  if (val === null || val === undefined) return ""
  if (typeof val === "string") return val.replace(/[\r\n]+/g, " ").trim()
  if (typeof val === "number") return String(val)
  return ""
}

/** Free-text fields that can be cut, with the order they are cut in (see CUT_STAGES). */
type CapKey =
  | "terms"
  | "observaciones"
  | "notes" // delivery notes
  | "metadata"
  | "garantia" // warranty note
  | "shop" // branch name and address
  | "people" // who received, who repaired, who delivered
  | "email"
  | "rowtext" // names of work items, payment method / reference, reason for no charge, deposit method
  | "falla"
  | "diagnostico"
  | "accesorios"
  | "checklist"
  | "checklistNotes"

/** Everything the fit decides. `layout()` is a pure function of this and the order data. */
interface FitParams {
  /** Multiplies fonts, gaps and the sizes of logo, QR and signature area. 1 = normal. */
  scale: number
  /** 0 = normal spacing, 1 = tightest (smaller gaps and line height). */
  tight: number
  /** Font size of the terms, in points. */
  termsSize: number
  /** Longest text, in characters, each field may have. Missing = whole. */
  caps: Partial<Record<CapKey, number>>
  /** Most detail rows (work done, payments) shown; the rest are summed in one row. Missing = all. */
  rows?: number
  /** Longest workshop / customer / razon social / device name, in characters. Missing = whole. */
  identity?: number
  /** Most lines any paragraph may have (the guarantee). Missing = as many as it needs. */
  maxLines?: number
}

/** The order of the last resort: each stage cuts its fields with one common character limit. */
const CUT_STAGES: Array<{ keys: CapKey[]; min: number }> = [
  { keys: ["terms"], min: MIN_KEEP.terms },
  { keys: ["observaciones"], min: 0 },
  { keys: ["notes", "metadata", "garantia"], min: 0 },
  { keys: ["shop", "people", "email", "rowtext"], min: MIN_KEEP.details },
  { keys: ["falla", "diagnostico", "accesorios"], min: MIN_KEEP.falla },
  // after the falla: the device condition at reception is evidence if the customer disputes it
  { keys: ["checklist", "checklistNotes"], min: MIN_KEEP.checklist },
]

/** What the fit decided; handed to `options.report` (tests and diagnostics). */
export interface FitReport {
  /** Space left between the end of the content and the signature block. Never negative in a returned sheet. */
  slack: number
  /** Measuring passes spent. */
  attempts: number
  /** Scale of fonts and gaps that was drawn (1 = normal). */
  scale: number
  /** The step that settled it. */
  step: "normal" | "tight" | "terms" | "scale" | "cut" | "rows" | "names" | "guarantee"
}

export async function generateOrdenCompactPDF(
  data: OrdenPDFData,
  papel: CompactPapel,
  options: { report?: (r: FitReport) => void } = {},
): Promise<Buffer> {
  const [width, height] = ORDEN_PAGE_POINTS[papel]
  const M = METRICS[papel]
  const floors = FLOORS[papel]
  const term = resolveTerminologia(data.terminologia ?? null)
  const tz = data.zonaHoraria || DEFAULT_TIMEZONE

  const fmtDate = (d: Date | string | null | undefined) => formatDateValue(d, tz)
  const fmtMoney = (n: number | null | undefined) => formatCurrencyValue(n, (data.moneda as CurrencyCode) || DEFAULT_CURRENCY)
  const pad2 = (n: number) => String(n).padStart(2, "0")
  const fmtShort = (d: Date) => {
    if (Number.isNaN(d.getTime())) return ""
    const { day, month } = getZonedParts(d, tz)
    return `${pad2(day)}/${pad2(month)}`
  }

  // ---- data, read the same way the A4 sheets read it ----
  const empresaNombre = safe(data.nombreEmpresa) || "Servicio Técnico"
  const numeroOrdenPadded = `#${String(safe(data.numeroOrden)).padStart(4, "0")}`
  const codigoOrden = safe(data.codigoOrden)
  const estadoRaw = safe(data.estado).toUpperCase()
  const estadoDisplay = (estadoRaw || "RECIBIDO").replace(/_/g, " ")
  const isEntrega = ESTADOS_COMPLETADOS.has(estadoRaw)

  const cliente = data.cliente || { nombre: "", telefono: "" }
  const clienteNombre = safe(cliente.nombre) || "Sin nombre"
  const clienteTelefono = safe(cliente.telefono) || "Sin teléfono"
  const clienteEmail = safe(cliente.email)
  const clienteDni = safe(cliente.dni)
  const clienteCuit = safe(cliente.cuit)
  const clienteRazonSocial = safe(cliente.razonSocial)
  const isEmpresa = safe(cliente.tipoCliente).toUpperCase() === "EMPRESA" && !!clienteRazonSocial
  const labelIdFiscal = getTaxIdLabel(data.pais)
  const labelIdPersonal = getPersonalIdLabel(data.pais)
  const telefonoContacto = safe(data.telefonoContacto)

  const dispositivo = safe(data.dispositivo) || "Sin especificar"
  const marca = safe(data.marca)
  const colorDisp = safe(data.color)
  const imei = safe(data.imei)
  const equipoTitle = [[marca, dispositivo].filter(Boolean).join(" "), colorDisp].filter(Boolean).join(" · ")
  // Same rule as the A4 sheets: phones show IMEI, everything else the org's "serie" word.
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  const PHONE_TOKENS = new Set(["celular", "telefono", "smartphone", "movil"])
  const isPhone = norm(safe(data.tipoDispositivo)).split(/[^a-z0-9]+/).filter(Boolean).some((tok) => PHONE_TOKENS.has(tok))
  const identificadorLabel = isPhone ? "IMEI" : t(term, "serie")
  const problema = safe(data.problemaReportado) || "Sin descripcion"
  const accesorios = safe(data.accesorios)
  const metadataCampos = Array.isArray(data.metadataCampos) ? data.metadataCampos : []
  const metadataText = metadataCampos.map((m) => `${m.label}: ${m.valor}`).join(" · ")
  const diagnostico = safe(data.diagnostico)
  const observaciones = safe(data.observaciones)

  const recibidoPor = safe(data.recibidoPorNombre)
  const tecnico = safe(data.tecnicoNombre)
  const entregadoPor = safe(data.entregadoPor)
  const notasEntrega = isEntrega ? safe(data.notasEntrega) : ""

  const sucursalNombre = data.sucursal ? safe(data.sucursal.nombre) : ""
  const sucursalDireccion = data.sucursal ? safe(data.sucursal.direccion) : ""
  const sucursalTelefono = data.sucursal ? safe(data.sucursal.telefono) : ""
  // Branch address, city and phone run together and wrap (on a narrow sheet one line per datum
  // costs more height than the information is worth).
  const shopAddress = [
    sucursalDireccion || safe(data.direccionEmpresa),
    [safe(data.ciudadEmpresa), safe(data.provinciaEmpresa)].filter(Boolean).join(", "),
    sucursalTelefono || safe(data.telefonoEmpresa),
  ]
    .filter(Boolean)
    .join(" · ")
  const garantiaNotas = isEntrega && data.garantia ? safe(data.garantia.notas) : ""
  const metodoSena = safe(data.metodoPagoSena)
  const motivoSinCobro = data.motivoSinCobro ? safe(MOTIVO_SIN_COBRO_LABELS[data.motivoSinCobro as MotivoSinCobro] || data.motivoSinCobro) : ""

  // Work done and payments (delivered orders), same rules as the A4 ENTREGA sheet.
  const trabajosRaw = Array.isArray(data.trabajos) ? data.trabajos : []
  const trabajos = trabajosRaw.filter((it) => (Number(it.importe) || 0) !== 0)
  const omitted = trabajosRaw.length - trabajos.length
  const subtotal = trabajosRaw.reduce((sum, it) => sum + (Number(it.importe) || 0), 0)
  const manoDeObra = data.costoFinal != null && trabajosRaw.length > 0 && data.costoFinal > subtotal ? data.costoFinal - subtotal : null
  const cobros = Array.isArray(data.cobros) ? data.cobros : []

  // Reception checklist (delivered orders only, like A4: on the RECEPCION sheet it lives on the
  // internal stub, which this single customer copy does not have), one line of text per category.
  const CATEGORIAS: Record<string, string> = {
    FUNCIONAL: "Funcional",
    CONDICION_FISICA: "Condición física",
    ACCESORIOS: "Accesorios",
    OTRO: "Otro",
    GENERAL: "General",
  }
  const checklist = isEntrega && Array.isArray(data.checklistItems) ? data.checklistItems : []
  const checklistNotas = isEntrega ? safe(data.checklistNotas) : ""
  const checklistGroups = new Map<string, string[]>()
  for (const item of checklist) {
    const cat = safe(item.categoria).toUpperCase() || "GENERAL"
    const v = item.valor === true ? "OK" : item.valor === false ? "NO" : safe(item.valor)
    if (!checklistGroups.has(cat)) checklistGroups.set(cat, [])
    checklistGroups.get(cat)!.push(`${item.label}: ${v}`)
  }
  const checklistLines = [...checklistGroups].map(([cat, items]) => ({ title: CATEGORIAS[cat] || cat, text: items.join(" · ") }))

  const terminos = parseRecepcionTerminos(data.recepcionTerminos)

  // ---- document, fonts, images ----
  const pdfDoc = await PDFLib.create()
  const { archivoRegular: reg, archivoBold: bold, archivoBlack: black, archivoCondensedBold: condBold, archivoCondensedBlack: condBlack, plexMonoRegular: mono } =
    await embedExpedienteFonts(pdfDoc)

  const embedImage = async (b64: string | null | undefined): Promise<PDFImage | null> => {
    if (!b64) return null
    try {
      return await pdfDoc.embedPng(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))
    } catch {
      return null // an unreadable signature leaves the line blank, like the A4 sheet
    }
  }

  let logo: PDFImage | null = null
  if (data.logoUrl) {
    try {
      const res = await fetch(data.logoUrl)
      if (res.ok) {
        const buf = new Uint8Array(await res.arrayBuffer())
        const ct = res.headers.get("content-type") || ""
        const url = data.logoUrl.toLowerCase()
        if (ct.includes("png") || url.includes(".png")) logo = await pdfDoc.embedPng(buf)
        else if (ct.includes("jpeg") || ct.includes("jpg") || url.includes(".jpg") || url.includes(".jpeg")) logo = await pdfDoc.embedJpg(buf)
      }
    } catch {
      /* logo unavailable: skipped, no placeholder (same as A4) */
    }
  }

  let qr: PDFImage | null = null
  if (data.publicToken && data.baseUrl) {
    try {
      const url = `${data.baseUrl}/seguimiento/${data.publicToken}`
      const dataUrl = await QRCode.toDataURL(url, { width: 200, margin: 1, color: { dark: "#111111", light: "#ffffff" } })
      qr = await pdfDoc.embedPng(Uint8Array.from(atob(dataUrl.split(",")[1]), (c) => c.charCodeAt(0)))
    } catch {
      /* no QR: the sheet goes on without it, same as A4 */
    }
  }
  const caption = isEntrega ? "Historial completo, fotos y garantía online. Escaneá el código." : "Escaneá el código para seguir tu reparación"

  type Sig = { label: string; image: PDFImage | null }
  // the images of the signature lines, in the order they are drawn (the labels are built per pass)
  const sigImages: Array<PDFImage | null> = isEntrega
    ? [null, await embedImage(data.firmaClienteEntrega), await embedImage(data.firmaEncargadoEntrega)]
    : [await embedImage(data.firmaRecepcion)]

  // ---- measuring, memoized ----
  // The width of a string is linear in the font size, so it is measured once per (font, string)
  // at a reference size and scaled. The fit measures the same strings again and again at slightly
  // different sizes; this is what keeps a pass cheap.
  const REF = 1000
  const widthMemo = new Map<PDFFont, Map<string, number>>()
  const fontIds = new Map<PDFFont, number>()
  const fontId = (font: PDFFont): number => {
    let id = fontIds.get(font)
    if (id === undefined) {
      id = fontIds.size
      fontIds.set(font, id)
    }
    return id
  }
  const textW = (font: PDFFont, size: number, s: string): number => {
    let memo = widthMemo.get(font)
    if (!memo) {
      memo = new Map()
      widthMemo.set(font, memo)
    }
    let w = memo.get(s)
    if (w === undefined) {
      w = font.widthOfTextAtSize(s, REF)
      memo.set(s, w)
    }
    return (w * size) / REF
  }
  const measure = (font: PDFFont, size: number) => (s: string) => textW(font, size, s)

  // A pass wraps the same text at the same width as the one before whenever the parameters that
  // matter did not change, so the lines are memoized too (the drawing pass reuses the last
  // measuring pass).
  const wrapMemo = new Map<string, string[]>()
  const wrap = (text: string, font: PDFFont, size: number, maxWidth: number, maxLines?: number): string[] => {
    const key = `${fontId(font)}|${size}|${maxWidth}|${maxLines ?? ""}|${text}`
    let lines = wrapMemo.get(key)
    if (!lines) {
      lines = wrapText(text, measure(font, size), maxWidth)
      if (maxLines !== undefined) lines = clampLines(lines, maxLines, measure(font, size), maxWidth)
      wrapMemo.set(key, lines)
    }
    return lines
  }

  const left = M.margin
  const right = width - M.margin
  const contentW = width - M.margin * 2

  /** Length of each cuttable field: what a stage of the last resort cuts between its minimum and this. */
  const textLengths: Record<CapKey, number> = {
    terms: terminos.reduce((n, t) => n + t.length, 0),
    observaciones: isEntrega ? 0 : observaciones.length,
    notes: notasEntrega.length,
    metadata: metadataText.length,
    garantia: garantiaNotas.length,
    shop: Math.max(sucursalNombre.length, shopAddress.length),
    people: Math.max(recibidoPor.length, tecnico.length, entregadoPor.length),
    email: isEntrega ? clienteEmail.length : 0,
    rowtext: Math.max(
      isEntrega ? motivoSinCobro.length : 0,
      isEntrega ? Math.max(0, ...trabajos.map((it) => safe(it.nombre).length)) : metodoSena.length,
      isEntrega ? Math.max(0, ...cobros.map((c) => Math.max(safe(c.metodo).length, safe(c.referencia).length))) : 0,
    ),
    falla: problema.length,
    diagnostico: isEntrega ? diagnostico.length : 0,
    accesorios: accesorios.length,
    checklist: Math.max(0, ...checklistLines.map((g) => g.text.length)),
    checklistNotes: checklistNotas.length,
  }

  /** A page that draws nothing: measuring passes run the whole layout against it. */
  const DRY = {
    drawText() {},
    drawRectangle() {},
    drawImage() {},
    drawLine() {},
  } as unknown as PDFPage

  /**
   * Lays the whole sheet out, drawing on `page`, with the given parameters. Returns the slack:
   * the space left between the end of the content and the top of the signature block, which is
   * anchored to the bottom margin. Negative means it does not fit. With `DRY` as the page it
   * draws nothing, so the same function measures and draws and the two cannot disagree.
   */
  const layout = (page: PDFPage, P: FitParams): number => {
    const f = P.scale
    const gapMul = (1 - (1 - GAP_TIGHT) * P.tight) * f
    const lineF = LINE - (LINE - LINE_TIGHT) * P.tight
    /** A vertical gap or padding of `n` points at normal spacing. */
    const gp = (n: number) => n * gapMul
    const lh = (size: number) => size * lineF
    /** Depth of line box that tightening takes away below a text line: rules drawn under a row keep clear of its descenders. */
    const lost = M.body * f * (LINE - lineF)
    const F = {
      body: M.body * f,
      small: M.small * f,
      label: M.label * f,
      heading: M.heading * f,
      number: M.number * f,
      terms: P.termsSize,
      qr: M.qr * f,
      logo: M.logo * f,
      // the signature area is a padding too: it gives some room back, but a pen still has to fit
      sigArea: M.sigArea * f * (1 - SIG_TIGHT * P.tight),
    }

    const cap = (key: CapKey, text: string): string => {
      const limit = P.caps[key]
      if (limit === undefined || text.length <= limit) return text
      return limit <= 0 ? "" : cutText(text, limit)
    }
    const name = (s: string) => (P.identity === undefined ? s : cutText(s, P.identity))

    /** `wrap` with the guarantee's limit on the lines of any paragraph. */
    const wr = (text: string, font: PDFFont, size: number, maxWidth: number) => wrap(text, font, size, maxWidth, P.maxLines)

    let y = height - M.margin

    /** Wrapped text, line by line. */
    const para = (text: string, font: PDFFont, size: number, color: RGB, opts: { x?: number; width?: number } = {}) => {
      const x = opts.x ?? left
      for (const l of wr(text, font, size, opts.width ?? contentW)) {
        page.drawText(l, { x, y: y - size, size, font, color })
        y -= lh(size)
      }
    }

    /** Rule + uppercase label. */
    const section = (label: string) => {
      y -= gp(3) + lost
      drawRule(page, left, right, y)
      y -= gp(5)
      page.drawText(label.toUpperCase(), { x: left, y: y - F.label, size: F.label, font: bold, color: MONO.label })
      y -= lh(F.label) + gp(1)
    }

    /** Label on the left (wraps), amount flush right on the first line. */
    const amountRow = (label: string, amount: string, o: { labelFont?: PDFFont; amountFont?: PDFFont; size?: number; color?: RGB } = {}) => {
      const size = o.size ?? F.body
      const labelFont = o.labelFont ?? reg
      const amountFont = o.amountFont ?? mono
      const aw = textW(amountFont, size, amount)
      const lines = wr(label, labelFont, size, Math.max(contentW - aw - 8 * f, contentW * 0.3))
      lines.forEach((l, i) => {
        page.drawText(l, { x: left, y: y - size - i * lh(size), size, font: labelFont, color: o.color ?? MONO.ink })
      })
      page.drawText(amount, { x: right - aw, y: y - size, size, font: amountFont, color: MONO.ink })
      y -= lh(size) * lines.length
    }

    /** Detail rows, at most `P.rows` of them; the rest are summed in one row so the total still adds up. */
    const detailRows = <T>(rows: T[], row: (r: T) => [string, number], summary: (n: number) => string) => {
      // a single hidden row would be replaced by a summary row of the same height: show it instead
      const shown = P.rows === undefined || rows.length <= P.rows + 1 ? rows : rows.slice(0, P.rows)
      for (const r of shown) {
        const [label, amount] = row(r)
        amountRow(label, fmtMoney(amount))
      }
      const hidden = rows.slice(shown.length)
      if (hidden.length > 0) amountRow(summary(hidden.length), fmtMoney(hidden.reduce((sum, r) => sum + (Number(row(r)[1]) || 0), 0)), { color: MONO.label })
    }

    /**
     * "Label: value" pairs side by side on one line, moving to the next line when the next pair
     * does not fit. A pair wider than the whole line is written as a wrapped bold paragraph.
     */
    const labelValues = (pairs: Array<[string, string]>, size: number) => {
      const GAP = 12 * f
      let x = left
      let open = false // a line is started and not yet closed
      for (const [label, value] of pairs) {
        const lw = textW(reg, size, label)
        const w = lw + textW(bold, size, value)
        if (w > contentW) {
          if (open) {
            y -= lh(size)
            open = false
          }
          x = left
          para(label + value, bold, size, MONO.ink)
          continue
        }
        if (open && x + w > right) {
          y -= lh(size)
          x = left
        }
        page.drawText(label, { x, y: y - size, size, font: reg, color: MONO.label })
        page.drawText(value, { x: x + lw, y: y - size, size, font: bold, color: MONO.ink })
        x += w + GAP
        open = true
      }
      if (open) y -= lh(size)
    }

    // ============================================================
    // BOTTOM BLOCK: QR + signatures. Its height is known up front because it is anchored to the
    // bottom margin: the content flows down to it.
    // ============================================================
    /** Height of a signature area, its rule and the label (wrapped) under it, in a column of width w. */
    const sigHeight = (s: Sig, w: number) => F.sigArea + gp(3) + wr(s.label.toUpperCase(), bold, F.label, w).length * lh(F.label) + gp(4)
    /** Draws it inside [x, x + w] from `top` down. */
    const drawSig = (s: Sig, x: number, w: number, top: number) => {
      if (s.image) {
        const dims = s.image.scale(1)
        const ratio = Math.min((w * 0.8) / dims.width, (F.sigArea - 4 * f) / dims.height)
        page.drawImage(s.image, { x: x + (w - dims.width * ratio) / 2, y: top - F.sigArea + 2 * f, width: dims.width * ratio, height: dims.height * ratio })
      }
      drawRule(page, x, x + w, top - F.sigArea, { color: MONO.ink })
      let ly = top - F.sigArea - gp(3)
      for (const l of wr(s.label.toUpperCase(), bold, F.label, w)) {
        page.drawText(l, { x, y: ly - F.label, size: F.label, font: bold, color: MONO.label })
        ly -= lh(F.label)
      }
    }

    const entregadoShown = cap("people", entregadoPor)
    const sigs: Sig[] = isEntrega
      ? [
          { label: data.firmaRecepcion ? "Cliente — recepción (en archivo)" : "Cliente — recepción", image: sigImages[0] },
          { label: "Cliente — entrega", image: sigImages[1] },
          { label: entregadoShown ? `Entregó — ${entregadoShown}` : "Entregó", image: sigImages[2] },
        ]
      : [{ label: "Firma del cliente", image: sigImages[0] }]

    // QR on the left; on the right the caption and the signature line(s): one on the reception
    // sheet, three on the delivery sheet (as on A4, where they close the page).
    const colX = qr ? left + F.qr + 12 * f : left
    const colW = right - colX
    const capLines = qr ? wr(caption, reg, F.small, colW) : []
    const capH = capLines.length ? capLines.length * lh(F.small) + gp(2) : 0
    const sigsH = sigs.reduce((sum, s) => sum + sigHeight(s, colW), 0)
    const blockH = Math.max(qr ? F.qr : 0, capH + sigsH)
    const finalHeight = blockH + gp(4)
    const drawFinal = (top: number) => {
      const t0 = top - gp(4)
      if (qr) page.drawImage(qr, { x: left, y: t0 - F.qr, width: F.qr, height: F.qr })
      capLines.forEach((l, i) => {
        page.drawText(l, { x: colX, y: t0 - F.small - i * lh(F.small), size: F.small, font: reg, color: MONO.label })
      })
      let sy = t0 - capH
      for (const s of sigs) {
        drawSig(s, colX, colW, sy)
        sy -= sigHeight(s, colW)
      }
    }

    // ============================================================
    // HEADER: logo, workshop, order number
    // ============================================================
    const headerTop = y
    if (logo) {
      page.drawRectangle({ x: left, y: headerTop - F.logo, width: F.logo, height: F.logo, borderColor: MONO.ink, borderWidth: 1 })
      const s = logo.scale(1)
      const inset = 3 * f
      const ratio = Math.min((F.logo - inset * 2) / s.width, (F.logo - inset * 2) / s.height)
      page.drawImage(logo, {
        x: left + (F.logo - s.width * ratio) / 2,
        y: headerTop - F.logo + (F.logo - s.height * ratio) / 2,
        width: s.width * ratio,
        height: s.height * ratio,
      })
    }

    // right column: order number and internal code
    const numW = textW(condBlack, F.number, numeroOrdenPadded)
    const codeW = codigoOrden ? textW(mono, F.small, codigoOrden) : 0
    const rightColW = Math.max(numW, codeW)
    page.drawText(numeroOrdenPadded, { x: right - numW, y: headerTop - F.number, size: F.number, font: condBlack, color: MONO.ink })
    let rightBottom = headerTop - lh(F.number)
    if (codigoOrden) {
      page.drawText(codigoOrden, { x: right - codeW, y: rightBottom - F.small, size: F.small, font: mono, color: MONO.label })
      rightBottom -= lh(F.small)
    }

    // left column: workshop name, branch, contact
    const bizX = left + (logo ? F.logo + 8 * f : 0)
    const bizW = right - rightColW - 8 * f - bizX
    let by = headerTop
    for (const l of wr(name(empresaNombre), black, F.heading, bizW)) {
      page.drawText(l, { x: bizX, y: by - F.heading, size: F.heading, font: black, color: MONO.ink })
      by -= lh(F.heading)
    }
    // Branch name on its own line, then the address line.
    const shopLines = [cap("shop", sucursalNombre), cap("shop", shopAddress)].filter(Boolean)
    for (const text of shopLines) {
      for (const l of wr(text, reg, F.small, bizW)) {
        page.drawText(l, { x: bizX, y: by - F.small, size: F.small, font: reg, color: MONO.label })
        by -= lh(F.small)
      }
    }
    y = Math.min(by, rightBottom, logo ? headerTop - F.logo : headerTop) - gp(4)
    drawRule(page, left, right, y, { color: MONO.ink, thickness: 1.3 })
    y -= gp(6)

    // status row: state tag (ink fill) + dates
    const tagText = estadoDisplay.toUpperCase()
    const tagPad = 4 * f
    const tagW = textW(bold, F.label, tagText) + tagPad * 2
    const tagH = lh(F.label) + gp(1)
    page.drawRectangle({ x: left, y: y - tagH, width: tagW, height: tagH, color: MONO.ink })
    page.drawText(tagText, { x: left + tagPad, y: y - tagH + (tagH - F.label) / 2 + F.label * 0.18, size: F.label, font: bold, color: MONO.white })
    const ingreso = fmtDate(data.fechaIngreso)
    const dateParts = isEntrega
      ? [
          ingreso ? `Ingreso ${ingreso}` : "",
          data.fechaCompletado ? `Completado ${fmtDate(data.fechaCompletado)}` : "",
          data.fechaEntrega ? `Entrega ${fmtDate(data.fechaEntrega)}` : "",
        ].filter(Boolean)
      : [ingreso ? `Ingreso ${ingreso}` : ""].filter(Boolean)
    const dateText = dateParts.join(" · ")
    const dateAfterTagW = contentW - tagW - 8 * f
    if (dateText && textW(reg, F.small, dateText) <= dateAfterTagW) {
      page.drawText(dateText, { x: right - textW(reg, F.small, dateText), y: y - tagH + (tagH - F.small) / 2 + F.small * 0.18, size: F.small, font: reg, color: MONO.label })
      y -= tagH + gp(4)
    } else {
      y -= tagH + gp(3)
      if (dateText) para(dateText, reg, F.small, MONO.label)
      y -= gp(1)
    }
    if (data.esReingreso && data.ordenOrigenNumero) {
      para(`Reingreso de #${String(data.ordenOrigenNumero).padStart(4, "0")}`, reg, F.small, MONO.label)
    }

    // ============================================================
    // CLIENTE / EQUIPO
    // ============================================================
    section("Cliente")
    if (isEmpresa) {
      para(`${name(clienteRazonSocial)}${clienteCuit ? ` · ${labelIdFiscal} ${clienteCuit}` : ""}`, bold, F.body, MONO.ink)
      para(`Contacto: ${name(clienteNombre)}${clienteDni ? ` · ${labelIdPersonal} ${clienteDni}` : ""}`, reg, F.small, MONO.label)
    } else {
      const idSuffix = clienteDni ? ` · ${labelIdPersonal} ${clienteDni}` : clienteCuit ? ` · ${labelIdFiscal} ${clienteCuit}` : ""
      para(`${name(clienteNombre)}${idSuffix}`, bold, F.body, MONO.ink)
    }
    const tel = [clienteTelefono]
    if (telefonoContacto && telefonoContacto !== clienteTelefono) tel.push(`tel. de esta orden: ${telefonoContacto}`)
    para(tel.join(" · "), reg, F.small, MONO.label)
    if (isEntrega && clienteEmail) para(cap("email", clienteEmail), reg, F.small, MONO.label)

    section(t(term, "equipo"))
    para(name(equipoTitle || dispositivo), bold, F.body, MONO.ink)
    if (imei) para(`${identificadorLabel} ${imei}`, mono, F.body, MONO.ink)
    const metadata = cap("metadata", metadataText)
    if (metadata) para(metadata, reg, F.small, MONO.label)

    section("Falla declarada")
    para(cap("falla", problema), reg, F.body, MONO.ink)

    const diag = isEntrega ? cap("diagnostico", diagnostico) : ""
    if (diag) {
      section("Diagnóstico técnico")
      para(diag, reg, F.body, MONO.ink)
    }
    const obs = !isEntrega ? cap("observaciones", observaciones) : ""
    if (obs) {
      section("Observaciones")
      para(obs, reg, F.body, MONO.ink)
    }

    section("Accesorios recibidos")
    const acc = cap("accesorios", accesorios)
    if (acc) para(acc, reg, F.body, MONO.ink)
    else para("—", reg, F.body, MONO.faint)

    // ============================================================
    // MONEY
    // ============================================================
    if (isEntrega) {
      section(manoDeObra != null ? "Trabajo realizado — detalle y mano de obra" : "Trabajo realizado — detalle")
      if (trabajosRaw.length > 0) {
        if (trabajos.length > 0) {
          detailRows(
            trabajos,
            (item) => {
              const qty = item.cantidad ? `x${item.cantidad}` : ""
              return [`${cap("rowtext", safe(item.nombre)) || "—"}${qty ? ` ${qty}` : ""}`, item.importe]
            },
            (n) => `+${n} ítem${n === 1 ? "" : "s"} más`,
          )
        } else {
          para("Sin ítems con precio de venta cargado.", reg, F.small, MONO.faint)
        }
        if (omitted > 0) para(`${omitted} ítem${omitted === 1 ? "" : "s"} sin precio de venta cargado`, reg, F.small, MONO.faint)
      } else {
        para("Sin trabajos registrados.", reg, F.small, MONO.faint)
      }

      const totalValue = data.costoFinal != null ? data.costoFinal : data.presupuesto != null ? data.presupuesto : null
      const totalLabel = data.costoFinal != null ? "TOTAL FINAL" : "PRESUPUESTO"
      y -= gp(3)
      if (data.presupuesto != null && data.costoFinal != null) amountRow("Presupuesto estimado", fmtMoney(data.presupuesto), { color: MONO.label })
      if (trabajosRaw.length > 0) amountRow("Subtotal trabajo", fmtMoney(subtotal), { color: MONO.label })
      if (manoDeObra != null) amountRow("Mano de obra y otros", fmtMoney(manoDeObra), { color: MONO.label })
      if (totalValue != null) {
        drawRule(page, left, right, y - gp(1) - lost, { color: MONO.ink, thickness: 1.4 })
        y -= gp(4) + lost
        amountRow(totalLabel, fmtMoney(totalValue), { labelFont: bold, amountFont: condBold, size: (M.body + 1.5) * f })
      }
      if (data.descuentoCobro) amountRow("Descuento", `-${fmtMoney(data.descuentoCobro)}`, { color: MONO.label })

      if (totalValue != null || data.motivoSinCobro) {
        const saldoLabel = data.costoFinal != null ? "SALDO" : "SALDO ESTIMADO"
        let saldoText: string
        if (data.motivoSinCobro) {
          saldoText = `SIN COBRO — ${cap("rowtext", motivoSinCobro)}`
        } else {
          const saldo = Math.max((totalValue as number) - (data.descuentoCobro ?? 0) - (data.totalCobrado ?? 0), 0)
          saldoText = saldo <= 0 ? `${fmtMoney(0)} — PAGADO` : fmtMoney(saldo)
        }
        // Band: the label on the left, the amount on the right; a long text (SIN COBRO — reason) wraps under it.
        const size = (M.body + 1) * f
        const sw = textW(condBold, size, saldoText)
        const labelW = textW(bold, size, saldoLabel)
        const fitsOneLine = labelW + sw + 20 * f <= contentW
        const textLines = fitsOneLine ? [saldoText] : wr(saldoText, condBold, size, contentW - 12 * f)
        const pad = gp(4)
        const bandH = lh(size) * (fitsOneLine ? 1 : 1 + textLines.length) + pad * 2
        y -= gp(3)
        page.drawRectangle({ x: left, y: y - bandH, width: contentW, height: bandH, color: MONO.ink })
        page.drawText(saldoLabel, { x: left + 6 * f, y: y - pad - size, size, font: bold, color: MONO.white })
        if (fitsOneLine) {
          page.drawText(saldoText, { x: right - 6 * f - sw, y: y - pad - size, size, font: condBold, color: MONO.white })
        } else {
          textLines.forEach((l, i) => {
            page.drawText(l, { x: left + 6 * f, y: y - pad - size - (i + 1) * lh(size), size, font: condBold, color: MONO.white })
          })
        }
        y -= bandH
      }

      if (cobros.length > 0) {
        section("Pagos registrados")
        detailRows(
          cobros,
          (c) => {
            const fecha = c.fecha instanceof Date ? c.fecha : new Date(c.fecha as unknown as string)
            const label = [Number.isNaN(fecha.getTime()) ? "" : fmtShort(fecha), cap("rowtext", safe(c.metodo)), c.referencia ? cap("rowtext", safe(c.referencia)) : ""]
              .filter(Boolean)
              .join(" · ")
            return [label, c.monto]
          },
          (n) => `+${n} pago${n === 1 ? "" : "s"} más`,
        )
      }
    } else if (data.presupuesto || data.sena) {
      const presup = Number(data.presupuesto) || 0
      const sena = Number(data.sena) || 0
      section("Presupuesto")
      amountRow("Presupuesto estimado", fmtMoney(presup))
      amountRow(`Seña abonada${metodoSena ? " · " + cap("rowtext", metodoSena) : ""}`, fmtMoney(sena))
      drawRule(page, left, right, y - gp(1) - lost, { color: MONO.ink, thickness: 1.2 })
      y -= gp(4) + lost
      amountRow("Saldo estimado", fmtMoney(Math.max(presup - sena, 0)), { labelFont: bold, amountFont: condBold, size: (M.body + 1.5) * f })
    }

    const fechaPrometida = fmtDate(data.fechaPrometida)
    if (!isEntrega && fechaPrometida) {
      y -= gp(3)
      const a = "Retiro estimado: "
      page.drawText(a, { x: left, y: y - F.body, size: F.body, font: reg, color: MONO.ink })
      page.drawText(fechaPrometida, { x: left + textW(reg, F.body, a), y: y - F.body, size: F.body, font: bold, color: MONO.ink })
      y -= lh(F.body)
      para("Te avisamos ante cada cambio de estado.", reg, F.small, MONO.label)
    }

    // ============================================================
    // CHECKLIST (delivered orders only)
    // ============================================================
    const notasChecklist = cap("checklistNotes", checklistNotas)
    const groupsShown = checklistLines.map((g) => ({ title: g.title, text: cap("checklist", g.text) })).filter((g) => g.text)
    if (groupsShown.length > 0 || notasChecklist) {
      section("Chequeo de recepción")
      for (const group of groupsShown) {
        page.drawText(group.title, { x: left, y: y - F.small, size: F.small, font: bold, color: MONO.label })
        y -= lh(F.small)
        para(group.text, reg, F.body, MONO.ink)
      }
      if (notasChecklist) para(notasChecklist, reg, F.small, MONO.label)
    }

    // ============================================================
    // WARRANTY (delivered orders)
    // ============================================================
    if (isEntrega && data.garantia) {
      const head = `GARANTÍA ${data.garantia.dias} DÍAS`
      const notas = [cap("garantia", garantiaNotas), `Presentá este comprobante o el código ${codigoOrden || numeroOrdenPadded} para reclamos.`].filter(Boolean).join(" ")
      const innerW = contentW - 12 * f
      const headLines = wr(head, condBlack, F.heading, innerW)
      const vigente = `Vigente hasta el ${fmtDate(data.garantia.fechaVencimiento)}`
      const vigenteLines = wr(vigente, bold, F.body, innerW)
      const notasLines = wr(notas, reg, F.small, innerW)
      const boxH = gp(12) + lh(F.heading) * headLines.length + lh(F.body) * vigenteLines.length + lh(F.small) * notasLines.length
      y -= gp(6)
      page.drawRectangle({ x: left, y: y - boxH, width: contentW, height: boxH, borderColor: MONO.ink, borderWidth: 1.2 })
      let gy = y - gp(6)
      for (const l of headLines) {
        page.drawText(l, { x: left + 6 * f, y: gy - F.heading, size: F.heading, font: condBlack, color: MONO.ink })
        gy -= lh(F.heading)
      }
      for (const l of vigenteLines) {
        page.drawText(l, { x: left + 6 * f, y: gy - F.body, size: F.body, font: bold, color: MONO.ink })
        gy -= lh(F.body)
      }
      for (const l of notasLines) {
        page.drawText(l, { x: left + 6 * f, y: gy - F.small, size: F.small, font: reg, color: MONO.label })
        gy -= lh(F.small)
      }
      y -= boxH
    }

    // ============================================================
    // WHO / NOTES
    // ============================================================
    const notasEntregaShown = cap("notes", notasEntrega)
    const recibidoShown = cap("people", recibidoPor)
    const tecnicoShown = cap("people", tecnico)
    if (recibidoShown || tecnicoShown || entregadoShown || notasEntregaShown) {
      y -= gp(4)
      const who: Array<[string, string]> = []
      if (recibidoShown) who.push(["Recibió: ", recibidoShown])
      if (tecnicoShown) who.push(["Técnico: ", tecnicoShown])
      if (entregadoShown) who.push(["Entregó: ", entregadoShown])
      labelValues(who, F.body)
      if (notasEntregaShown) para(`Notas de entrega: ${notasEntregaShown}`, reg, F.small, MONO.label)
    }

    // ============================================================
    // TERMS
    // ============================================================
    // Terms are never removed in silence: when they are cut, one line says where to get the rest.
    const termsCut = P.caps.terms !== undefined && P.caps.terms < textLengths.terms
    const shownTerms = cutTerms(terminos, P.caps.terms)
    if (shownTerms.length > 0 || termsCut) {
      section("Términos y condiciones")
      for (const raw of shownTerms) {
        para(raw, reg, F.terms, MONO.label)
        y -= gp(1.5)
      }
      if (termsCut) {
        para(TERMS_CUT_NOTE, bold, F.terms, MONO.label)
        y -= gp(1.5)
      }
    }

    // The signature block closes the sheet, at the bottom margin, under what the customer agrees to.
    const finalTop = M.margin + finalHeight
    drawFinal(finalTop)
    return y - finalTop
  }

  // ============================================================
  // FIT
  // ============================================================
  let attempts = 0
  const fits = (P: FitParams) => {
    attempts += 1
    return layout(DRY, P) >= -0.01
  }

  /** One stage of the last resort that was left at its minimum, to be given room back to. */
  interface Spent {
    apply: (base: FitParams, limit: number) => FitParams
    min: number
    longest: number
  }

  const chooseParams = (): { P: FitParams; step: FitReport["step"] } => {
    const normal: FitParams = { scale: 1, tight: 0, termsSize: M.terms, caps: {} }
    if (fits(normal)) return { P: normal, step: "normal" } // a. as designed

    // b. tighter spacing
    const tightest = { ...normal, tight: 1 }
    if (fits(tightest)) return { P: { ...normal, tight: bisect(1, 0, (v) => fits({ ...normal, tight: v }), 0.1) }, step: "tight" }

    // c. smaller terms (spacing stays tight)
    const smallTerms = { ...tightest, termsSize: floors.terms }
    if (fits(smallTerms)) {
      return { P: { ...tightest, termsSize: bisect(floors.terms, M.terms, (v) => fits({ ...tightest, termsSize: v }), 0.25) }, step: "terms" }
    }

    // d. everything scaled down together, to the floor of the smallest text
    const minScale = floors.text / Math.min(M.body, M.small, M.label)
    const smallest = { ...smallTerms, scale: minScale }
    if (fits(smallest)) return { P: { ...smallTerms, scale: bisect(minScale, 1, (v) => fits({ ...smallTerms, scale: v }), 0.02) }, step: "scale" }

    // e. last resort: cut the longest free text, in a fixed order, each stage with one common
    // limit so the longest field gives first. A stage that cannot fix it alone is left at its
    // minimum and the next one starts from there. The stage that does fix it leaves some room
    // over (the limit is a bisection), which is handed back to the stages left at their minimum,
    // the most important first, so a short cut is not paid for with a field that did not need to go.
    let P = smallest
    const spent: Spent[] = []
    const reclaim = (settled: FitParams): FitParams => {
      let result = settled
      for (let i = spent.length - 1; i >= 0; i--) {
        const { apply, min, longest } = spent[i]
        const base = result
        result = apply(base, Math.floor(bisect(min, longest, (v) => fits(apply(base, Math.floor(v))), CAP_TOLERANCE)))
      }
      return result
    }
    for (const stage of CUT_STAGES) {
      const longest = Math.max(...stage.keys.map((k) => textLengths[k]))
      if (longest <= stage.min) continue
      const apply = (base: FitParams, limit: number): FitParams => ({
        ...base,
        caps: { ...base.caps, ...Object.fromEntries(stage.keys.map((k) => [k, limit])) },
      })
      if (!fits(apply(P, stage.min))) {
        P = apply(P, stage.min)
        spent.push({ apply, min: stage.min, longest })
        continue
      }
      return { P: reclaim(apply(P, Math.floor(bisect(stage.min, longest, (v) => fits(apply(P, Math.floor(v))), CAP_TOLERANCE)))), step: "cut" }
    }

    // f. the budget detail rows: shown up to a limit, the rest summed (the totals are never touched)
    const mostRows = Math.max(trabajos.length, cobros.length)
    if (mostRows > 0) {
      const base = P
      if (fits({ ...base, rows: 0 })) {
        return { P: reclaim({ ...base, rows: Math.floor(bisect(0, mostRows, (v) => fits({ ...base, rows: Math.floor(v) }), 1)) }), step: "rows" }
      }
      P = { ...base, rows: 0 }
    }

    // g. absurd names (hundreds of characters) in the fields that are otherwise never cut
    const longestName = Math.max(empresaNombre.length, clienteNombre.length, clienteRazonSocial.length, equipoTitle.length)
    if (longestName > IDENTITY_FLOOR) {
      const base = P
      if (fits({ ...base, identity: IDENTITY_FLOOR })) {
        return {
          P: reclaim({ ...base, identity: Math.floor(bisect(IDENTITY_FLOOR, longestName, (v) => fits({ ...base, identity: Math.floor(v) }), CAP_TOLERANCE)) }),
          step: "names",
        }
      }
      P = { ...base, identity: IDENTITY_FLOOR }
    }

    // h. the guarantee: an overflowing sheet is never drawn. Below the usual floor, then every paragraph clamped.
    const hardScale = HARD_MIN_FONT / Math.min(M.body, M.small, M.label)
    // first the scale alone (the terms keep their size), then the terms go down to the hard minimum too
    for (const termsSize of [P.termsSize, Math.min(P.termsSize, HARD_MIN_FONT)]) {
      const G: FitParams = { ...P, termsSize }
      if (fits({ ...G, scale: hardScale })) {
        return { P: { ...G, scale: bisect(hardScale, G.scale, (v) => fits({ ...G, scale: v }), 0.01) }, step: "guarantee" }
      }
    }
    const small: FitParams = { ...P, termsSize: Math.min(P.termsSize, HARD_MIN_FONT), scale: hardScale }
    const clamped = (n: number): FitParams => ({ ...small, maxLines: n })
    if (fits(clamped(1))) {
      return { P: clamped(Math.floor(bisect(1, MAX_LINES_BOUND, (v) => fits(clamped(Math.floor(v))), 1))), step: "guarantee" }
    }
    // Not even one line per paragraph: the checklist and the terms go (the terms note stays).
    return { P: { ...clamped(1), caps: { ...P.caps, terms: 0, checklist: 0, checklistNotes: 0 } }, step: "guarantee" }
  }

  const { P: params, step } = chooseParams()
  const page = pdfDoc.addPage([width, height])
  layout(page, params)
  options.report?.({ slack: layout(DRY, params), attempts, scale: params.scale, step })

  const bytes = await pdfDoc.save()
  return Buffer.from(bytes)
}
