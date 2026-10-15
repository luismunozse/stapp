/**
 * Service-order PDF for small paper (A5 and A6).
 *
 * The A4 order (generateOrdenPDF in lib/pdf.ts) is a fixed two-zone page: customer part on
 * top, a cut line, the workshop stub below. Printed on an A6 sheet every text shrinks to
 * half its size and nobody can read it. This is a different layout, not a scaled copy:
 * ONE column, one customer copy, fonts sized for the sheet it is printed on, and a cursor
 * that flows onto an extra page whenever the content does not fit. Nothing is capped or
 * truncated to make it fit: a long problem description or long terms simply take another page.
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
  /** Secondary text. Never below the minimum legible size of the sheet. */
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
 * Smallest text on A6 is 8pt and on A5 9pt (the A4 sheet printed on A6 comes out at about
 * 4.5pt). The tests pin these minimums.
 */
const METRICS: Record<CompactPapel, Metrics> = {
  A6: { margin: 16, body: 8.5, small: 8, label: 8, terms: 8, heading: 12, number: 19, qr: 52, logo: 36, sigArea: 26 },
  A5: { margin: 24, body: 10, small: 9, label: 9, terms: 9, heading: 15, number: 24, qr: 60, logo: 46, sigArea: 32 },
}

const LINE = 1.25

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

const safe = (val: unknown): string => {
  if (val === null || val === undefined) return ""
  if (typeof val === "string") return val.replace(/[\r\n]+/g, " ").trim()
  if (typeof val === "number") return String(val)
  return ""
}

export async function generateOrdenCompactPDF(data: OrdenPDFData, papel: CompactPapel): Promise<Buffer> {
  const [width, height] = ORDEN_PAGE_POINTS[papel]
  const M = METRICS[papel]
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

  // ---- document, fonts, page cursor ----
  const pdfDoc = await PDFLib.create()
  const { archivoRegular: reg, archivoBold: bold, archivoBlack: black, archivoCondensedBold: condBold, archivoCondensedBlack: condBlack, plexMonoRegular: mono } =
    await embedExpedienteFonts(pdfDoc)

  const left = M.margin
  const right = width - M.margin
  const contentW = width - M.margin * 2
  const bottomLimit = M.margin + M.small * 1.8 // room for the page counter
  const lh = (size: number) => size * LINE
  const textW = (font: PDFFont, size: number, s: string) => font.widthOfTextAtSize(s, size)
  const measure = (font: PDFFont, size: number) => (s: string) => font.widthOfTextAtSize(s, size)

  const pages: PDFPage[] = []
  let page!: PDFPage
  let y = 0

  const newPage = () => {
    page = pdfDoc.addPage([width, height])
    pages.push(page)
    y = height - M.margin
    if (pages.length > 1) {
      // Continuation page: say whose sheet this is.
      // The workshop name is cut with an ellipsis if it is longer than the line: this is a
      // repeated running header, the full name is on page 1.
      let head = `${numeroOrdenPadded} · ${empresaNombre}`
      const maxW = contentW - 40 // leaves room for the page counter
      if (textW(bold, M.small, head) > maxW) {
        // longest prefix that still fits together with the ellipsis (bisected, not walked down)
        const n = fitPrefix(head, (s) => textW(bold, M.small, s + "…"), maxW)
        head = head.slice(0, n) + "…"
      }
      page.drawText(head, { x: left, y: y - M.small, size: M.small, font: bold, color: MONO.ink })
      y -= lh(M.small) + 2
      drawRule(page, left, right, y, { color: MONO.ink, thickness: 1 })
      y -= 6
    }
  }
  const ensure = (h: number) => {
    if (y - h < bottomLimit) newPage()
  }
  newPage()

  /** Wrapped text that flows across pages line by line. */
  const para = (text: string, font: PDFFont, size: number, color: RGB, opts: { x?: number; width?: number } = {}) => {
    const x = opts.x ?? left
    for (const l of wrapText(text, measure(font, size), opts.width ?? contentW)) {
      ensure(lh(size))
      page.drawText(l, { x, y: y - size, size, font, color })
      y -= lh(size)
    }
  }

  /** Rule + uppercase label. Keeps the label with at least one line of what follows. */
  const section = (label: string) => {
    ensure(6 + lh(M.label) + lh(M.body) + 4)
    y -= 3
    drawRule(page, left, right, y)
    y -= 5
    page.drawText(label.toUpperCase(), { x: left, y: y - M.label, size: M.label, font: bold, color: MONO.label })
    y -= lh(M.label) + 1
  }

  /** Label on the left (wraps), amount flush right on the first line. The row is kept together. */
  const amountRow = (label: string, amount: string, o: { labelFont?: PDFFont; amountFont?: PDFFont; size?: number; color?: RGB } = {}) => {
    const size = o.size ?? M.body
    const labelFont = o.labelFont ?? reg
    const amountFont = o.amountFont ?? mono
    const aw = textW(amountFont, size, amount)
    const lines = wrapText(label, measure(labelFont, size), Math.max(contentW - aw - 8, contentW * 0.3))
    ensure(lh(size) * lines.length)
    lines.forEach((l, i) => {
      page.drawText(l, { x: left, y: y - size - i * lh(size), size, font: labelFont, color: o.color ?? MONO.ink })
    })
    page.drawText(amount, { x: right - aw, y: y - size, size, font: amountFont, color: MONO.ink })
    y -= lh(size) * lines.length
  }

  /**
   * "Label: value" pairs side by side on one line, moving to the next line when the next pair
   * does not fit. A pair wider than the whole line is written as a wrapped bold paragraph.
   */
  const labelValues = (pairs: Array<[string, string]>, size: number) => {
    const GAP = 12
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
      const pagesBefore = pages.length
      ensure(lh(size))
      if (pages.length !== pagesBefore) x = left // started a new page: the line starts again at the margin
      page.drawText(label, { x, y: y - size, size, font: reg, color: MONO.label })
      page.drawText(value, { x: x + lw, y: y - size, size, font: bold, color: MONO.ink })
      x += w + GAP
      open = true
    }
    if (open) y -= lh(size)
  }

  const embedImage = async (b64: string | null | undefined): Promise<PDFImage | null> => {
    if (!b64) return null
    try {
      return await pdfDoc.embedPng(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))
    } catch {
      return null // an unreadable signature leaves the line blank, like the A4 sheet
    }
  }

  // ============================================================
  // HEADER: logo, workshop, order number
  // ============================================================
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

  const headerTop = y
  if (logo) {
    page.drawRectangle({ x: left, y: headerTop - M.logo, width: M.logo, height: M.logo, borderColor: MONO.ink, borderWidth: 1 })
    const s = logo.scale(1)
    const inset = 3
    const ratio = Math.min((M.logo - inset * 2) / s.width, (M.logo - inset * 2) / s.height)
    page.drawImage(logo, {
      x: left + (M.logo - s.width * ratio) / 2,
      y: headerTop - M.logo + (M.logo - s.height * ratio) / 2,
      width: s.width * ratio,
      height: s.height * ratio,
    })
  }

  // right column: order number and internal code
  const numW = textW(condBlack, M.number, numeroOrdenPadded)
  const codeW = codigoOrden ? textW(mono, M.small, codigoOrden) : 0
  const rightColW = Math.max(numW, codeW)
  page.drawText(numeroOrdenPadded, { x: right - numW, y: headerTop - M.number, size: M.number, font: condBlack, color: MONO.ink })
  let rightBottom = headerTop - lh(M.number)
  if (codigoOrden) {
    page.drawText(codigoOrden, { x: right - codeW, y: rightBottom - M.small, size: M.small, font: mono, color: MONO.label })
    rightBottom -= lh(M.small)
  }

  // left column: workshop name, branch, contact
  const bizX = left + (logo ? M.logo + 8 : 0)
  const bizW = right - rightColW - 8 - bizX
  let by = headerTop
  for (const l of wrapText(empresaNombre, measure(black, M.heading), bizW)) {
    page.drawText(l, { x: bizX, y: by - M.heading, size: M.heading, font: black, color: MONO.ink })
    by -= lh(M.heading)
  }
  const sucursalNombre = data.sucursal ? safe(data.sucursal.nombre) : ""
  const sucursalDireccion = data.sucursal ? safe(data.sucursal.direccion) : ""
  const sucursalTelefono = data.sucursal ? safe(data.sucursal.telefono) : ""
  // Branch name on its own line; address, city and phone run together and wrap (on a narrow
  // sheet one line per datum costs more height than the information is worth).
  const shopLines = [
    sucursalNombre,
    [
      sucursalDireccion || safe(data.direccionEmpresa),
      [safe(data.ciudadEmpresa), safe(data.provinciaEmpresa)].filter(Boolean).join(", "),
      sucursalTelefono || safe(data.telefonoEmpresa),
    ]
      .filter(Boolean)
      .join(" · "),
  ].filter(Boolean)
  for (const text of shopLines) {
    for (const l of wrapText(text, measure(reg, M.small), bizW)) {
      page.drawText(l, { x: bizX, y: by - M.small, size: M.small, font: reg, color: MONO.label })
      by -= lh(M.small)
    }
  }
  y = Math.min(by, rightBottom, logo ? headerTop - M.logo : headerTop) - 4
  drawRule(page, left, right, y, { color: MONO.ink, thickness: 1.3 })
  y -= 6

  // status row: state tag (ink fill) + dates
  const tagText = estadoDisplay.toUpperCase()
  const tagPad = 4
  const tagW = textW(bold, M.label, tagText) + tagPad * 2
  const tagH = lh(M.label) + 1
  ensure(tagH + lh(M.small))
  page.drawRectangle({ x: left, y: y - tagH, width: tagW, height: tagH, color: MONO.ink })
  page.drawText(tagText, { x: left + tagPad, y: y - tagH + (tagH - M.label) / 2 + M.label * 0.18, size: M.label, font: bold, color: MONO.white })
  const ingreso = fmtDate(data.fechaIngreso)
  const dateParts = isEntrega
    ? [
        ingreso ? `Ingreso ${ingreso}` : "",
        data.fechaCompletado ? `Completado ${fmtDate(data.fechaCompletado)}` : "",
        data.fechaEntrega ? `Entrega ${fmtDate(data.fechaEntrega)}` : "",
      ].filter(Boolean)
    : [ingreso ? `Ingreso ${ingreso}` : ""].filter(Boolean)
  const dateText = dateParts.join(" · ")
  const dateAfterTagW = contentW - tagW - 8
  if (dateText && textW(reg, M.small, dateText) <= dateAfterTagW) {
    page.drawText(dateText, { x: right - textW(reg, M.small, dateText), y: y - tagH + (tagH - M.small) / 2 + M.small * 0.18, size: M.small, font: reg, color: MONO.label })
    y -= tagH + 4
  } else {
    y -= tagH + 3
    if (dateText) para(dateText, reg, M.small, MONO.label)
    y -= 1
  }
  if (data.esReingreso && data.ordenOrigenNumero) {
    para(`Reingreso de #${String(data.ordenOrigenNumero).padStart(4, "0")}`, reg, M.small, MONO.label)
  }

  // ============================================================
  // CLIENTE / EQUIPO
  // ============================================================
  section("Cliente")
  if (isEmpresa) {
    para(`${clienteRazonSocial}${clienteCuit ? ` · ${labelIdFiscal} ${clienteCuit}` : ""}`, bold, M.body, MONO.ink)
    para(`Contacto: ${clienteNombre}${clienteDni ? ` · ${labelIdPersonal} ${clienteDni}` : ""}`, reg, M.small, MONO.label)
  } else {
    const idSuffix = clienteDni ? ` · ${labelIdPersonal} ${clienteDni}` : clienteCuit ? ` · ${labelIdFiscal} ${clienteCuit}` : ""
    para(`${clienteNombre}${idSuffix}`, bold, M.body, MONO.ink)
  }
  const tel = [clienteTelefono]
  if (telefonoContacto && telefonoContacto !== clienteTelefono) tel.push(`tel. de esta orden: ${telefonoContacto}`)
  para(tel.join(" · "), reg, M.small, MONO.label)
  if (isEntrega && clienteEmail) para(clienteEmail, reg, M.small, MONO.label)

  section(t(term, "equipo"))
  para(equipoTitle || dispositivo, bold, M.body, MONO.ink)
  if (imei) para(`${identificadorLabel} ${imei}`, mono, M.body, MONO.ink)
  if (metadataCampos.length > 0) {
    para(metadataCampos.map((m) => `${m.label}: ${m.valor}`).join(" · "), reg, M.small, MONO.label)
  }

  section("Falla declarada")
  para(problema, reg, M.body, MONO.ink)

  const diagnostico = safe(data.diagnostico)
  if (isEntrega && diagnostico) {
    section("Diagnóstico técnico")
    para(diagnostico, reg, M.body, MONO.ink)
  }
  const observaciones = safe(data.observaciones)
  if (!isEntrega && observaciones) {
    section("Observaciones")
    para(observaciones, reg, M.body, MONO.ink)
  }

  section("Accesorios recibidos")
  if (accesorios) para(accesorios, reg, M.body, MONO.ink)
  else para("—", reg, M.body, MONO.faint)

  // ============================================================
  // MONEY
  // ============================================================
  if (isEntrega) {
    // ---- Trabajo realizado (detail + totals), same rules as the A4 ENTREGA sheet ----
    const trabajosRaw = Array.isArray(data.trabajos) ? data.trabajos : []
    const trabajos = trabajosRaw.filter((it) => (Number(it.importe) || 0) !== 0)
    const omitted = trabajosRaw.length - trabajos.length
    const subtotal = trabajosRaw.reduce((sum, it) => sum + (Number(it.importe) || 0), 0)
    const manoDeObra =
      data.costoFinal != null && trabajosRaw.length > 0 && data.costoFinal > subtotal ? data.costoFinal - subtotal : null

    section(manoDeObra != null ? "Trabajo realizado — detalle y mano de obra" : "Trabajo realizado — detalle")
    if (trabajosRaw.length > 0) {
      if (trabajos.length > 0) {
        for (const item of trabajos) {
          const qty = item.cantidad ? `x${item.cantidad}` : ""
          amountRow(`${safe(item.nombre) || "—"}${qty ? ` ${qty}` : ""}`, fmtMoney(item.importe))
        }
      } else {
        para("Sin ítems con precio de venta cargado.", reg, M.small, MONO.faint)
      }
      if (omitted > 0) para(`${omitted} ítem${omitted === 1 ? "" : "s"} sin precio de venta cargado`, reg, M.small, MONO.faint)
    } else {
      para("Sin trabajos registrados.", reg, M.small, MONO.faint)
    }

    const totalValue = data.costoFinal != null ? data.costoFinal : data.presupuesto != null ? data.presupuesto : null
    const totalLabel = data.costoFinal != null ? "TOTAL FINAL" : "PRESUPUESTO"
    // The totals and the SALDO band read as one unit: keep them on the same page.
    const totalRows =
      (data.presupuesto != null && data.costoFinal != null ? 1 : 0) +
      (trabajosRaw.length > 0 ? 1 : 0) +
      (manoDeObra != null ? 1 : 0) +
      (totalValue != null ? 1 : 0) +
      (data.descuentoCobro ? 1 : 0)
    ensure(lh(M.body + 1.5) * (totalRows + 1) + lh(M.body + 1) * 3 + 20)
    y -= 3
    if (data.presupuesto != null && data.costoFinal != null) amountRow("Presupuesto estimado", fmtMoney(data.presupuesto), { color: MONO.label })
    if (trabajosRaw.length > 0) amountRow("Subtotal trabajo", fmtMoney(subtotal), { color: MONO.label })
    if (manoDeObra != null) amountRow("Mano de obra y otros", fmtMoney(manoDeObra), { color: MONO.label })
    if (totalValue != null) {
      ensure(lh(M.body) * 2 + 4)
      drawRule(page, left, right, y - 1, { color: MONO.ink, thickness: 1.4 })
      y -= 4
      amountRow(totalLabel, fmtMoney(totalValue), { labelFont: bold, amountFont: condBold, size: M.body + 1.5 })
    }
    if (data.descuentoCobro) amountRow("Descuento", `-${fmtMoney(data.descuentoCobro)}`, { color: MONO.label })

    if (totalValue != null || data.motivoSinCobro) {
      const saldoLabel = data.costoFinal != null ? "SALDO" : "SALDO ESTIMADO"
      let saldoText: string
      if (data.motivoSinCobro) {
        const motivo = MOTIVO_SIN_COBRO_LABELS[data.motivoSinCobro as MotivoSinCobro] || data.motivoSinCobro
        saldoText = `SIN COBRO — ${motivo}`
      } else {
        const saldo = Math.max((totalValue as number) - (data.descuentoCobro ?? 0) - (data.totalCobrado ?? 0), 0)
        saldoText = saldo <= 0 ? `${fmtMoney(0)} — PAGADO` : fmtMoney(saldo)
      }
      // Band: the label on the left, the amount on the right; a long text (SIN COBRO — reason) wraps under it.
      const size = M.body + 1
      const sw = textW(condBold, size, saldoText)
      const labelW = textW(bold, size, saldoLabel)
      const fitsOneLine = labelW + sw + 20 <= contentW
      const textLines = fitsOneLine ? [saldoText] : wrapText(saldoText, measure(condBold, size), contentW - 12)
      const bandH = lh(size) * (fitsOneLine ? 1 : 1 + textLines.length) + 8
      ensure(bandH + 4)
      y -= 3
      page.drawRectangle({ x: left, y: y - bandH, width: contentW, height: bandH, color: MONO.ink })
      page.drawText(saldoLabel, { x: left + 6, y: y - 4 - size, size, font: bold, color: MONO.white })
      if (fitsOneLine) {
        page.drawText(saldoText, { x: right - 6 - sw, y: y - 4 - size, size, font: condBold, color: MONO.white })
      } else {
        textLines.forEach((l, i) => {
          page.drawText(l, { x: left + 6, y: y - 4 - size - (i + 1) * lh(size), size, font: condBold, color: MONO.white })
        })
      }
      y -= bandH
    }

    const cobros = Array.isArray(data.cobros) ? data.cobros : []
    if (cobros.length > 0) {
      section("Pagos registrados")
      for (const c of cobros) {
        const fecha = c.fecha instanceof Date ? c.fecha : new Date(c.fecha as unknown as string)
        const left_ = [Number.isNaN(fecha.getTime()) ? "" : fmtShort(fecha), safe(c.metodo), c.referencia ? safe(c.referencia) : ""]
          .filter(Boolean)
          .join(" · ")
        amountRow(left_, fmtMoney(c.monto))
      }
    }
  } else if (data.presupuesto || data.sena) {
    const presup = Number(data.presupuesto) || 0
    const sena = Number(data.sena) || 0
    section("Presupuesto")
    amountRow("Presupuesto estimado", fmtMoney(presup))
    amountRow(`Seña abonada${data.metodoPagoSena ? " · " + data.metodoPagoSena : ""}`, fmtMoney(sena))
    ensure(lh(M.body) * 2 + 4)
    drawRule(page, left, right, y - 1, { color: MONO.ink, thickness: 1.2 })
    y -= 4
    amountRow("Saldo estimado", fmtMoney(Math.max(presup - sena, 0)), { labelFont: bold, amountFont: condBold, size: M.body + 1.5 })
  }

  const fechaPrometida = fmtDate(data.fechaPrometida)
  if (!isEntrega && fechaPrometida) {
    y -= 3
    ensure(lh(M.body))
    const a = "Retiro estimado: "
    page.drawText(a, { x: left, y: y - M.body, size: M.body, font: reg, color: MONO.ink })
    page.drawText(fechaPrometida, { x: left + textW(reg, M.body, a), y: y - M.body, size: M.body, font: bold, color: MONO.ink })
    y -= lh(M.body)
    para("Te avisamos ante cada cambio de estado.", reg, M.small, MONO.label)
  }

  // ============================================================
  // CHECKLIST
  // ============================================================
  // Delivered orders only, like A4: on the RECEPCION sheet the checklist lives on the internal
  // stub, which this single customer copy does not have.
  const checklist = isEntrega && Array.isArray(data.checklistItems) ? data.checklistItems : []
  const checklistNotas = isEntrega ? safe(data.checklistNotas) : ""
  if (checklist.length > 0 || checklistNotas) {
    section("Chequeo de recepción")
    const CATEGORIAS: Record<string, string> = {
      FUNCIONAL: "Funcional",
      CONDICION_FISICA: "Condición física",
      ACCESORIOS: "Accesorios",
      OTRO: "Otro",
      GENERAL: "General",
    }
    const groups = new Map<string, typeof checklist>()
    for (const item of checklist) {
      const cat = safe(item.categoria).toUpperCase() || "GENERAL"
      if (!groups.has(cat)) groups.set(cat, [])
      groups.get(cat)!.push(item)
    }
    for (const [cat, items] of groups) {
      ensure(lh(M.small) + lh(M.body))
      page.drawText(CATEGORIAS[cat] || cat, { x: left, y: y - M.small, size: M.small, font: bold, color: MONO.label })
      y -= lh(M.small)
      para(
        items
          .map((it) => {
            const v = it.valor === true ? "OK" : it.valor === false ? "NO" : safe(it.valor)
            return `${it.label}: ${v}`
          })
          .join(" · "),
        reg,
        M.body,
        MONO.ink,
      )
    }
    if (checklistNotas) para(checklistNotas, reg, M.small, MONO.label)
  }

  // ============================================================
  // WARRANTY (delivered orders)
  // ============================================================
  if (isEntrega && data.garantia) {
    const head = `GARANTÍA ${data.garantia.dias} DÍAS`
    const notas = [safe(data.garantia.notas), `Presentá este comprobante o el código ${codigoOrden || numeroOrdenPadded} para reclamos.`]
      .filter(Boolean)
      .join(" ")
    const innerW = contentW - 12
    const headLines = wrapText(head, measure(condBlack, M.heading), innerW)
    const vigente = `Vigente hasta el ${fmtDate(data.garantia.fechaVencimiento)}`
    const vigenteLines = wrapText(vigente, measure(bold, M.body), innerW)
    const notasLines = wrapText(notas, measure(reg, M.small), innerW)
    const boxH = 12 + lh(M.heading) * headLines.length + lh(M.body) * vigenteLines.length + lh(M.small) * notasLines.length
    ensure(boxH + 8)
    y -= 6
    page.drawRectangle({ x: left, y: y - boxH, width: contentW, height: boxH, borderColor: MONO.ink, borderWidth: 1.2 })
    let gy = y - 6
    for (const l of headLines) {
      page.drawText(l, { x: left + 6, y: gy - M.heading, size: M.heading, font: condBlack, color: MONO.ink })
      gy -= lh(M.heading)
    }
    for (const l of vigenteLines) {
      page.drawText(l, { x: left + 6, y: gy - M.body, size: M.body, font: bold, color: MONO.ink })
      gy -= lh(M.body)
    }
    for (const l of notasLines) {
      page.drawText(l, { x: left + 6, y: gy - M.small, size: M.small, font: reg, color: MONO.label })
      gy -= lh(M.small)
    }
    y -= boxH
  }

  // ============================================================
  // WHO / NOTES
  // ============================================================
  const recibidoPor = safe(data.recibidoPorNombre)
  const tecnico = safe(data.tecnicoNombre)
  const entregadoPor = safe(data.entregadoPor)
  const notasEntrega = isEntrega ? safe(data.notasEntrega) : ""
  if (recibidoPor || tecnico || entregadoPor || notasEntrega) {
    y -= 4
    const who: Array<[string, string]> = []
    if (recibidoPor) who.push(["Recibió: ", recibidoPor])
    if (tecnico) who.push(["Técnico: ", tecnico])
    if (entregadoPor) who.push(["Entregó: ", entregadoPor])
    labelValues(who, M.body)
    if (notasEntrega) para(`Notas de entrega: ${notasEntrega}`, reg, M.small, MONO.label)
  }

  // ============================================================
  // QR + SIGNATURES + TERMS
  // ============================================================
  // Order: terms first, then the signature, which closes the document (on A4 the small print
  // goes under the signature; here the sheet flows over several pages and the customer signs
  // at the very end, below what they agree to). The last paragraph of the terms always travels
  // with the signature block, so a signature can never be alone on a page.
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
  /** Height of a signature area, its rule and the label (wrapped) under it, in a column of width w. */
  const sigHeight = (s: Sig, w: number) => M.sigArea + 3 + wrapText(s.label.toUpperCase(), measure(bold, M.label), w).length * lh(M.label) + 4
  /** Draws it inside [x, x + w] from `top` down. */
  const drawSig = (s: Sig, x: number, w: number, top: number) => {
    if (s.image) {
      const dims = s.image.scale(1)
      const ratio = Math.min((w * 0.8) / dims.width, (M.sigArea - 4) / dims.height)
      page.drawImage(s.image, { x: x + (w - dims.width * ratio) / 2, y: top - M.sigArea + 2, width: dims.width * ratio, height: dims.height * ratio })
    }
    drawRule(page, x, x + w, top - M.sigArea, { color: MONO.ink })
    let ly = top - M.sigArea - 3
    for (const l of wrapText(s.label.toUpperCase(), measure(bold, M.label), w)) {
      page.drawText(l, { x, y: ly - M.label, size: M.label, font: bold, color: MONO.label })
      ly -= lh(M.label)
    }
  }

  let finalHeight: number
  let drawFinal: () => void
  if (!isEntrega) {
    // One signature: QR on the left, caption and signature line on the right (as on A4).
    const sig: Sig = { label: "Firma del cliente", image: await embedImage(data.firmaRecepcion) }
    const colX = qr ? left + M.qr + 12 : left
    const colW = right - colX
    const capLines = qr ? wrapText(caption, measure(reg, M.small), colW) : []
    const capH = capLines.length ? capLines.length * lh(M.small) + 2 : 0
    const blockH = Math.max(qr ? M.qr : 0, capH + sigHeight(sig, colW))
    finalHeight = blockH + 4
    drawFinal = () => {
      y -= 4
      if (qr) page.drawImage(qr, { x: left, y: y - M.qr, width: M.qr, height: M.qr })
      capLines.forEach((l, i) => {
        page.drawText(l, { x: colX, y: y - M.small - i * lh(M.small), size: M.small, font: reg, color: MONO.label })
      })
      drawSig(sig, colX, colW, y - capH)
      y -= blockH
    }
  } else {
    // Delivery sheet: the QR block now (before the terms), the three signatures at the end.
    if (qr) {
      const capLines = wrapText(caption, measure(reg, M.small), contentW - M.qr - 10)
      const blockH = Math.max(M.qr, capLines.length * lh(M.small))
      ensure(blockH + 6)
      y -= 4
      page.drawImage(qr, { x: left, y: y - M.qr, width: M.qr, height: M.qr })
      capLines.forEach((l, i) => {
        page.drawText(l, { x: left + M.qr + 10, y: y - M.small - 2 - i * lh(M.small), size: M.small, font: reg, color: MONO.label })
      })
      y -= blockH
    }
    const sigs: Sig[] = [
      { label: data.firmaRecepcion ? "Cliente — recepción (en archivo)" : "Cliente — recepción", image: null },
      { label: "Cliente — entrega", image: await embedImage(data.firmaClienteEntrega) },
      { label: entregadoPor ? `Entregó — ${entregadoPor}` : "Entregó", image: await embedImage(data.firmaEncargadoEntrega) },
    ]
    finalHeight = sigs.reduce((sum, s) => sum + sigHeight(s, contentW), 0) + 4
    drawFinal = () => {
      y -= 4
      for (const s of sigs) {
        drawSig(s, left, contentW, y)
        y -= sigHeight(s, contentW)
      }
    }
  }

  const terminos = parseRecepcionTerminos(data.recepcionTerminos)
  const termHeight = (raw: string) => wrapText(raw, measure(reg, M.terms), contentW).length * lh(M.terms) + 1.5
  if (terminos.length > 0) {
    // A single term: its label must not be left behind on the page before it.
    if (terminos.length === 1) ensure(lh(M.label) + 10 + termHeight(terminos[0]) + finalHeight)
    section("Términos y condiciones")
    terminos.forEach((raw, i) => {
      if (i === terminos.length - 1) ensure(termHeight(raw) + finalHeight)
      para(raw, reg, M.terms, MONO.label)
      y -= 1.5
    })
  }
  ensure(finalHeight)
  drawFinal()

  // ---- page counter (only when there is more than one page) ----
  if (pages.length > 1) {
    pages.forEach((p, i) => {
      const text = `${i + 1}/${pages.length}`
      p.drawText(text, { x: right - textW(bold, M.small, text), y: M.margin, size: M.small, font: bold, color: MONO.label })
    })
  }

  const bytes = await pdfDoc.save()
  return Buffer.from(bytes)
}
