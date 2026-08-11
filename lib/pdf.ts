import { PDFDocument as PDFLib, rgb, StandardFonts } from "pdf-lib"
import fontkitModule from "@pdf-lib/fontkit"
import { readFile } from "fs/promises"
import { join } from "path"
import { formatCurrencyValue, type CurrencyCode, DEFAULT_CURRENCY } from "@/lib/currency"
import { formatDateValue, formatDateTimeValue, DEFAULT_TIMEZONE } from "@/lib/timezone"
import { parseRecepcionTerminos } from "@/lib/terminos"
import QRCode from "qrcode"
import { resolveTerminologia, t, type Terminologia } from "@/lib/terminologia"
import { MONO, TYPE, RULE_WIDTH, drawRule, drawSectionLabel, drawOutlinedBadge, measureBadgeWidth } from "@/lib/pdf-style"

// Compatibilidad: algunos bundlers ponen el default dentro de .default
const fontkit = (fontkitModule as any).default || fontkitModule

// Cache de fuentes para no leer archivos en cada generación
let fontCache: { regular: Buffer; bold: Buffer } | null = null

async function loadFonts() {
  if (fontCache) return fontCache
  const fontsDir = join(process.cwd(), "lib", "fonts")
  const [regular, bold] = await Promise.all([
    readFile(join(fontsDir, "Inter-Regular.ttf")),
    readFile(join(fontsDir, "Inter-Bold.ttf")),
  ])
  fontCache = { regular, bold }
  return fontCache
}

async function embedCustomFonts(pdfDoc: PDFLib) {
  pdfDoc.registerFontkit(fontkit)
  const fonts = await loadFonts()
  const [regular, bold] = await Promise.all([
    pdfDoc.embedFont(fonts.regular, { subset: true }),
    pdfDoc.embedFont(fonts.bold, { subset: true }),
  ])
  return { regular, bold }
}

// ========================================
// COTIZACION PDF (pdf-lib)
// ========================================

interface CotizacionItem {
  descripcion: string
  cantidad: number
  precioUnitario: number
  precio_unitario?: number
  subtotal: number
  unidad?: string
  descuento_tipo?: string
  descuento_valor?: number
  descuentoTipo?: string
  descuentoValor?: number
  tipo_repuesto?: string
  tipoRepuesto?: string
}

interface CotizacionPDFData {
  numeroCotizacion: string
  fecha: Date
  fechaVencimiento?: Date | null
  cliente: {
    nombre: string
    telefono: string
    email?: string | null
    direccion?: string | null
  }
  sector?: {
    nombre: string
  } | null
  orden?: {
    numeroOrden: number
    dispositivo: string
    problemaReportado: string
  }
  // Tipo de cotización. ORDEN (default) mantiene el layout histórico.
  // PRESUPUESTO dibuja un card de "Equipo" con más detalle y sección de checklist.
  tipo?: "ORDEN" | "PRESUPUESTO"
  equipo?: {
    dispositivo: string
    tipoDispositivo?: string | null
    marca?: string | null
    modelo?: string | null
    color?: string | null
    imei?: string | null
    numeroSerie?: string | null
    problemaReportado: string
  } | null
  checklist?: {
    items: Array<{ label: string; valor: string; categoria?: string | null }>
    notas?: string | null
  } | null
  condiciones?: {
    diagnostico: string | null
    plazoEstimadoDias: number | null
    anticipoTipo: string
    anticipoValor: number
    garantiaDias: number
    garantiaAlcance: string
    politicaAbandonoDias: number | null
  } | null
  items: CotizacionItem[]
  subtotal: number
  iva: number
  total: number
  notas?: string | null
  terminos?: string | null
  descuentoGlobalTipo?: string | null
  descuentoGlobalValor?: number | null
  ivaPorcentaje?: number | null
  nombreEmpresa?: string
  telefonoEmpresa?: string | null
  direccionEmpresa?: string | null
  logoUrl?: string | null
  moneda?: string
  zonaHoraria?: string
  firmaAprobacion?: string | null
  firmaMime?: string | null
  fechaAprobacion?: Date | null
}

export async function generateCotizacionPDF(data: CotizacionPDFData): Promise<Buffer> {
  const safe = (val: unknown): string => {
    if (val === null || val === undefined) return ""
    if (typeof val === "string") return val.replace(/[\r\n]+/g, " ").trim()
    if (typeof val === "number") return String(val)
    return ""
  }
  const fmtDate = (d: Date | string | null | undefined): string => {
    if (!d) return ""
    const parsed = new Date(d as string | number)
    if (Number.isNaN(parsed.getTime())) return ""
    return formatDateValue(parsed, data.zonaHoraria || DEFAULT_TIMEZONE)
  }
  const fmtCurrency = (amount: number | string | null | undefined): string => {
    return formatCurrencyValue(amount, (data.moneda as CurrencyCode) || DEFAULT_CURRENCY)
  }

  const empresaNombre = safe(data.nombreEmpresa) || "Servicio Tecnico"
  const telefonoEmpresa = safe(data.telefonoEmpresa)
  const direccionEmpresa = safe(data.direccionEmpresa)
  const cotizacionNumber = safe(data.numeroCotizacion)
  const cotizacionDate = fmtDate(data.fecha)
  const clienteNombre = safe(data.cliente.nombre)
  const clienteTelefono = safe(data.cliente.telefono)
  const clienteEmail = safe(data.cliente.email)
  const clienteDireccion = safe(data.cliente.direccion)
  const sectorNombre = data.sector ? safe(data.sector.nombre) : ""
  const notas = safe(data.notas)
  const terminos = safe(data.terminos)
  const fechaVencimiento = fmtDate(data.fechaVencimiento)
  const descGlobalTipo = safe(data.descuentoGlobalTipo) || "porcentaje"
  const descGlobalValor = Number(data.descuentoGlobalValor) || 0
  const subtotalNum = Number(data.subtotal) || 0
  const ivaNum = Number(data.iva) || 0
  const totalNum = Number(data.total) || 0
  let descGlobalAmount = 0
  if (descGlobalValor > 0) {
    descGlobalAmount = descGlobalTipo === "fijo"
      ? Math.min(descGlobalValor, subtotalNum)
      : subtotalNum * (descGlobalValor / 100)
  }
  const ivaPct = Number(data.ivaPorcentaje) || 0
  const firmaAprobacion = safe(data.firmaAprobacion)
  const firmaMime = safe(data.firmaMime)
  const fechaAprobacion = fmtDate(data.fechaAprobacion)

  const pdfDoc = await PDFLib.create()
  const { regular: helvetica, bold: helveticaBold } = await embedCustomFonts(pdfDoc)

  const pageW = 595
  const pageH = 842
  const marginL = 45
  const marginR = 45
  const contentWidth = pageW - marginL - marginR
  const footerH = 55 // reserved for footer
  const minY = footerH + 10

  // Helper to right-align text
  const drawTextRight = (pg: ReturnType<typeof pdfDoc.addPage>, text: string, x: number, y: number, size: number, font: typeof helvetica, color: ReturnType<typeof rgb>) => {
    const w = font.widthOfTextAtSize(text, size)
    pg.drawText(text, { x: x - w, y, size, font, color })
  }

  // Draw footer on a page
  const drawFooter = (pg: ReturnType<typeof pdfDoc.addPage>, pageNum: number, totalPages: number) => {
    drawRule(pg, marginL, pageW - marginR, 45)
    pg.drawText(
      firmaAprobacion ? "Documento aprobado por el cliente" : "Gracias por su confianza",
      { x: marginL, y: 32, size: TYPE.small, font: helvetica, color: MONO.faint }
    )
    const brandW = helveticaBold.widthOfTextAtSize(empresaNombre, TYPE.small)
    pg.drawText(empresaNombre, { x: pageW - marginR - brandW, y: 32, size: TYPE.small, font: helveticaBold, color: MONO.ink })
    if (totalPages > 1) {
      const pgText = `Página ${String(pageNum)} de ${String(totalPages)}`
      const pgW = helvetica.widthOfTextAtSize(pgText, TYPE.fine)
      pg.drawText(pgText, { x: (pageW - pgW) / 2, y: 20, size: TYPE.fine, font: helvetica, color: MONO.faint })
    }
  }

  // ====== PAGE 1 ======
  let page = pdfDoc.addPage([pageW, pageH])

  let cursor = pageH - 35
  let logoOffset = 0

  // Logo + Company info - vertically centered together
  let embeddedLogo: Awaited<ReturnType<typeof pdfDoc.embedPng>> | null = null
  let logoW = 0
  let logoH = 0
  if (data.logoUrl) {
    try {
      const res = await fetch(data.logoUrl)
      if (res.ok) {
        const buf = await res.arrayBuffer()
        const bytes = new Uint8Array(buf)
        const ct = res.headers.get("content-type") || ""
        if (ct.includes("png") || data.logoUrl.toLowerCase().includes(".png"))
          embeddedLogo = await pdfDoc.embedPng(bytes)
        else if (ct.includes("jpeg") || ct.includes("jpg") || data.logoUrl.toLowerCase().includes(".jpg") || data.logoUrl.toLowerCase().includes(".jpeg"))
          embeddedLogo = await pdfDoc.embedJpg(bytes)
        if (embeddedLogo) {
          const s = embeddedLogo.scale(1)
          const ratio = Math.min(50 / s.height, 50 / s.width)
          logoW = s.width * ratio
          logoH = s.height * ratio
          logoOffset = logoW + 12
        }
      }
    } catch { /* ignore logo errors */ }
  }

  // Calculate text block height: company name + details line + gap
  const nameSize = 16
  const detailSize = TYPE.small
  const companyDetails: string[] = []
  if (telefonoEmpresa) companyDetails.push(`Tel: ${telefonoEmpresa}`)
  if (direccionEmpresa) companyDetails.push(direccionEmpresa)
  const textBlockH = nameSize + (companyDetails.length > 0 ? detailSize + 6 : 0)

  // Vertically center logo with text block
  const blockH = Math.max(logoH, textBlockH)
  const logoY = cursor - (blockH - logoH) / 2 - logoH
  const textTopY = cursor - (blockH - textBlockH) / 2

  if (embeddedLogo) {
    page.drawImage(embeddedLogo, { x: marginL, y: logoY, width: logoW, height: logoH })
  }

  // Company name and info - aligned to vertical center of logo
  page.drawText(empresaNombre, { x: marginL + logoOffset, y: textTopY, size: nameSize, font: helveticaBold, color: MONO.ink })
  if (companyDetails.length > 0) {
    page.drawText(companyDetails.join("  |  "), { x: marginL + logoOffset, y: textTopY - nameSize - 2, size: detailSize, font: helvetica, color: MONO.label })
  }

  // Doc-title block (right side): título / número / fecha, como en los
  // demás comprobantes monocromos (REMITO / VENTA / NOTA DE CRÉDITO).
  const docTitleText = "COTIZACIÓN"
  const docTitleWidth = helveticaBold.widthOfTextAtSize(docTitleText, TYPE.docTitle)
  page.drawText(docTitleText, { x: pageW - marginR - docTitleWidth, y: pageH - 40, size: TYPE.docTitle, font: helveticaBold, color: MONO.ink })
  drawTextRight(page, cotizacionNumber, pageW - marginR, pageH - 62, TYPE.docNumber, helveticaBold, MONO.ink)
  drawTextRight(page, cotizacionDate, pageW - marginR, pageH - 78, TYPE.small, helvetica, MONO.label)

  // Separator line
  cursor = pageH - 100
  drawRule(page, marginL, pageW - marginR, cursor)
  cursor -= 20

  // ---- Info cards (sin caja: heading tipográfico + columnas planas) ----
  // Si la cotización tiene equipo (PRESUPUESTO) lo dibujamos como card de equipo
  // reemplazando el mini-card de orden. Si es ORDEN ligada, sigue el layout original.
  const equipo = data.equipo
  const hasEquipo = !!equipo
  const hasOrden = !!data.orden && !hasEquipo
  const hasRightCard = hasEquipo || hasOrden
  const cardGap = 12
  const cardW = hasRightCard ? (contentWidth - cardGap) / 2 : contentWidth
  const infoRowH = 13

  // Calculate client card height
  const clienteLines = 2 + (clienteEmail ? 1 : 0) + (clienteDireccion ? 1 : 0) + (sectorNombre ? 1 : 0)
  const clienteCardH = 16 + clienteLines * infoRowH

  // Client column
  drawSectionLabel(page, helveticaBold, "CLIENTE", marginL + 10, cursor - 12)
  let cy = cursor - 28
  page.drawText(clienteNombre.substring(0, 40), { x: marginL + 10, y: cy, size: TYPE.body, font: helveticaBold, color: MONO.ink })
  cy -= infoRowH
  if (clienteTelefono) {
    page.drawText(`Tel: ${clienteTelefono}`, { x: marginL + 10, y: cy, size: TYPE.small, font: helvetica, color: MONO.label })
    cy -= infoRowH
  }
  if (clienteEmail) {
    page.drawText(clienteEmail.substring(0, 35), { x: marginL + 10, y: cy, size: TYPE.small, font: helvetica, color: MONO.label })
    cy -= infoRowH
  }
  if (clienteDireccion) {
    page.drawText(clienteDireccion.substring(0, 40), { x: marginL + 10, y: cy, size: TYPE.small, font: helvetica, color: MONO.label })
    cy -= infoRowH
  }
  if (sectorNombre) {
    page.drawText(`Sector: ${sectorNombre.substring(0, 30)}`, { x: marginL + 10, y: cy, size: TYPE.small, font: helveticaBold, color: MONO.ink })
  }

  // Equipo column (PRESUPUESTO) — tiene prioridad sobre el mini-card de orden.
  let rightCardH = 0
  if (hasEquipo && equipo) {
    const ox = marginL + cardW + cardGap
    const equipoDispositivo = safe(equipo.dispositivo)
    const equipoMarca = safe(equipo.marca)
    const equipoModelo = safe(equipo.modelo)
    const equipoColor = safe(equipo.color)
    const equipoImei = safe(equipo.imei)
    const equipoSerie = safe(equipo.numeroSerie)
    const equipoProblema = safe(equipo.problemaReportado)

    // Líneas: dispositivo + marca/modelo + color + imei/serie + problema (label + valor)
    const extraLines =
      (equipoMarca || equipoModelo ? 1 : 0) +
      (equipoColor ? 1 : 0) +
      (equipoImei || equipoSerie ? 1 : 0)
    const equipoCardH = Math.max(clienteCardH, 16 + (1 + extraLines + 2) * infoRowH)

    drawSectionLabel(page, helveticaBold, "EQUIPO", ox + 10, cursor - 12)
    let oy = cursor - 28
    page.drawText(equipoDispositivo.substring(0, 38), { x: ox + 10, y: oy, size: TYPE.body, font: helveticaBold, color: MONO.ink })
    oy -= infoRowH

    if (equipoMarca || equipoModelo) {
      const txt = [equipoMarca, equipoModelo].filter(Boolean).join(" · ")
      page.drawText(txt.substring(0, 40), { x: ox + 10, y: oy, size: TYPE.small, font: helvetica, color: MONO.label })
      oy -= infoRowH
    }
    if (equipoColor) {
      page.drawText(`Color: ${equipoColor}`.substring(0, 40), { x: ox + 10, y: oy, size: TYPE.small, font: helvetica, color: MONO.label })
      oy -= infoRowH
    }
    if (equipoImei || equipoSerie) {
      const txt = equipoImei ? `IMEI: ${equipoImei}` : `N° serie: ${equipoSerie}`
      page.drawText(txt.substring(0, 40), { x: ox + 10, y: oy, size: TYPE.small, font: helvetica, color: MONO.label })
      oy -= infoRowH
    }

    page.drawText("Problema reportado", { x: ox + 10, y: oy, size: TYPE.small, font: helvetica, color: MONO.label })
    oy -= infoRowH
    page.drawText(equipoProblema.substring(0, 45), { x: ox + 10, y: oy, size: TYPE.body, font: helvetica, color: MONO.ink })

    rightCardH = equipoCardH
  } else if (data.orden) {
    const ox = marginL + cardW + cardGap
    const ordenCardH = Math.max(clienteCardH, 16 + 4 * infoRowH)

    drawSectionLabel(page, helveticaBold, `ORDEN #${safe(data.orden.numeroOrden)}`, ox + 10, cursor - 12)
    let oy = cursor - 28
    page.drawText("Equipo", { x: ox + 10, y: oy, size: TYPE.small, font: helvetica, color: MONO.label })
    oy -= infoRowH
    page.drawText(safe(data.orden.dispositivo).substring(0, 35), { x: ox + 10, y: oy, size: TYPE.body, font: helveticaBold, color: MONO.ink })
    oy -= infoRowH
    page.drawText("Problema reportado", { x: ox + 10, y: oy, size: TYPE.small, font: helvetica, color: MONO.label })
    oy -= infoRowH
    page.drawText(safe(data.orden.problemaReportado).substring(0, 45), { x: ox + 10, y: oy, size: TYPE.body, font: helvetica, color: MONO.ink })

    rightCardH = ordenCardH
  }

  cursor -= Math.max(clienteCardH, rightCardH || clienteCardH)
  drawRule(page, marginL, pageW - marginR, cursor, { dotted: true })
  cursor -= 12

  // ====== ITEMS TABLE ======
  // Table column positions (right edge for right-aligned columns)
  const colDesc = marginL + 10
  const colCantR = marginL + 310
  const colUnitR = marginL + 400
  const colSubR = pageW - marginR - 10

  // Header row (sin fill, mayusculas, MONO.label) — factorizado porque se
  // vuelve a dibujar al inicio de cada página de continuación de la tabla.
  const drawItemsTableHeader = (pg: typeof page, yPos: number) => {
    pg.drawText("DESCRIPCIÓN", { x: colDesc, y: yPos, size: TYPE.small, font: helveticaBold, color: MONO.label })
    drawTextRight(pg, "CANT.", colCantR, yPos, TYPE.small, helveticaBold, MONO.label)
    drawTextRight(pg, "P. UNITARIO", colUnitR, yPos, TYPE.small, helveticaBold, MONO.label)
    drawTextRight(pg, "SUBTOTAL", colSubR, yPos, TYPE.small, helveticaBold, MONO.label)
  }

  drawSectionLabel(page, helveticaBold, "DETALLE DE ITEMS", colDesc, cursor)
  cursor -= 4
  drawRule(page, marginL, pageW - marginR, cursor)
  cursor -= 20
  drawItemsTableHeader(page, cursor)
  cursor -= 8
  drawRule(page, marginL, pageW - marginR, cursor)
  cursor -= 17

  // Table rows with multi-page support
  const items = Array.isArray(data.items) ? data.items : []
  // 26pt (vs. the 18pt used by simpler tables elsewhere) to leave room for
  // the optional per-item discount tag on a second line below the
  // description without crowding the hairline separator.
  const rowH = 26
  let pageCount = 1
  const pages = [page]

  for (let i = 0; i < items.length; i++) {
    // Check if we need a new page
    if (cursor - rowH < minY + 180) { // 180 reserved for totals/notes on last items
      // Only add new page if there are more items AND we'd run out of space for totals
      if (cursor - rowH < minY) {
        pageCount++
        page = pdfDoc.addPage([pageW, pageH])
        pages.push(page)
        cursor = pageH - 30

        // Re-draw table header on new page
        drawItemsTableHeader(page, cursor)
        cursor -= 8
        drawRule(page, marginL, pageW - marginR, cursor)
        cursor -= 17
      }
    }

    const item = items[i]
    const unitPrice = Number(item.precioUnitario || item.precio_unitario) || 0
    const unidad = safe(item.unidad) || "Unidad"
    const cantLabel = `${String(item.cantidad || 0)}${unidad !== "Unidad" ? ` ${unidad}` : ""}`.trim()
    const itemSubtotal = Number(item.subtotal) || 0

    // Description - allow longer text
    const tipoRep = safe(item.tipo_repuesto || item.tipoRepuesto)
    const tipoRepLabel = tipoRep && tipoRep !== "NO_APLICA"
      ? ` [${tipoRep === "ALTERNATIVO" ? "ALT" : tipoRep === "RECICLADO" ? "REC" : "ORIG"}]`
      : ""
    const descText = (safe(item.descripcion) + tipoRepLabel).substring(0, 60)
    page.drawText(descText, { x: colDesc, y: cursor, size: TYPE.body, font: helvetica, color: MONO.ink })

    // Item discount indicator
    const itemDescTipo = safe(item.descuento_tipo || item.descuentoTipo)
    const itemDescValor = Number(item.descuento_valor || item.descuentoValor) || 0
    if (itemDescValor > 0) {
      const discText = itemDescTipo === "porcentaje" ? `(-${String(itemDescValor)}%)` : `(-${fmtCurrency(itemDescValor)})`
      page.drawText(discText, { x: colDesc, y: cursor - 12, size: TYPE.fine, font: helvetica, color: MONO.label })
    }

    // Right-aligned numeric columns
    drawTextRight(page, cantLabel, colCantR, cursor, TYPE.body, helvetica, MONO.ink)
    drawTextRight(page, fmtCurrency(unitPrice), colUnitR, cursor, TYPE.body, helvetica, MONO.ink)
    drawTextRight(page, fmtCurrency(itemSubtotal), colSubR, cursor, TYPE.body, helveticaBold, MONO.ink)

    cursor -= rowH
    // Row separator (+10, not +5 — Task 1 established this offset so the
    // hairline clears 9pt text descenders instead of striking through it).
    drawRule(page, marginL, pageW - marginR, cursor + 10)
  }

  cursor -= 12

  // ====== DETALLE / TOTALES ======
  // Full-width label:value rows with hairlines, closing in the sole
  // allowed fill (MONO.totalBg) — same treatment as factura/venta/devolución.
  drawSectionLabel(page, helveticaBold, "DETALLE", marginL, cursor)
  cursor -= 4
  drawRule(page, marginL, pageW - marginR, cursor)
  cursor -= 20

  page.drawText("Subtotal", { x: marginL + 10, y: cursor, size: TYPE.body, font: helvetica, color: MONO.label })
  drawTextRight(page, fmtCurrency(subtotalNum), pageW - marginR - 10, cursor, TYPE.body, helvetica, MONO.ink)
  cursor -= 18
  drawRule(page, marginL, pageW - marginR, cursor + 10)

  if (descGlobalAmount > 0) {
    const descLabel = descGlobalTipo === "porcentaje" ? `Descuento (${String(descGlobalValor)}%)` : "Descuento"
    page.drawText(descLabel, { x: marginL + 10, y: cursor, size: TYPE.body, font: helvetica, color: MONO.label })
    drawTextRight(page, `-${fmtCurrency(descGlobalAmount)}`, pageW - marginR - 10, cursor, TYPE.body, helvetica, MONO.ink)
    cursor -= 18
    drawRule(page, marginL, pageW - marginR, cursor + 10)
  }

  if (ivaPct > 0) {
    page.drawText(`IVA (${String(ivaPct)}%)`, { x: marginL + 10, y: cursor, size: TYPE.body, font: helvetica, color: MONO.label })
    drawTextRight(page, fmtCurrency(ivaNum), pageW - marginR - 10, cursor, TYPE.body, helvetica, MONO.ink)
    cursor -= 18
    drawRule(page, marginL, pageW - marginR, cursor + 10)
  }

  cursor -= 5

  // Total (barra MONO.totalBg — la única área con relleno permitida)
  page.drawRectangle({ x: marginL, y: cursor - 8, width: contentWidth, height: 28, color: MONO.totalBg })
  page.drawText("TOTAL", { x: marginL + 10, y: cursor, size: TYPE.total, font: helveticaBold, color: MONO.ink })
  drawTextRight(page, fmtCurrency(totalNum), pageW - marginR - 10, cursor, TYPE.total, helveticaBold, MONO.ink)

  cursor -= 35

  // ====== VALIDITY BANNER ======
  // Outlined callout (no fill available besides MONO.totalBg, which is
  // reserved for the total bar) — the border alone carries the emphasis.
  if (fechaVencimiento) {
    const bannerH = 24
    page.drawRectangle({ x: marginL, y: cursor - bannerH, width: contentWidth, height: bannerH, borderColor: MONO.rule, borderWidth: RULE_WIDTH })
    const validText = `Cotizacion valida hasta el ${fechaVencimiento}`
    const validW = helveticaBold.widthOfTextAtSize(validText, TYPE.body)
    page.drawText(validText, { x: marginL + (contentWidth - validW) / 2, y: cursor - bannerH + 8, size: TYPE.body, font: helveticaBold, color: MONO.ink })
    cursor -= bannerH + 10
  }

  // ====== CHECKLIST (solo para PRESUPUESTO con checklist) ======
  if (data.checklist && Array.isArray(data.checklist.items) && data.checklist.items.length > 0) {
    const chk = data.checklist
    // Agrupar por categoría para visualización
    const byCat: Record<string, Array<{ label: string; valor: string }>> = {}
    for (const it of chk.items) {
      const cat = it.categoria || "General"
      if (!byCat[cat]) byCat[cat] = []
      byCat[cat].push({ label: it.label, valor: it.valor })
    }

    // Altura estimada: 24 de header + por categoria (12 titulo + 11 por item) + notas
    let estH = 24
    for (const cat of Object.keys(byCat)) {
      estH += 12
      estH += byCat[cat].length * 11
    }
    if (chk.notas) estH += 11

    // Si no entra en la página actual, crear una nueva
    if (cursor - estH < minY) {
      page = pdfDoc.addPage([pageW, pageH])
      pages.push(page)
      cursor = pageH - 30
    }

    drawRule(page, marginL, pageW - marginR, cursor)
    drawSectionLabel(page, helveticaBold, "CHECKLIST DE RECEPCIÓN", marginL + 10, cursor - 12)
    let chY = cursor - 26

    const labelsByCat: Record<string, string> = {
      CONDICION_FISICA: "Condición física",
      ACCESORIOS: "Accesorios",
      FUNCIONAL: "Estado funcional",
      GENERAL: "General",
    }

    for (const [cat, items] of Object.entries(byCat)) {
      page.drawText(labelsByCat[cat] || cat, { x: marginL + 10, y: chY, size: TYPE.small, font: helveticaBold, color: MONO.ink })
      chY -= 11
      for (const it of items) {
        const line = `• ${it.label}: ${it.valor}`.substring(0, 95)
        page.drawText(line, { x: marginL + 16, y: chY, size: TYPE.fine, font: helvetica, color: MONO.label })
        chY -= 11
      }
    }

    if (chk.notas) {
      page.drawText(`Observaciones: ${safe(chk.notas)}`.substring(0, 100), {
        x: marginL + 10, y: chY, size: TYPE.fine, font: helvetica, color: MONO.faint,
      })
    }

    cursor -= estH + 8
  }

  // ====== CONDICIONES TÉCNICAS (solo PRESUPUESTO con condiciones) ======
  if (data.condiciones) {
    const cnd = data.condiciones

    // Wrap diagnóstico into lines
    const diagnostico = safe(cnd.diagnostico)
    const diagLines: string[] = []
    if (diagnostico) {
      let dLine = ""
      for (const word of diagnostico.split(" ")) {
        if (helvetica.widthOfTextAtSize(dLine + " " + word, TYPE.small) < contentWidth - 100) {
          dLine += (dLine ? " " : "") + word
        } else {
          diagLines.push(dLine)
          dLine = word
        }
      }
      if (dLine) diagLines.push(dLine)
    }

    const condRows: Array<{ label: string; value: string }> = []
    if (cnd.plazoEstimadoDias && cnd.plazoEstimadoDias > 0) {
      condRows.push({ label: "Plazo estimado:", value: `${cnd.plazoEstimadoDias} días hábiles` })
    }
    if (cnd.anticipoValor && cnd.anticipoValor > 0) {
      const ant = cnd.anticipoTipo === "fijo"
        ? fmtCurrency(cnd.anticipoValor)
        : `${cnd.anticipoValor}% del total`
      condRows.push({ label: "Anticipo requerido:", value: ant })
    }
    if (cnd.garantiaAlcance && cnd.garantiaAlcance !== "NINGUNA" && cnd.garantiaDias > 0) {
      const alcance = cnd.garantiaAlcance === "AMBOS"
        ? "Repuesto y mano de obra"
        : cnd.garantiaAlcance === "REPUESTO"
          ? "Solo repuesto"
          : "Solo mano de obra"
      condRows.push({ label: "Garantía:", value: `${cnd.garantiaDias} días — ${alcance}` })
    }
    if (cnd.politicaAbandonoDias && cnd.politicaAbandonoDias > 0) {
      condRows.push({ label: "Plazo de retiro:", value: `${cnd.politicaAbandonoDias} días tras aviso de listo` })
    }

    const hasContent = diagLines.length > 0 || condRows.length > 0
    if (hasContent) {
      const estH = 22 + (diagLines.length > 0 ? (12 + diagLines.length * 11 + 4) : 0) + condRows.length * 12 + 6

      if (cursor - estH < minY) {
        page = pdfDoc.addPage([pageW, pageH])
        pages.push(page)
        cursor = pageH - 30
      }

      drawRule(page, marginL, pageW - marginR, cursor)
      drawSectionLabel(page, helveticaBold, "CONDICIONES TÉCNICAS", marginL + 10, cursor - 12)
      let cY = cursor - 26

      if (diagLines.length > 0) {
        page.drawText("Diagnóstico:", { x: marginL + 10, y: cY, size: TYPE.small, font: helveticaBold, color: MONO.ink })
        cY -= 12
        for (const l of diagLines.slice(0, 4)) {
          page.drawText(l, { x: marginL + 16, y: cY, size: TYPE.fine, font: helvetica, color: MONO.label })
          cY -= 11
        }
        cY -= 4
      }

      for (const row of condRows) {
        page.drawText(row.label, { x: marginL + 10, y: cY, size: TYPE.small, font: helveticaBold, color: MONO.ink })
        page.drawText(row.value, { x: marginL + 108, y: cY, size: TYPE.small, font: helvetica, color: MONO.label })
        cY -= 12
      }

      cursor -= estH + 8
    }
  }

  // ====== NOTAS (OBSERVACIONES) ======
  if (notas) {
    // Word-wrap notas
    const notaLines: string[] = []
    let nLine = ""
    for (const word of notas.split(" ")) {
      if (helvetica.widthOfTextAtSize(nLine + " " + word, TYPE.body) < contentWidth - 20) {
        nLine += (nLine ? " " : "") + word
      } else {
        notaLines.push(nLine)
        nLine = word
      }
    }
    if (nLine) notaLines.push(nLine)
    const displayedNotaLines = notaLines.slice(0, 4)

    drawSectionLabel(page, helveticaBold, "OBSERVACIONES", marginL + 10, cursor - 10)
    let nY = cursor - 24
    for (const l of displayedNotaLines) {
      page.drawText(l, { x: marginL + 10, y: nY, size: TYPE.body, font: helvetica, color: MONO.ink })
      nY -= 12
    }
    cursor -= 24 + displayedNotaLines.length * 12 + 6
  }

  // ====== TERMINOS ======
  // Fine-print entero (heading + líneas) en MONO.faint — mismo tratamiento
  // que el bloque de términos de generateOrdenPDF: sin caja, sin regla.
  if (terminos) {
    const tLines: string[] = []
    let tLine = ""
    for (const word of terminos.split(" ")) {
      if (helvetica.widthOfTextAtSize(tLine + " " + word, TYPE.fine) < contentWidth - 20) {
        tLine += (tLine ? " " : "") + word
      } else {
        tLines.push(tLine)
        tLine = word
      }
    }
    if (tLine) tLines.push(tLine)
    const displayedTerminos = tLines.slice(0, 8)

    page.drawText("TÉRMINOS Y CONDICIONES", { x: marginL + 10, y: cursor - 9, size: TYPE.sectionLabel, font: helveticaBold, color: MONO.faint })
    let tY = cursor - 21
    for (const l of displayedTerminos) {
      page.drawText(l, { x: marginL + 10, y: tY, size: TYPE.fine, font: helvetica, color: MONO.faint })
      tY -= 10
    }
    cursor -= 21 + displayedTerminos.length * 10 + 8
  }

  // ====== FIRMA (if approved) ======
  // Mismo tratamiento que el bloque de firmas de entrega: caja con contorno
  // (sin relleno), heading tipográfico y subrayado en MONO.ink.
  if (firmaAprobacion && firmaMime) {
    const sigBoxW = 200
    const sigBoxH = 85
    const sigBoxX = pageW - marginR - sigBoxW

    page.drawRectangle({ x: sigBoxX, y: cursor - sigBoxH, width: sigBoxW, height: sigBoxH, borderColor: MONO.rule, borderWidth: RULE_WIDTH })
    drawSectionLabel(page, helveticaBold, "Firma del cliente", sigBoxX + 12, cursor - 12)

    try {
      const sigBytes = Uint8Array.from(atob(firmaAprobacion), c => c.charCodeAt(0))
      const sigImg = firmaMime.includes("png")
        ? await pdfDoc.embedPng(sigBytes)
        : await pdfDoc.embedJpg(sigBytes)
      const ss = sigImg.scale(1)
      const ratio = Math.min((sigBoxW - 40) / ss.width, 35 / ss.height)
      const sigW = ss.width * ratio
      const sigH = ss.height * ratio
      page.drawImage(sigImg, { x: sigBoxX + (sigBoxW - sigW) / 2, y: cursor - sigBoxH + 35, width: sigW, height: sigH })
    } catch { /* ignore sig errors */ }

    drawRule(page, sigBoxX + 20, sigBoxX + sigBoxW - 20, cursor - sigBoxH + 30, { color: MONO.ink })
    page.drawText(clienteNombre.substring(0, 25), { x: sigBoxX + 20, y: cursor - sigBoxH + 18, size: TYPE.fine, font: helvetica, color: MONO.ink })
    if (fechaAprobacion) {
      page.drawText(`Aprobado: ${fechaAprobacion}`, { x: sigBoxX + 20, y: cursor - sigBoxH + 8, size: TYPE.fine, font: helvetica, color: MONO.label })
    }

    cursor -= sigBoxH + 10
  }

  // ====== FOOTER on all pages ======
  const totalPages = pages.length
  for (let i = 0; i < pages.length; i++) {
    drawFooter(pages[i], i + 1, totalPages)
  }

  const pdfBytes = await pdfDoc.save()
  return Buffer.from(pdfBytes)
}

// ========================================
// COMPROBANTE DE ORDEN DE SERVICIO
// ========================================

interface OrdenPDFData {
  numeroOrden: number
  fechaIngreso: Date
  fechaPrometida?: Date | null
  cliente: {
    nombre: string
    telefono: string
    email?: string | null
    direccion?: string | null
  }
  dispositivo: string
  tipoDispositivo: string
  marca?: string | null
  color?: string | null
  imei?: string | null
  problemaReportado: string
  accesorios?: string | null
  codigoAccesoDispositivo?: string | null
  presupuesto?: number | null
  observaciones?: string | null
  nombreEmpresa?: string
  telefonoEmpresa?: string
  direccionEmpresa?: string
  ciudadEmpresa?: string | null
  provinciaEmpresa?: string | null
  codigoPostalEmpresa?: string | null
  logoUrl?: string | null
  moneda?: string
  zonaHoraria?: string
  estado?: string
  fechaEntrega?: Date | null
  firmaClienteEntrega?: string | null
  firmaClienteEntregaMime?: string | null
  firmaEncargadoEntrega?: string | null
  firmaEncargadoEntregaMime?: string | null
  entregadoPor?: string | null
  notasEntrega?: string | null
  sector?: string | null
  recepcionTerminos?: string | null
  soloCliente?: boolean // true = solo copia cliente (para compartir por WhatsApp)
  // New fields for enhanced receipt
  publicToken?: string | null
  baseUrl?: string | null
  sena?: number | null
  metodoPagoSena?: string | null
  checklistItems?: Array<{ label: string; valor: boolean | string | null }> | null
  checklistNotas?: string | null
  firmaRecepcion?: string | null
  firmaRecepcionMime?: string | null
  fotosIngreso?: Array<{ url: string; descripcion?: string | null }> | null
  terminologia?: Terminologia
}

export async function generateOrdenPDF(data: OrdenPDFData): Promise<Buffer> {
  const term = resolveTerminologia(data.terminologia ?? null)

  // Helper para texto seguro
  const safe = (val: unknown): string => {
    if (val === null || val === undefined) return ""
    if (typeof val === "string") return val.replace(/[\r\n]+/g, " ").trim()
    if (typeof val === "number") return String(val)
    return ""
  }

  const formatDatePDF = (date: Date | string | null | undefined): string => {
    return formatDateValue(date, data.zonaHoraria || DEFAULT_TIMEZONE)
  }

  const formatCurrencyPDF = (amount: number | null | undefined): string => {
    return formatCurrencyValue(amount, (data.moneda as CurrencyCode) || DEFAULT_CURRENCY)
  }

  // Extraer datos de forma segura
  const empresaNombre = safe(data.nombreEmpresa) || "Servicio Técnico"
  const telefonoEmpresa = safe(data.telefonoEmpresa)
  const direccionEmpresa = safe(data.direccionEmpresa)
  const ciudadEmpresa = safe(data.ciudadEmpresa)
  const provinciaEmpresa = safe(data.provinciaEmpresa)
  const codigoPostalEmpresa = safe(data.codigoPostalEmpresa)
  const numeroOrden = safe(data.numeroOrden)
  const fechaIngreso = formatDatePDF(data.fechaIngreso)
  const fechaPrometida = formatDatePDF(data.fechaPrometida)

  const cliente = data.cliente || { nombre: "", telefono: "", email: null, direccion: null }
  const clienteNombre = safe(cliente.nombre) || "Sin nombre"
  const clienteTelefono = safe(cliente.telefono) || "Sin teléfono"
  const clienteEmail = safe(cliente.email)
  const clienteDireccion = safe(cliente.direccion)
  const sector = safe(data.sector)

  const tipoDispositivo = safe(data.tipoDispositivo) || "Otro"
  const dispositivo = safe(data.dispositivo) || "Sin especificar"
  const marca = safe(data.marca)
  const colorDisp = safe(data.color)
  const imei = safe(data.imei)
  const problemaReportado = safe(data.problemaReportado) || "Sin descripcion"
  const accesorios = safe(data.accesorios)
  const codigoAccesoDispositivo = safe(data.codigoAccesoDispositivo)
  const presupuesto = data.presupuesto ? formatCurrencyPDF(data.presupuesto) : ""
  const observaciones = safe(data.observaciones)

  // Fecha y hora de impresion
  const fechaImpresion = formatDateTimeValue(new Date(), data.zonaHoraria || DEFAULT_TIMEZONE)

  // Crear documento PDF
  const pdfDoc = await PDFLib.create()
  const page = pdfDoc.addPage([595, 842]) // A4
  const { width, height } = page.getSize()

  // Cargar fuentes
  const { regular: helvetica, bold: helveticaBold } = await embedCustomFonts(pdfDoc)
  const courier = await pdfDoc.embedFont(StandardFonts.Courier)

  // Margenes
  const margin = 40
  const contentWidth = width - (margin * 2)
  const cardGap = 10
  const halfWidth = (contentWidth - cardGap) / 2

  let y = height - margin + 6

  // === HEADER: Logo centrado superpuesto, datos a los lados ===
  // El logo ocupa el centro, los datos de empresa van a la izquierda
  // y la orden a la derecha, compartiendo las mismas líneas verticales.

  // Calcular alto total del header (3 líneas de texto: nombre, tel, dirección)
  const headerTextH = 36 // ~12 + 11 + 11 + gaps
  const logoMaxH = 70
  const logoMaxW = 120

  // Embed logo primero para saber su tamaño
  let logoSW = 0
  let logoSH = 0
  let embeddedLogo: any = null

  if (data.logoUrl) {
    try {
      const logoResponse = await fetch(data.logoUrl)
      if (logoResponse.ok) {
        const logoArrayBuffer = await logoResponse.arrayBuffer()
        const logoBytes = new Uint8Array(logoArrayBuffer)
        const contentType = logoResponse.headers.get("content-type") || ""
        if (contentType.includes("png") || data.logoUrl.toLowerCase().includes(".png")) {
          embeddedLogo = await pdfDoc.embedPng(logoBytes)
        } else if (contentType.includes("jpeg") || contentType.includes("jpg") || data.logoUrl.toLowerCase().includes(".jpg") || data.logoUrl.toLowerCase().includes(".jpeg")) {
          embeddedLogo = await pdfDoc.embedJpg(logoBytes)
        }
        if (embeddedLogo) {
          const logoDims = embeddedLogo.scale(1)
          const scale = Math.min(logoMaxH / logoDims.height, logoMaxW / logoDims.width)
          logoSW = logoDims.width * scale
          logoSH = logoDims.height * scale
        }
      }
    } catch (logoError) {
      console.error("Error loading logo:", logoError)
    }
  }

  // Header height fijo al texto — el logo se desborda hacia arriba sin empujar contenido
  const headerH = headerTextH

  // Draw logo centered, shifted up so it overflows into top margin instead of overlapping text
  if (embeddedLogo) {
    const logoX = (width - logoSW) / 2
    const logoY = y - (headerH / 2) - (logoSH / 2) + 12
    page.drawImage(embeddedLogo, { x: logoX, y: logoY, width: logoSW, height: logoSH })
  }

  // Left zone: empresa datos (escalonados), right zone: orden datos
  // Ambos centrados verticalmente en la misma franja que el logo
  const textStartY = y - (headerH / 2) + (headerTextH / 2)

  // Línea 1: Nombre empresa | # Orden
  page.drawText(empresaNombre, { x: margin, y: textStartY, size: 12, font: helveticaBold, color: MONO.ink })

  const ordenText = `#${String(numeroOrden).padStart(4, "0")}`
  const ordenTextWidth = helveticaBold.widthOfTextAtSize(ordenText, TYPE.docNumber)
  page.drawText(ordenText, { x: width - margin - ordenTextWidth, y: textStartY + 1, size: TYPE.docNumber, font: helveticaBold, color: MONO.ink })

  // Línea 2: Teléfono | Badge RECEPCIÓN (outlined, sin relleno)
  const line2Y = textStartY - 13
  if (telefonoEmpresa) {
    page.drawText(`Tel: ${telefonoEmpresa}`, { x: margin, y: line2Y, size: TYPE.small, font: helvetica, color: MONO.label })
  }
  const badgeText = "RECEPCIÓN"
  const badgeWidth = measureBadgeWidth(helveticaBold, badgeText)
  drawOutlinedBadge(page, helveticaBold, badgeText, width - margin - badgeWidth, line2Y + 10)

  // Línea 3: Dirección completa | Fechas
  const line3Y = line2Y - 12
  const locationParts: string[] = []
  if (direccionEmpresa) locationParts.push(direccionEmpresa)
  if (ciudadEmpresa) locationParts.push(ciudadEmpresa)
  if (codigoPostalEmpresa) locationParts.push(`CP ${codigoPostalEmpresa}`)
  if (provinciaEmpresa) locationParts.push(provinciaEmpresa)
  if (locationParts.length > 0) {
    page.drawText(locationParts.join(", "), { x: margin, y: line3Y, size: TYPE.small, font: helvetica, color: MONO.label })
  }

  const fechasText = `Ingreso: ${fechaIngreso}` + (fechaPrometida ? `  |  Entrega est.: ${fechaPrometida}` : "")
  const fechasW = helvetica.widthOfTextAtSize(fechasText, TYPE.fine)
  page.drawText(fechasText, { x: width - margin - fechasW, y: line3Y, size: TYPE.fine, font: helvetica, color: MONO.faint })

  y -= headerH + 4
  // Línea separadora + título
  drawRule(page, margin, width - margin, y)
  y -= 12
  const titleText = "COMPROBANTE DE RECEPCIÓN"
  const titleWidth = helveticaBold.widthOfTextAtSize(titleText, TYPE.docTitle)
  page.drawText(titleText, { x: (width - titleWidth) / 2, y, size: TYPE.docTitle, font: helveticaBold, color: MONO.ink })
  y -= 10

  // === GRID: CLIENTE | DISPOSITIVO (compacto) ===
  let clienteLines = 2
  if (sector) clienteLines++
  if (clienteEmail) clienteLines++
  if (clienteDireccion) clienteLines++

  let dispositivoLines = 1
  if (marca) dispositivoLines++
  if (colorDisp && marca) dispositivoLines = dispositivoLines
  else if (colorDisp) dispositivoLines++
  if (imei) dispositivoLines++

  const maxLines = Math.max(clienteLines, dispositivoLines)
  const rowH = 13
  const cardHeight = 18 + maxLines * rowH + 6

  const truncateToWidth = (text: string, maxW: number, font_: typeof helvetica, size: number): string => {
    if (font_.widthOfTextAtSize(text, size) <= maxW) return text
    let t = text
    while (t.length > 0 && font_.widthOfTextAtSize(t + "...", size) > maxW) t = t.slice(0, -1)
    return t + "..."
  }

  const labelCol = 50
  const valueMaxWidth = halfWidth - labelCol - 20

  // Card Cliente (sin caja: heading tipográfico + columnas planas)
  drawSectionLabel(page, helveticaBold, "CLIENTE", margin + 10, y - 12)

  let clienteInfoY = y - 30
  page.drawText("Nombre:", { x: margin + 10, y: clienteInfoY, size: TYPE.small, font: helvetica, color: MONO.label })
  page.drawText(truncateToWidth(clienteNombre, valueMaxWidth, helveticaBold, TYPE.body), { x: margin + labelCol + 10, y: clienteInfoY, size: TYPE.body, font: helveticaBold, color: MONO.ink })
  clienteInfoY -= rowH
  if (sector) {
    page.drawText("Sector:", { x: margin + 10, y: clienteInfoY, size: TYPE.small, font: helvetica, color: MONO.label })
    page.drawText(truncateToWidth(sector, valueMaxWidth, helveticaBold, TYPE.body), { x: margin + labelCol + 10, y: clienteInfoY, size: TYPE.body, font: helveticaBold, color: MONO.ink })
    clienteInfoY -= rowH
  }
  page.drawText("Teléfono:", { x: margin + 10, y: clienteInfoY, size: TYPE.small, font: helvetica, color: MONO.label })
  page.drawText(truncateToWidth(clienteTelefono, valueMaxWidth, helvetica, TYPE.body), { x: margin + labelCol + 10, y: clienteInfoY, size: TYPE.body, font: helvetica, color: MONO.ink })
  clienteInfoY -= rowH
  if (clienteEmail) {
    page.drawText("Email:", { x: margin + 10, y: clienteInfoY, size: TYPE.small, font: helvetica, color: MONO.label })
    page.drawText(truncateToWidth(clienteEmail, valueMaxWidth, helvetica, TYPE.small), { x: margin + labelCol + 10, y: clienteInfoY, size: TYPE.small, font: helvetica, color: MONO.ink })
    clienteInfoY -= rowH
  }
  if (clienteDireccion) {
    page.drawText("Dir:", { x: margin + 10, y: clienteInfoY, size: TYPE.small, font: helvetica, color: MONO.label })
    page.drawText(truncateToWidth(clienteDireccion, valueMaxWidth, helvetica, TYPE.small), { x: margin + labelCol + 10, y: clienteInfoY, size: TYPE.small, font: helvetica, color: MONO.ink })
  }

  // Card Dispositivo (misma columna derecha, sin caja)
  const cardX2 = margin + halfWidth + cardGap
  drawSectionLabel(page, helveticaBold, t(term, "equipo"), cardX2 + 10, y - 12)

  const tipoBadgeText = tipoDispositivo.toUpperCase()
  const tipoBadgeWidth = helveticaBold.widthOfTextAtSize(tipoBadgeText, TYPE.small)
  page.drawText(tipoBadgeText, { x: cardX2 + halfWidth - tipoBadgeWidth, y: y - 12, size: TYPE.small, font: helveticaBold, color: MONO.ink })

  let deviceInfoY = y - 30
  page.drawText(t(term, "equipo") + ":", { x: cardX2 + 10, y: deviceInfoY, size: TYPE.small, font: helvetica, color: MONO.label })
  page.drawText(truncateToWidth(dispositivo, valueMaxWidth, helveticaBold, TYPE.body), { x: cardX2 + labelCol + 10, y: deviceInfoY, size: TYPE.body, font: helveticaBold, color: MONO.ink })
  deviceInfoY -= rowH
  if (marca) {
    page.drawText("Marca:", { x: cardX2 + 10, y: deviceInfoY, size: TYPE.small, font: helvetica, color: MONO.label })
    const marcaText = truncateToWidth(marca, colorDisp ? valueMaxWidth * 0.55 : valueMaxWidth, helvetica, TYPE.small)
    page.drawText(marcaText, { x: cardX2 + labelCol + 10, y: deviceInfoY, size: TYPE.small, font: helvetica, color: MONO.ink })
    if (colorDisp) {
      const colorLabelX = cardX2 + halfWidth * 0.6
      page.drawText("Color:", { x: colorLabelX, y: deviceInfoY, size: TYPE.small, font: helvetica, color: MONO.label })
      page.drawText(truncateToWidth(colorDisp, halfWidth - (halfWidth * 0.6) - 42, helvetica, TYPE.small), { x: colorLabelX + 32, y: deviceInfoY, size: TYPE.small, font: helvetica, color: MONO.ink })
    }
    deviceInfoY -= rowH
  } else if (colorDisp) {
    page.drawText("Color:", { x: cardX2 + 10, y: deviceInfoY, size: TYPE.small, font: helvetica, color: MONO.label })
    page.drawText(truncateToWidth(colorDisp, valueMaxWidth, helvetica, TYPE.small), { x: cardX2 + labelCol + 10, y: deviceInfoY, size: TYPE.small, font: helvetica, color: MONO.ink })
    deviceInfoY -= rowH
  }
  if (imei) {
    page.drawText(t(term, "serie") + ":", { x: cardX2 + 10, y: deviceInfoY, size: TYPE.small, font: helvetica, color: MONO.label })
    page.drawText(truncateToWidth(imei, valueMaxWidth, courier, TYPE.small), { x: cardX2 + labelCol + 10, y: deviceInfoY, size: TYPE.small, font: courier, color: MONO.ink })
  }

  drawRule(page, margin, width - margin, y - cardHeight + 4, { dotted: true })
  y -= cardHeight + 6

  // === PROBLEMA REPORTADO (compacto) ===
  const problemaLines: string[] = []
  let tempLine = ""
  const words = problemaReportado.split(" ")
  for (const word of words) {
    if (helvetica.widthOfTextAtSize(tempLine + " " + word, TYPE.body) < contentWidth - 20) {
      tempLine += (tempLine ? " " : "") + word
    } else {
      problemaLines.push(tempLine)
      tempLine = word
    }
  }
  if (tempLine) problemaLines.push(tempLine)
  const displayedProblemaLines = problemaLines.slice(0, 3)
  const problemaHeight = 16 + displayedProblemaLines.length * 12 + 4

  drawSectionLabel(page, helveticaBold, "PROBLEMA REPORTADO", margin + 10, y - 11)

  let problemaY = y - 28
  for (const line of displayedProblemaLines) {
    page.drawText(line, { x: margin + 10, y: problemaY, size: TYPE.body, font: helvetica, color: MONO.ink })
    problemaY -= 12
  }
  drawRule(page, margin, width - margin, y - problemaHeight + 4, { dotted: true })
  y -= problemaHeight + 4

  // === ACCESORIOS + CÓDIGO DE ACCESO (lado a lado si hay patrón) ===
  const hasAccessCode = !!codigoAccesoDispositivo
  const isPatternCode = hasAccessCode &&
    (codigoAccesoDispositivo.toLowerCase().startsWith("patrón:") ||
     codigoAccesoDispositivo.toLowerCase().startsWith("patron:"))

  if (accesorios) {
    const accWidth = isPatternCode ? halfWidth : contentWidth
    const accHeight = 18
    drawSectionLabel(page, helveticaBold, "Accesorios", margin + 8, y - 12)
    page.drawText(truncateToWidth(accesorios, accWidth - 85, helvetica, TYPE.small), { x: margin + 75, y: y - 12, size: TYPE.small, font: helvetica, color: MONO.ink })
    if (!isPatternCode) y -= accHeight + 4
  }

  if (hasAccessCode) {
    if (isPatternCode) {
      // Patrón a la derecha de accesorios
      const patternMatch = codigoAccesoDispositivo.match(/[\d-]+$/)
      const patternNumbers = patternMatch
        ? patternMatch[0].split("-").map(n => parseInt(n.trim())).filter(n => n >= 1 && n <= 9)
        : []

      const patBoxX = margin + halfWidth + cardGap
      const patBoxW = halfWidth
      const patBoxH = 60
      drawSectionLabel(page, helveticaBold, "Código de acceso", patBoxX + 10, y - 10)
      page.drawText("Patrón", { x: patBoxX + patBoxW - 40, y: y - 10, size: TYPE.fine, font: helvetica, color: MONO.label })

      const gridCenterX = patBoxX + patBoxW / 2
      const gridStartY = y - 22
      const cellSize = 14
      const dotRadius = 2.5

      const getPointPosition = (num: number) => ({
        x: gridCenterX + ((num - 1) % 3 - 1) * cellSize,
        y: gridStartY - Math.floor((num - 1) / 3) * cellSize,
      })

      if (patternNumbers.length > 1) {
        for (let i = 0; i < patternNumbers.length - 1; i++) {
          const start = getPointPosition(patternNumbers[i])
          const end = getPointPosition(patternNumbers[i + 1])
          page.drawLine({ start, end, thickness: 1.2, color: MONO.ink })
        }
      }
      for (let num = 1; num <= 9; num++) {
        const pos = getPointPosition(num)
        const inPat = patternNumbers.includes(num)
        page.drawCircle({ x: pos.x, y: pos.y, size: dotRadius, color: inPat ? MONO.ink : MONO.rule, borderWidth: 0 })
        if (inPat) page.drawCircle({ x: pos.x, y: pos.y, size: dotRadius - 1.2, color: MONO.white, borderWidth: 0 })
      }

      y -= Math.max(patBoxH, accesorios ? 18 : 0) + 4
    } else {
      // PIN/Contraseña en línea compacta — el marco es una tabla, no un fill
      const codeH = 28
      page.drawRectangle({ x: margin, y: y - codeH, width: halfWidth, height: codeH, borderColor: MONO.rule, borderWidth: RULE_WIDTH })
      drawSectionLabel(page, helveticaBold, "Código de acceso", margin + 10, y - 10)
      page.drawText(codigoAccesoDispositivo, { x: margin + 10, y: y - 23, size: 10, font: courier, color: MONO.ink })
      y -= codeH + 4
    }
  }

  // === PRESUPUESTO Y SEÑA ===
  if (presupuesto || data.sena) {
    const hasSena = data.sena && data.sena > 0
    const presupuestoHeight = hasSena ? 48 : 36
    page.drawRectangle({ x: margin, y: y - presupuestoHeight, width: contentWidth, height: presupuestoHeight, color: MONO.totalBg })
    if (presupuesto) {
      drawSectionLabel(page, helveticaBold, "Presupuesto estimado", margin + 14, y - 13)
      const presupuestoAmtWidth = helveticaBold.widthOfTextAtSize(presupuesto, TYPE.total)
      page.drawText(presupuesto, { x: width - margin - 14 - presupuestoAmtWidth, y: y - 30, size: TYPE.total, font: helveticaBold, color: MONO.ink })
      page.drawText("* Puede variar según diagnóstico", { x: margin + 14, y: y - 30, size: TYPE.fine, font: helvetica, color: MONO.faint })
    }
    if (hasSena) {
      const senaFormatted = formatCurrencyPDF(data.sena!)
      const senaY = presupuesto ? y - 44 : y - 13
      const metodoPago = data.metodoPagoSena || "EFECTIVO"
      const senaLabelWidth = drawSectionLabel(page, helveticaBold, "Seña abonada", margin + 14, senaY)
      page.drawText(`(${metodoPago})`, { x: margin + 14 + senaLabelWidth + 6, y: senaY, size: TYPE.fine, font: helvetica, color: MONO.label })
      const senaAmtWidth = helveticaBold.widthOfTextAtSize(senaFormatted, TYPE.total)
      page.drawText(senaFormatted, { x: width - margin - 14 - senaAmtWidth, y: senaY, size: TYPE.total, font: helveticaBold, color: MONO.ink })
    }
    y -= presupuestoHeight + 8
  }

  // === OBSERVACIONES (si hay) ===
  if (observaciones) {
    const obsLines: string[] = []
    let obsTempLine = ""
    const obsWords = observaciones.split(" ")
    for (const word of obsWords) {
      if (helvetica.widthOfTextAtSize(obsTempLine + " " + word, TYPE.body) < contentWidth - 28) {
        obsTempLine += (obsTempLine ? " " : "") + word
      } else {
        obsLines.push(obsTempLine)
        obsTempLine = word
      }
    }
    if (obsTempLine) obsLines.push(obsTempLine)
    const displayedObsLines = obsLines.slice(0, 3)
    const obsHeight = 22 + displayedObsLines.length * 13 + 6

    drawSectionLabel(page, helveticaBold, "OBSERVACIONES", margin + 12, y - 14)
    let obsY = y - 30
    for (const line of displayedObsLines) {
      page.drawText(line, { x: margin + 12, y: obsY, size: TYPE.body, font: helvetica, color: MONO.ink })
      obsY -= 13
    }
    drawRule(page, margin, width - margin, y - obsHeight + 4, { dotted: true })
    y -= obsHeight + 8
  }

  // === CHECKLIST DE RECEPCION (si hay) ===
  if (data.checklistItems && data.checklistItems.length > 0) {
    // Separar items booleanos de items con texto libre
    const boolItems = data.checklistItems.filter(i => i.valor === true || i.valor === false)
    const textItems = data.checklistItems.filter(i => i.valor !== true && i.valor !== false && i.valor !== null && i.valor !== undefined && String(i.valor).trim() !== "")

    const cols = 2
    const colWidth = (contentWidth - 4) / cols
    const checklistRowHeight = 13

    // Calcular altura del card de booleanos
    if (boolItems.length > 0) {
      const itemsPerCol = Math.ceil(boolItems.length / cols)
      const checklistHeight = 24 + Math.min(itemsPerCol, 8) * checklistRowHeight + 6

      if (y - checklistHeight >= 60) {
        drawRule(page, margin, width - margin, y)
        drawSectionLabel(page, helveticaBold, "Checklist de recepcion", margin + 14, y - 15)

        for (let col = 0; col < cols; col++) {
          const startIdx = col * itemsPerCol
          const colItems = boolItems.slice(startIdx, startIdx + itemsPerCol).slice(0, 8)
          let itemY = y - 36
          const colX = margin + 14 + col * colWidth
          const colRightEdge = col === 0
            ? margin + 4 + colWidth - 10
            : margin + contentWidth - 10

          for (const item of colItems) {
            const symbol = item.valor === true ? "SI" : "NO"
            const availableW = colRightEdge - colX

            page.drawText(truncateToWidth(item.label, availableW - 30, helvetica, TYPE.small), { x: colX, y: itemY, size: TYPE.small, font: helvetica, color: MONO.ink })
            page.drawText(symbol, { x: colRightEdge - helveticaBold.widthOfTextAtSize(symbol, TYPE.small), y: itemY, size: TYPE.small, font: helveticaBold, color: MONO.ink })
            itemY -= checklistRowHeight
          }
        }
        y -= checklistHeight + 4
      }
    }

    // Items con texto libre + notas del checklist, ancho completo debajo
    const notasText = data.checklistNotas ? safe(data.checklistNotas) : ""
    if (textItems.length > 0 || notasText) {
      const textRowHeight = 13
      const rowCount = textItems.length + (notasText ? 1 : 0)
      const textBlockHeight = 6 + rowCount * textRowHeight + 4
      const maxTextW = contentWidth - 28

      if (y - textBlockHeight >= 60) {
        let tY = y - 12
        for (const item of textItems) {
          const labelText = item.label + ":"
          const labelW = helveticaBold.widthOfTextAtSize(labelText, TYPE.small)
          page.drawText(labelText, { x: margin + 14, y: tY, size: TYPE.small, font: helveticaBold, color: MONO.ink })
          page.drawText(truncateToWidth(String(item.valor), maxTextW - labelW - 8, helvetica, TYPE.small), { x: margin + 14 + labelW + 6, y: tY, size: TYPE.small, font: helvetica, color: MONO.ink })
          tY -= textRowHeight
        }
        if (notasText) {
          const notasLabel = "Notas:"
          const notasLabelW = helveticaBold.widthOfTextAtSize(notasLabel, TYPE.small)
          page.drawText(notasLabel, { x: margin + 14, y: tY, size: TYPE.small, font: helveticaBold, color: MONO.ink })
          page.drawText(truncateToWidth(notasText, maxTextW - notasLabelW - 8, helvetica, TYPE.small), { x: margin + 14 + notasLabelW + 6, y: tY, size: TYPE.small, font: helvetica, color: MONO.ink })
        }
        y -= textBlockHeight + 8
      }
    } else {
      y -= 4 // solo agregar un poco de espacio si no hay texto
    }
  }

  // === QR + FIRMA (fluye desde y, sin gap artificial) ===
  const hasQR = data.publicToken && data.baseUrl
  const hasFirma = data.firmaRecepcion

  if (hasQR || hasFirma) {
    const firmaHeight = 80
    const qrSize = 60

    drawRule(page, margin, width - margin, y)

    if (hasQR && hasFirma) {
      // QR a la izquierda, firma a la derecha
      try {
        const trackingUrl = `${data.baseUrl}/seguimiento/${data.publicToken}`
        const qrDataUrl = await QRCode.toDataURL(trackingUrl, {
          width: 200,
          margin: 1,
          color: { dark: "#111111", light: "#ffffff" }
        })
        const qrBase64 = qrDataUrl.split(",")[1]
        const qrBytes = Uint8Array.from(atob(qrBase64), c => c.charCodeAt(0))
        const qrImage = await pdfDoc.embedPng(qrBytes)
        page.drawImage(qrImage, { x: margin, y: y - qrSize, width: qrSize, height: qrSize })
        page.drawText("Escanea para ver el estado", { x: margin, y: y - qrSize - 10, size: TYPE.fine, font: helvetica, color: MONO.label })
        page.drawText("de tu reparación", { x: margin, y: y - qrSize - 18, size: TYPE.fine, font: helvetica, color: MONO.label })
      } catch (qrError) {
        console.error("Error generating QR:", qrError)
      }

      try {
        const firmaX = margin + 90
        const firmaBoxWidth = contentWidth - 90

        drawSectionLabel(page, helveticaBold, "Firma del cliente al entregar equipo", firmaX + 10, y - 12)

        const firmaBytes = Uint8Array.from(atob(data.firmaRecepcion!), c => c.charCodeAt(0))
        const firmaImg = await pdfDoc.embedPng(firmaBytes)
        const firmaDims = firmaImg.scale(1)
        const firmaScale = Math.min((firmaBoxWidth - 40) / firmaDims.width, 50 / firmaDims.height)
        page.drawImage(firmaImg, {
          x: firmaX + (firmaBoxWidth - firmaDims.width * firmaScale) / 2,
          y: y - firmaHeight + 15,
          width: firmaDims.width * firmaScale,
          height: firmaDims.height * firmaScale,
        })

        drawRule(page, firmaX + 20, firmaX + firmaBoxWidth - 20, y - firmaHeight + 12, { color: MONO.ink })
        page.drawText("Firma del cliente", { x: firmaX + 20, y: y - firmaHeight + 4, size: TYPE.fine, font: helvetica, color: MONO.label })
      } catch (firmaError) {
        console.error("Error embedding reception signature:", firmaError)
      }

      y -= firmaHeight + 8
    } else if (hasQR) {
      try {
        const trackingUrl = `${data.baseUrl}/seguimiento/${data.publicToken}`
        const qrDataUrl = await QRCode.toDataURL(trackingUrl, {
          width: 200,
          margin: 1,
          color: { dark: "#111111", light: "#ffffff" }
        })
        const qrBase64 = qrDataUrl.split(",")[1]
        const qrBytes = Uint8Array.from(atob(qrBase64), c => c.charCodeAt(0))
        const qrImage = await pdfDoc.embedPng(qrBytes)
        page.drawImage(qrImage, { x: margin, y: y - qrSize, width: qrSize, height: qrSize })
        page.drawText("Escanea para ver el estado", { x: margin + qrSize + 10, y: y - 20, size: TYPE.small, font: helvetica, color: MONO.label })
        page.drawText("de tu reparación", { x: margin + qrSize + 10, y: y - 30, size: TYPE.small, font: helvetica, color: MONO.label })
      } catch (qrError) {
        console.error("Error generating QR:", qrError)
      }
      y -= qrSize + 8
    } else if (hasFirma) {
      try {
        drawSectionLabel(page, helveticaBold, "Firma del cliente al entregar equipo", margin + 10, y - 12)

        const firmaBytes = Uint8Array.from(atob(data.firmaRecepcion!), c => c.charCodeAt(0))
        const firmaImg = await pdfDoc.embedPng(firmaBytes)
        const firmaDims = firmaImg.scale(1)
        const firmaScale = Math.min((contentWidth - 40) / firmaDims.width, 50 / firmaDims.height)
        page.drawImage(firmaImg, {
          x: margin + (contentWidth - firmaDims.width * firmaScale) / 2,
          y: y - firmaHeight + 15,
          width: firmaDims.width * firmaScale,
          height: firmaDims.height * firmaScale,
        })

        drawRule(page, margin + 20, width - margin - 20, y - firmaHeight + 12, { color: MONO.ink })
        page.drawText("Firma del cliente", { x: margin + 20, y: y - firmaHeight + 4, size: TYPE.fine, font: helvetica, color: MONO.label })
      } catch (firmaError) {
        console.error("Error embedding reception signature:", firmaError)
      }
      y -= firmaHeight + 8
    }
  }

  // === TERMINOS Y CONDICIONES ===
  const terminos = parseRecepcionTerminos(data.recepcionTerminos)

  const terminosWrapped: string[] = []
  const maxTermWidth = contentWidth - 24
  for (const t of terminos) {
    if (helvetica.widthOfTextAtSize(t, 6.5) <= maxTermWidth) {
      terminosWrapped.push(t)
    } else {
      let line = ""
      for (const word of t.split(" ")) {
        if (helvetica.widthOfTextAtSize(line + " " + word, 6.5) <= maxTermWidth) {
          line += (line ? " " : "") + word
        } else {
          if (line) terminosWrapped.push(line)
          line = word
        }
      }
      if (line) terminosWrapped.push(line)
    }
  }
  const displayedTerminos = terminosWrapped.slice(0, 8)
  const terminosBoxHeight = 14 + displayedTerminos.length * 10 + 4

  // Terminos fluye directamente desde y — sin caja, mismos tamaños que antes.
  // No usa drawSectionLabel porque esa fine-print entera (heading + líneas) va
  // en MONO.faint, no en MONO.label (que drawSectionLabel no permite anular).
  page.drawText("TÉRMINOS Y CONDICIONES", { x: margin + 10, y: y - 11, size: TYPE.sectionLabel, font: helveticaBold, color: MONO.faint })

  let termY = y - 23
  displayedTerminos.forEach(t => {
    page.drawText(t, { x: margin + 10, y: termY, size: TYPE.fine, font: helvetica, color: MONO.faint })
    termY -= 10
  })

  y -= terminosBoxHeight + 8

  // === FOOTER (fluye desde y) ===
  const footerY = y - 10
  drawRule(page, margin, width - margin, footerY + 10)
  page.drawText(`Orden #${numeroOrden}`, { x: margin, y: footerY, size: TYPE.small, font: helveticaBold, color: MONO.ink })
  page.drawText(`Impreso: ${fechaImpresion}`, { x: width - margin - 120, y: footerY, size: TYPE.fine, font: helvetica, color: MONO.faint })

  // barraY se conserva únicamente como referencia para el recorte dinámico de
  // altura de página (ver más abajo): la barra inferior indigo se eliminó
  // del diseño monocromático, pero el cálculo de contentBottom no cambia.
  const barraY = footerY - 12

  // === AJUSTAR ALTURA DE PAGINA AL CONTENIDO ===
  // Minimo: ancho de pagina para mantener orientacion vertical en impresion
  const minPageHeight = width
  const contentBottom = barraY - 10 // espacio debajo de la barra
  const dynamicHeight = Math.max(height - contentBottom, minPageHeight)
  if (dynamicHeight < height) {
    page.setMediaBox(0, contentBottom, width, dynamicHeight)
    page.setCropBox(0, contentBottom, width, dynamicHeight)
    page.setTrimBox(0, contentBottom, width, dynamicHeight)
  }

  // === PÁGINA COMPACTA PARA EL LOCAL (solo para impresión, no para compartir) ===
  if (!data.soloCliente) {
  const localPage = pdfDoc.addPage([595, 842])
  const lm = 25
  const lContentW = 595 - lm * 2
  const lHalf = (lContentW - 8) / 2
  let ly = 842 - 20

  // Header: heading "COPIA LOCAL" + fechas en misma línea
  const lHeadingText = `COPIA LOCAL — Orden #${String(numeroOrden).padStart(4, "0")}`
  localPage.drawText(lHeadingText, { x: lm, y: ly, size: TYPE.docTitle, font: helveticaBold, color: MONO.ink })
  const fechasText = `Ingreso: ${fechaIngreso}` + (fechaPrometida ? `  |  Entrega est.: ${fechaPrometida}` : "")
  const fechasW = helvetica.widthOfTextAtSize(fechasText, TYPE.fine)
  localPage.drawText(fechasText, { x: 595 - lm - fechasW, y: ly + 2, size: TYPE.fine, font: helvetica, color: MONO.faint })
  ly -= 12
  drawRule(localPage, lm, 595 - lm, ly)
  ly -= 10

  // Detectar si hay patrón para reservar espacio a la derecha
  const isPattern = codigoAccesoDispositivo &&
    (codigoAccesoDispositivo.toLowerCase().startsWith("patrón:") ||
     codigoAccesoDispositivo.toLowerCase().startsWith("patron:"))
  const patternMatch = isPattern ? codigoAccesoDispositivo.match(/[\d-]+$/) : null
  const patternNumbers = patternMatch
    ? patternMatch[0].split("-").map(n => parseInt(n.trim())).filter(n => n >= 1 && n <= 9)
    : []
  const hasPattern = patternNumbers.length > 0

  // Zona derecha: patrón dibujado o código de acceso
  const rightColW = hasPattern ? 80 : (codigoAccesoDispositivo ? 100 : 0)
  const leftColW = lContentW - rightColW - (rightColW > 0 ? 10 : 0)
  const rightX = lm + leftColW + 10

  // Si hay patrón, dibujarlo a la derecha
  if (hasPattern) {
    const patGridY = ly
    const patCellSize = 16
    const patDotR = 3
    const patCenterX = rightX + rightColW / 2

    drawSectionLabel(localPage, helveticaBold, "Acceso", rightX, patGridY)

    const getPatPos = (num: number) => ({
      x: patCenterX + ((num - 1) % 3 - 1) * patCellSize,
      y: patGridY - 14 - Math.floor((num - 1) / 3) * patCellSize,
    })

    // Líneas del patrón
    for (let i = 0; i < patternNumbers.length - 1; i++) {
      const s = getPatPos(patternNumbers[i])
      const e = getPatPos(patternNumbers[i + 1])
      localPage.drawLine({ start: s, end: e, thickness: 1.2, color: MONO.ink })
    }
    // Puntos
    for (let num = 1; num <= 9; num++) {
      const pos = getPatPos(num)
      const inPat = patternNumbers.includes(num)
      localPage.drawCircle({ x: pos.x, y: pos.y, size: patDotR, color: inPat ? MONO.ink : MONO.rule, borderWidth: 0 })
      if (inPat) localPage.drawCircle({ x: pos.x, y: pos.y, size: patDotR - 1.5, color: MONO.white, borderWidth: 0 })
    }
  } else if (codigoAccesoDispositivo) {
    // Código de acceso como texto a la derecha
    drawSectionLabel(localPage, helveticaBold, "Acceso", rightX, ly)
    localPage.drawText(codigoAccesoDispositivo.substring(0, 20), { x: rightX, y: ly - 12, size: 9, font: courier, color: MONO.ink })
  }

  // === Columna izquierda: datos compactos ===
  // Fila: Cliente + Dispositivo
  drawSectionLabel(localPage, helveticaBold, "Cliente", lm, ly)
  localPage.drawText(`${clienteNombre.substring(0, 25)}  ·  Tel: ${clienteTelefono}`, { x: lm + 45, y: ly, size: 8, font: helvetica, color: MONO.ink })
  ly -= 12

  drawSectionLabel(localPage, helveticaBold, "Equipo", lm, ly)
  const devInfo = [dispositivo, marca, colorDisp].filter(Boolean).join(" - ") + (imei ? `  ·  ${imei}` : "")
  localPage.drawText(devInfo.substring(0, 55), { x: lm + 45, y: ly, size: 8, font: helvetica, color: MONO.ink })
  ly -= 14

  // Problema
  drawSectionLabel(localPage, helveticaBold, "Problema", lm, ly)
  localPage.drawText(problemaReportado.substring(0, 60), { x: lm + 45, y: ly, size: 8, font: helvetica, color: MONO.ink })
  ly -= 13

  // Accesorios + Presupuesto en misma línea si caben
  const infoLine: string[] = []
  if (accesorios) infoLine.push(`Acc: ${accesorios.substring(0, 30)}`)
  if (presupuesto) infoLine.push(`Presup: ${presupuesto}`)
  if (data.sena && data.sena > 0) infoLine.push(`Seña: ${formatCurrencyPDF(data.sena)}`)
  if (infoLine.length > 0) {
    localPage.drawText(infoLine.join("  |  "), { x: lm + 8, y: ly, size: 7, font: helvetica, color: MONO.label })
    ly -= 12
  }

  // Observaciones
  if (observaciones) {
    localPage.drawText(`OBS: ${observaciones.substring(0, 70)}`, { x: lm + 8, y: ly, size: 6, font: helvetica, color: MONO.label })
    ly -= 11
  }

  // Checklist compacto en línea
  if (data.checklistItems && data.checklistItems.length > 0) {
    drawRule(localPage, lm, lm + leftColW, ly + 4, { dotted: true })
    const colW = leftColW / 3
    let cx = lm
    let cy = ly - 2
    for (const item of data.checklistItems) {
      const val = item.valor === true ? "SI" : item.valor === false ? "NO" : String(item.valor || "").substring(0, 12)
      localPage.drawText(`${item.label}:`, { x: cx, y: cy, size: 5.5, font: helvetica, color: MONO.label })
      localPage.drawText(val, { x: cx + helvetica.widthOfTextAtSize(`${item.label}: `, 5.5), y: cy, size: 5.5, font: helveticaBold, color: MONO.ink })
      cx += colW
      if (cx + colW > lm + leftColW) { cx = lm; cy -= 10 }
    }
    ly = cy - 6
  }

  // Footer compacto
  drawRule(localPage, lm, 595 - lm, ly)
  localPage.drawText(`Orden #${numeroOrden} - COPIA LOCAL`, { x: lm, y: ly - 9, size: 6, font: helveticaBold, color: MONO.ink })
  localPage.drawText(`Impreso: ${fechaImpresion}`, { x: 595 - lm - 100, y: ly - 9, size: 5.5, font: helvetica, color: MONO.faint })

  const localBottom = ly - 16
  const localDynH = 842 - localBottom
  if (localDynH < 842) {
    localPage.setMediaBox(0, localBottom, 595, localDynH)
    localPage.setCropBox(0, localBottom, 595, localDynH)
    localPage.setTrimBox(0, localBottom, 595, localDynH)
  }

  // === PAGINA DE FOTOS DE INGRESO (si hay fotos) ===
  if (data.fotosIngreso && data.fotosIngreso.length > 0) {
    const photosPage = pdfDoc.addPage([width, height])
    let py = height - margin

    py -= 10

    photosPage.drawText("FOTOS DE INGRESO", { x: margin, y: py, size: TYPE.docTitle, font: helveticaBold, color: MONO.ink })
    photosPage.drawText(`Orden #${numeroOrden}`, { x: width - margin - 80, y: py, size: 10, font: helveticaBold, color: MONO.label })
    py -= 8
    drawRule(photosPage, margin, width - margin, py)
    py -= 20

    const photoSize = (contentWidth - 15) / 2
    const photoHeight = photoSize * 0.75
    let photoX = margin
    let photoCount = 0

    for (const foto of data.fotosIngreso.slice(0, 4)) {
      try {
        const photoRes = await fetch(foto.url)
        if (!photoRes.ok) continue
        const photoBuffer = new Uint8Array(await photoRes.arrayBuffer())
        const contentType = photoRes.headers.get("content-type") || ""

        let photoImage
        if (contentType.includes("png") || foto.url.toLowerCase().includes(".png")) {
          photoImage = await pdfDoc.embedPng(photoBuffer)
        } else {
          photoImage = await pdfDoc.embedJpg(photoBuffer)
        }

        if (photoImage) {
          const dims = photoImage.scale(1)
          const scale = Math.min(photoSize / dims.width, photoHeight / dims.height)
          const scaledW = dims.width * scale
          const scaledH = dims.height * scale

          // Border
          photosPage.drawRectangle({ x: photoX - 2, y: py - photoHeight - 2, width: photoSize + 4, height: photoHeight + 4, borderColor: MONO.rule, borderWidth: RULE_WIDTH })
          // Image centered in box
          photosPage.drawImage(photoImage, {
            x: photoX + (photoSize - scaledW) / 2,
            y: py - photoHeight + (photoHeight - scaledH) / 2,
            width: scaledW,
            height: scaledH,
          })

          if (foto.descripcion) {
            photosPage.drawText(safe(foto.descripcion).substring(0, 40), { x: photoX, y: py - photoHeight - 12, size: TYPE.fine, font: helvetica, color: MONO.label })
          }

          photoCount++
          if (photoCount % 2 === 0) {
            photoX = margin
            py -= photoHeight + 25
          } else {
            photoX = margin + photoSize + 15
          }
        }
      } catch (photoError) {
        console.error("Error embedding photo:", photoError)
      }
    }

    // Footer
    photosPage.drawText(`Orden #${numeroOrden} - Fotos de Ingreso`, { x: margin, y: 25, size: 8, font: helveticaBold, color: MONO.ink })
    photosPage.drawText(`Impreso: ${fechaImpresion}`, { x: width - margin - 120, y: 25, size: 7, font: helvetica, color: MONO.faint })
  }

  // === SECCION DE ENTREGA (segunda pagina, solo si fue entregado) ===
  if (data.estado === "ENTREGADO" && data.firmaClienteEntrega) {
    const page2 = pdfDoc.addPage([width, height])
    let ey = height - margin

    ey -= 10

    // Titulo
    page2.drawText("COMPROBANTE DE ENTREGA", { x: margin, y: ey, size: TYPE.docTitle, font: helveticaBold, color: MONO.ink })
    page2.drawText(`Orden #${numeroOrden}`, { x: width - margin - 80, y: ey, size: 10, font: helveticaBold, color: MONO.label })
    ey -= 25

    // Linea separadora
    drawRule(page2, margin, width - margin, ey)
    ey -= 20

    // Info de entrega
    page2.drawText("Fecha de entrega:", { x: margin, y: ey, size: TYPE.small, font: helvetica, color: MONO.label })
    page2.drawText(data.fechaEntrega ? formatDatePDF(data.fechaEntrega) : "-", { x: margin + 110, y: ey, size: TYPE.body, font: helveticaBold, color: MONO.ink })
    ey -= 16

    page2.drawText("Dispositivo:", { x: margin, y: ey, size: TYPE.small, font: helvetica, color: MONO.label })
    page2.drawText(safe(data.dispositivo), { x: margin + 110, y: ey, size: TYPE.body, font: helveticaBold, color: MONO.ink })
    ey -= 16

    page2.drawText("Cliente:", { x: margin, y: ey, size: TYPE.small, font: helvetica, color: MONO.label })
    page2.drawText(safe(data.cliente.nombre), { x: margin + 110, y: ey, size: TYPE.body, font: helveticaBold, color: MONO.ink })
    ey -= 16

    if (data.entregadoPor) {
      page2.drawText("Entregado por:", { x: margin, y: ey, size: TYPE.small, font: helvetica, color: MONO.label })
      page2.drawText(safe(data.entregadoPor), { x: margin + 110, y: ey, size: TYPE.body, font: helveticaBold, color: MONO.ink })
      ey -= 16
    }

    if (data.notasEntrega) {
      ey -= 5
      page2.drawText("Notas de entrega:", { x: margin, y: ey, size: TYPE.small, font: helvetica, color: MONO.label })
      ey -= 14
      page2.drawText(safe(data.notasEntrega).substring(0, 200), { x: margin, y: ey, size: TYPE.body, font: helvetica, color: MONO.ink })
      ey -= 16
    }

    ey -= 15

    // Firmas de entrega
    const entregaHalfWidth = (width - 2 * margin - 20) / 2
    const entregaCardX2 = margin + entregaHalfWidth + 20

    // Firma Cliente Entrega
    page2.drawRectangle({ x: margin, y: ey - 85, width: entregaHalfWidth, height: 100, borderColor: MONO.rule, borderWidth: RULE_WIDTH })
    drawSectionLabel(page2, helveticaBold, "Cliente (quien recibe)", margin + 12, ey + 5)

    try {
      const firmaClienteEntregaBytes = Uint8Array.from(atob(data.firmaClienteEntrega), c => c.charCodeAt(0))
      const firmaClienteEntregaImg = await pdfDoc.embedPng(firmaClienteEntregaBytes)
      const ceDims = firmaClienteEntregaImg.scale(1)
      const ceScale = Math.min((entregaHalfWidth - 40) / ceDims.width, 55 / ceDims.height)
      page2.drawImage(firmaClienteEntregaImg, {
        x: margin + (entregaHalfWidth - ceDims.width * ceScale) / 2,
        y: ey - 70,
        width: ceDims.width * ceScale,
        height: ceDims.height * ceScale,
      })
    } catch (e) {
      console.error("Error embedding client delivery signature:", e)
    }

    drawRule(page2, margin + 20, margin + entregaHalfWidth - 20, ey - 55, { color: MONO.ink })
    page2.drawText(safe(data.cliente.nombre).substring(0, 25), { x: margin + 30, y: ey - 70, size: 8, font: helvetica, color: MONO.ink })

    // Firma Encargado Entrega
    page2.drawRectangle({ x: entregaCardX2, y: ey - 85, width: entregaHalfWidth, height: 100, borderColor: MONO.rule, borderWidth: RULE_WIDTH })
    drawSectionLabel(page2, helveticaBold, "Encargado (quien entrega)", entregaCardX2 + 12, ey + 5)

    if (data.firmaEncargadoEntrega) {
      try {
        const firmaEncargadoBytes = Uint8Array.from(atob(data.firmaEncargadoEntrega), c => c.charCodeAt(0))
        const firmaEncargadoImg = await pdfDoc.embedPng(firmaEncargadoBytes)
        const eeDims = firmaEncargadoImg.scale(1)
        const eeScale = Math.min((entregaHalfWidth - 40) / eeDims.width, 55 / eeDims.height)
        page2.drawImage(firmaEncargadoImg, {
          x: entregaCardX2 + (entregaHalfWidth - eeDims.width * eeScale) / 2,
          y: ey - 70,
          width: eeDims.width * eeScale,
          height: eeDims.height * eeScale,
        })
      } catch (e) {
        console.error("Error embedding employee delivery signature:", e)
      }
    }

    drawRule(page2, entregaCardX2 + 20, entregaCardX2 + entregaHalfWidth - 20, ey - 55, { color: MONO.ink })
    page2.drawText(safe(data.entregadoPor).substring(0, 25), { x: entregaCardX2 + 30, y: ey - 70, size: 8, font: helvetica, color: MONO.ink })

    // Footer pagina 2
    page2.drawText(`Orden #${numeroOrden} - Comprobante de Entrega`, { x: margin, y: 25, size: 8, font: helveticaBold, color: MONO.ink })
    page2.drawText(`Impreso: ${fechaImpresion}`, { x: width - margin - 100, y: 25, size: 7, font: helvetica, color: MONO.faint })
  }

  } // fin if (!data.soloCliente)

  // === MODO SOLO CLIENTE (WhatsApp/compartir): devolver solo el comprobante del cliente ===
  if (data.soloCliente) {
    const pdfBytes = await pdfDoc.save()
    return Buffer.from(pdfBytes)
  }

  // === ENSAMBLAR: COPIA CLIENTE + LÍNEA DE CORTE + COPIA LOCAL en A4 ===
  // Orden de páginas en pdfDoc: 0=cliente, 1=local, 2+=fotos/entrega
  const originalBytes = await pdfDoc.save()
  const sourceDoc = await PDFLib.load(originalBytes)
  const finalDoc = await PDFLib.create()
  finalDoc.registerFontkit(fontkit)
  const fontsForLabel = await loadFonts()
  const labelFont = await finalDoc.embedFont(fontsForLabel.bold, { subset: true })

  // Obtener mediaBox real (con altura dinámica) de cada página
  const clientBox = sourceDoc.getPage(0).getMediaBox()
  const localBox = sourceDoc.getPage(1).getMediaBox()

  // Embeber con boundingBox para recortar al contenido real
  const [embClientPage] = await finalDoc.embedPages(
    [sourceDoc.getPage(0)],
    [{ left: clientBox.x, bottom: clientBox.y, right: clientBox.x + clientBox.width, top: clientBox.y + clientBox.height }]
  )
  const [embLocalPage] = await finalDoc.embedPages(
    [sourceDoc.getPage(1)],
    [{ left: localBox.x, bottom: localBox.y, right: localBox.x + localBox.width, top: localBox.y + localBox.height }]
  )

  const clientH = clientBox.height
  const clientW = clientBox.width
  const localH = localBox.height
  const cutZoneH = 14
  const pageW = 595
  const a4H = 842

  // Escalar para que ambas copias + línea de corte quepan en A4
  const totalNeeded = clientH + localH + cutZoneH
  const scaleVal = Math.min(1, a4H / totalNeeded, pageW / clientW)
  const scaledClientH = clientH * scaleVal
  const scaledLocalH = localH * scaleVal
  const scaledW = clientW * scaleVal
  const ox = (pageW - scaledW) / 2

  const combinedPage = finalDoc.addPage([pageW, a4H])
  const labelColor = MONO.label

  // --- Copia cliente arriba (pegada al tope) ---
  const clientY = a4H - scaledClientH
  combinedPage.drawPage(embClientPage, { x: ox, y: clientY, width: scaledW, height: scaledClientH })

  // --- Línea de corte punteada ---
  const cutY = clientY - cutZoneH / 2
  for (let dx = 12; dx < pageW - 12; dx += 10) {
    combinedPage.drawLine({
      start: { x: dx, y: cutY },
      end: { x: Math.min(dx + 5, pageW - 12), y: cutY },
      thickness: 0.5,
      color: labelColor,
    })
  }
  combinedPage.drawText("✂", { x: 3, y: cutY - 4, size: 8, font: labelFont, color: labelColor })

  // --- Copia local abajo (pegada debajo de la línea de corte) ---
  const localY = clientY - cutZoneH - scaledLocalH
  combinedPage.drawPage(embLocalPage, { x: ox, y: localY, width: scaledW, height: scaledLocalH })

  // Agregar páginas extras (fotos, entrega) como páginas separadas
  const extraIndices = sourceDoc.getPageIndices().filter(i => i > 1) // saltar 0=cliente, 1=local
  if (extraIndices.length > 0) {
    const copiedExtras = await finalDoc.copyPages(sourceDoc, extraIndices)
    for (const ep of copiedExtras) {
      finalDoc.addPage(ep)
    }
  }

  const finalBytes = await finalDoc.save()
  return Buffer.from(finalBytes)
}

// ========================================
// COMPROBANTE DE VENTA
// ========================================

interface VentaItem {
  descripcion: string
  cantidad: number
  precioUnitario: number
  subtotal: number
  diasGarantia: number
}

interface VentaPDFData {
  numeroVenta: number
  fecha: Date
  cliente: {
    nombre: string
    telefono?: string | null
  }
  vendedor: string
  items: VentaItem[]
  subtotal: number
  descuento: number
  total: number
  metodoPago: string
  nombreEmpresa?: string
  telefonoEmpresa?: string | null
  direccionEmpresa?: string | null
  logoUrl?: string | null
  moneda?: string
  zonaHoraria?: string
}

const metodoPagoLabels: Record<string, string> = {
  EFECTIVO: "Efectivo",
  TRANSFERENCIA: "Transferencia",
  TARJETA: "Tarjeta",
}

export async function generateVentaPDF(data: VentaPDFData): Promise<Buffer> {
  const safe = (val: unknown): string => {
    if (val === null || val === undefined) return ""
    if (typeof val === "string") return val.replace(/[\r\n]+/g, " ").trim()
    if (typeof val === "number") return String(val)
    return ""
  }

  const formatDatePDF = (date: Date | string | null | undefined): string => {
    return formatDateValue(date, data.zonaHoraria || DEFAULT_TIMEZONE)
  }

  const formatCurrencyPDF = (amount: number | null | undefined): string => {
    return formatCurrencyValue(amount, (data.moneda as CurrencyCode) || DEFAULT_CURRENCY)
  }

  // Extraer datos
  const empresaNombre = safe(data.nombreEmpresa) || "Servicio Tecnico"
  const telefonoEmpresa = safe(data.telefonoEmpresa)
  const direccionEmpresa = safe(data.direccionEmpresa)
  const numeroVenta = data.numeroVenta
  const fecha = formatDatePDF(data.fecha)
  const clienteNombre = safe(data.cliente?.nombre) || "Consumidor Final"
  const clienteTelefono = safe(data.cliente?.telefono)
  const vendedor = safe(data.vendedor)
  const metodoPago = metodoPagoLabels[data.metodoPago] || data.metodoPago

  // Crear documento PDF
  const pdfDoc = await PDFLib.create()
  const page = pdfDoc.addPage([595, 842]) // A4
  const { width, height } = page.getSize()

  // Cargar fuentes
  const { regular: helvetica, bold: helveticaBold } = await embedCustomFonts(pdfDoc)

  const margin = 40
  const contentWidth = width - (margin * 2)

  let y = height - margin - 20

  // === LOGO (si existe) ===
  let logoWidth = 0
  if (data.logoUrl) {
    try {
      const logoResponse = await fetch(data.logoUrl)
      if (logoResponse.ok) {
        const logoArrayBuffer = await logoResponse.arrayBuffer()
        const logoBytes = new Uint8Array(logoArrayBuffer)

        let logoImage
        const contentType = logoResponse.headers.get("content-type") || ""

        if (contentType.includes("png") || data.logoUrl.toLowerCase().includes(".png")) {
          logoImage = await pdfDoc.embedPng(logoBytes)
        } else if (contentType.includes("jpeg") || contentType.includes("jpg") || data.logoUrl.toLowerCase().includes(".jpg") || data.logoUrl.toLowerCase().includes(".jpeg")) {
          logoImage = await pdfDoc.embedJpg(logoBytes)
        }

        if (logoImage) {
          const logoDims = logoImage.scale(1)
          const maxLogoHeight = 50
          const maxLogoWidth = 80
          const scale = Math.min(maxLogoHeight / logoDims.height, maxLogoWidth / logoDims.width)
          const scaledWidth = logoDims.width * scale
          const scaledHeight = logoDims.height * scale

          page.drawImage(logoImage, {
            x: margin,
            y: height - margin - 10 - scaledHeight,
            width: scaledWidth,
            height: scaledHeight,
          })

          logoWidth = scaledWidth + 15
        }
      }
    } catch (logoError) {
      console.error("Error loading logo:", logoError)
    }
  }

  // === HEADER: Empresa ===
  page.drawText(empresaNombre, { x: margin + logoWidth, y, size: 16, font: helveticaBold, color: MONO.ink })
  y -= 16
  if (telefonoEmpresa) {
    page.drawText(`Tel: ${telefonoEmpresa}`, { x: margin + logoWidth, y, size: TYPE.small, font: helvetica, color: MONO.label })
    y -= 12
  }
  if (direccionEmpresa) {
    page.drawText(direccionEmpresa, { x: margin + logoWidth, y, size: TYPE.small, font: helvetica, color: MONO.label })
    y -= 12
  }

  // Bloque VENTA (lado derecho, alineado a la derecha, como el remito)
  const ventaLabel = "VENTA"
  const ventaLabelWidth = helveticaBold.widthOfTextAtSize(ventaLabel, TYPE.docTitle)
  page.drawText(ventaLabel, {
    x: width - margin - ventaLabelWidth,
    y: height - margin - 12,
    size: TYPE.docTitle,
    font: helveticaBold,
    color: MONO.ink,
  })
  const ventaNumeroText = `#${String(numeroVenta).padStart(4, "0")}`
  const ventaNumeroWidth = helveticaBold.widthOfTextAtSize(ventaNumeroText, TYPE.docNumber)
  page.drawText(ventaNumeroText, {
    x: width - margin - ventaNumeroWidth,
    y: height - margin - 34,
    size: TYPE.docNumber,
    font: helveticaBold,
    color: MONO.ink,
  })
  const fechaLabel = `Fecha: ${fecha}`
  const fechaLabelWidth = helvetica.widthOfTextAtSize(fechaLabel, TYPE.small)
  page.drawText(fechaLabel, {
    x: width - margin - fechaLabelWidth,
    y: height - margin - 50,
    size: TYPE.small,
    font: helvetica,
    color: MONO.label,
  })

  y = height - margin - 90

  // Linea separadora
  drawRule(page, margin, width - margin, y)
  y -= 20

  // === TITULO ===
  const titleText = "COMPROBANTE DE VENTA"
  const titleWidth = helveticaBold.widthOfTextAtSize(titleText, TYPE.docTitle)
  page.drawText(titleText, { x: (width - titleWidth) / 2, y, size: TYPE.docTitle, font: helveticaBold, color: MONO.ink })
  y -= 30

  // === DATOS DEL CLIENTE / VENDEDOR (sin caja) ===
  const clientBlockTop = y
  drawSectionLabel(page, helveticaBold, "CLIENTE", margin + 10, clientBlockTop - 5)
  page.drawText(clienteNombre, { x: margin + 10, y: clientBlockTop - 20, size: TYPE.body, font: helvetica, color: MONO.ink })
  if (clienteTelefono) {
    page.drawText(`Tel: ${clienteTelefono}`, { x: margin + 10, y: clientBlockTop - 33, size: TYPE.small, font: helvetica, color: MONO.label })
  }

  const vendedorX = margin + contentWidth / 2 + 20
  drawSectionLabel(page, helveticaBold, "VENDEDOR", vendedorX, clientBlockTop - 5)
  page.drawText(vendedor, { x: vendedorX, y: clientBlockTop - 20, size: TYPE.body, font: helvetica, color: MONO.ink })
  page.drawText(`Pago: ${metodoPago}`, { x: vendedorX, y: clientBlockTop - 33, size: TYPE.small, font: helvetica, color: MONO.label })

  const clientBoxHeight = 50
  drawRule(page, margin, width - margin, clientBlockTop - clientBoxHeight, { dotted: true })
  y -= clientBoxHeight + 10

  // === TABLA DE ITEMS ===
  drawSectionLabel(page, helveticaBold, "DETALLE DE PRODUCTOS", margin, y)
  y -= 4
  drawRule(page, margin, width - margin, y)
  y -= 20

  // Header de tabla (sin fill, mayusculas, MONO.label)
  page.drawText("DESCRIPCIÓN", { x: margin + 10, y, size: TYPE.small, font: helveticaBold, color: MONO.label })
  page.drawText("CANT.", { x: margin + 280, y, size: TYPE.small, font: helveticaBold, color: MONO.label })
  page.drawText("P. UNIT.", { x: margin + 330, y, size: TYPE.small, font: helveticaBold, color: MONO.label })
  page.drawText("SUBTOTAL", { x: margin + 410, y, size: TYPE.small, font: helveticaBold, color: MONO.label })
  page.drawText("GARANTIA", { x: margin + 475, y, size: TYPE.small, font: helveticaBold, color: MONO.label })
  y -= 8
  drawRule(page, margin, width - margin, y)
  y -= 17

  // Filas de items
  for (const item of data.items) {
    page.drawText(item.descripcion.substring(0, 40), { x: margin + 10, y, size: TYPE.body, font: helvetica, color: MONO.ink })
    page.drawText(String(item.cantidad), { x: margin + 285, y, size: TYPE.body, font: helvetica, color: MONO.ink })
    page.drawText(formatCurrencyPDF(item.precioUnitario), { x: margin + 330, y, size: TYPE.body, font: helvetica, color: MONO.ink })
    page.drawText(formatCurrencyPDF(item.subtotal), { x: margin + 410, y, size: TYPE.body, font: helvetica, color: MONO.ink })
    page.drawText(item.diasGarantia > 0 ? `${item.diasGarantia} dias` : "-", { x: margin + 478, y, size: TYPE.body, font: helvetica, color: MONO.ink })
    y -= 18
    drawRule(page, margin, width - margin, y + 10)
  }

  y -= 20

  // === TOTALES ===
  page.drawText("Subtotal:", { x: margin + 10, y, size: TYPE.body, font: helvetica, color: MONO.label })
  page.drawText(formatCurrencyPDF(data.subtotal), { x: width - margin - 100, y, size: TYPE.body, font: helvetica, color: MONO.ink })
  y -= 18
  drawRule(page, margin, width - margin, y + 10)

  if (data.descuento > 0) {
    page.drawText("Descuento:", { x: margin + 10, y, size: TYPE.body, font: helvetica, color: MONO.label })
    page.drawText(`-${formatCurrencyPDF(data.descuento)}`, { x: width - margin - 100, y, size: TYPE.body, font: helvetica, color: MONO.ink })
    y -= 18
    drawRule(page, margin, width - margin, y + 10)
  }

  y -= 5

  // Total (barra MONO.totalBg)
  page.drawRectangle({ x: margin, y: y - 8, width: contentWidth, height: 28, color: MONO.totalBg })
  page.drawText("TOTAL:", { x: margin + 10, y, size: TYPE.total, font: helveticaBold, color: MONO.ink })
  page.drawText(formatCurrencyPDF(data.total), { x: width - margin - 100, y, size: TYPE.total, font: helveticaBold, color: MONO.ink })

  // === FOOTER ===
  const footerY = margin + 60

  drawRule(page, margin, width - margin, footerY)

  page.drawText("Conserve este comprobante como prueba de compra.", { x: margin, y: footerY - 15, size: TYPE.fine, font: helvetica, color: MONO.faint })
  page.drawText("Los productos con garantia incluyen certificado por separado.", { x: margin, y: footerY - 27, size: TYPE.fine, font: helvetica, color: MONO.faint })
  page.drawText("Gracias por su compra!", { x: margin, y: footerY - 42, size: 9, font: helveticaBold, color: MONO.ink })

  const fechaImpresion = formatDateTimeValue(new Date(), data.zonaHoraria || DEFAULT_TIMEZONE)
  page.drawText(`Impreso: ${fechaImpresion}`, { x: width - margin - 110, y: footerY - 42, size: 7, font: helvetica, color: MONO.faint })

  const pdfBytes = await pdfDoc.save()
  return Buffer.from(pdfBytes)
}

// ========================================
// TICKET DE VENTA (58mm thermal printer)
// ========================================

export async function generateVentaTicketPDF(data: VentaPDFData, paperWidth: 58 | 80 = 58): Promise<Buffer> {
  const safe = (val: unknown): string => {
    if (val === null || val === undefined) return ""
    if (typeof val === "string") return val.replace(/[\r\n]+/g, " ").trim()
    if (typeof val === "number") return String(val)
    return ""
  }

  const formatDatePDF = (date: Date | string | null | undefined): string => {
    return formatDateTimeValue(date, data.zonaHoraria || DEFAULT_TIMEZONE)
  }

  const formatCurrencyPDF = (amount: number | null | undefined): string => {
    return formatCurrencyValue(amount, (data.moneda as CurrencyCode) || DEFAULT_CURRENCY)
  }

  // Convert mm to points (1mm = 2.835pt)
  const ticketWidth = Math.round(paperWidth * 2.835)
  const margin = paperWidth === 80 ? 14 : 10
  const contentWidth = ticketWidth - margin * 2
  const lineHeight = 11
  const smallLine = 9

  // Pre-calculate height
  const empresaNombre = safe(data.nombreEmpresa) || "Servicio Tecnico"
  const telefonoEmpresa = safe(data.telefonoEmpresa)
  const direccionEmpresa = safe(data.direccionEmpresa)
  const clienteNombre = safe(data.cliente?.nombre) || "Consumidor Final"
  const clienteTelefono = safe(data.cliente?.telefono)
  const vendedor = safe(data.vendedor)
  const fecha = formatDatePDF(data.fecha)
  const metodoPago = metodoPagoLabels[data.metodoPago] || data.metodoPago

  let estimatedHeight = 0
  estimatedHeight += 60 // header (empresa + venta number)
  estimatedHeight += 10 // separator
  estimatedHeight += 30 // fecha + cliente
  if (clienteTelefono) estimatedHeight += smallLine
  estimatedHeight += 15 // vendedor + separator
  estimatedHeight += 15 // column header
  estimatedHeight += data.items.length * (lineHeight + smallLine + 4) // items (name + detail line)
  estimatedHeight += 15 // separator
  estimatedHeight += 20 // subtotal
  if (data.descuento > 0) estimatedHeight += lineHeight
  estimatedHeight += 20 // total
  estimatedHeight += 15 // metodo pago
  estimatedHeight += 40 // footer
  estimatedHeight += 20 // bottom margin

  const pdfDoc = await PDFLib.create()
  const page = pdfDoc.addPage([ticketWidth, estimatedHeight])
  const { height } = page.getSize()

  const { regular: font, bold: fontBold } = await embedCustomFonts(pdfDoc)

  const black = MONO.ink
  const gray = MONO.label
  const lightGray = MONO.rule

  // Helper: draw centered text
  const drawCenter = (text: string, yPos: number, size: number, f = font, color = black) => {
    const w = f.widthOfTextAtSize(text, size)
    page.drawText(text, { x: (ticketWidth - w) / 2, y: yPos, size, font: f, color })
  }

  // Helper: draw right-aligned text
  const drawRight = (text: string, yPos: number, size: number, f = font, color = black) => {
    const w = f.widthOfTextAtSize(text, size)
    page.drawText(text, { x: ticketWidth - margin - w, y: yPos, size, font: f, color })
  }

  // Helper: dashed separator line
  const drawDash = (yPos: number) => {
    const dash = "- ".repeat(18)
    const w = font.widthOfTextAtSize(dash, 6)
    page.drawText(dash, { x: (ticketWidth - w) / 2, y: yPos, size: 6, font, color: lightGray })
  }

  let y = height - margin

  // === HEADER: Empresa ===
  // Nombre empresa (centered, bold)
  const empresaSize = empresaNombre.length > 20 ? 9 : 11
  drawCenter(empresaNombre, y, empresaSize, fontBold)
  y -= 12

  if (telefonoEmpresa) {
    drawCenter(`Tel: ${telefonoEmpresa}`, y, 7, font, gray)
    y -= 9
  }
  if (direccionEmpresa) {
    // Truncate long addresses
    const addr = direccionEmpresa.length > 35 ? direccionEmpresa.substring(0, 35) + "..." : direccionEmpresa
    drawCenter(addr, y, 6, font, gray)
    y -= 9
  }

  y -= 3
  drawDash(y)
  y -= 10

  // === VENTA NUMBER + FECHA ===
  drawCenter(`VENTA #${String(data.numeroVenta).padStart(4, "0")}`, y, 10, fontBold)
  y -= 12
  drawCenter(fecha, y, 7, font, gray)
  y -= 12

  drawDash(y)
  y -= 10

  // === CLIENTE + VENDEDOR ===
  page.drawText("Cliente:", { x: margin, y, size: 7, font, color: gray })
  page.drawText(clienteNombre.substring(0, 22), { x: margin + 30, y, size: 7, font: fontBold, color: black })
  y -= smallLine

  if (clienteTelefono) {
    page.drawText("Tel:", { x: margin, y, size: 7, font, color: gray })
    page.drawText(clienteTelefono, { x: margin + 30, y, size: 7, font, color: black })
    y -= smallLine
  }

  page.drawText("Vendedor:", { x: margin, y, size: 7, font, color: gray })
  page.drawText(vendedor.substring(0, 20), { x: margin + 36, y, size: 7, font, color: black })
  y -= 10

  drawDash(y)
  y -= 10

  // === ITEMS ===
  // Column headers
  page.drawText("Producto", { x: margin, y, size: 6, font: fontBold, color: gray })
  drawRight("Total", y, 6, fontBold, gray)
  y -= 8

  for (const item of data.items) {
    // Product name (full width, may truncate)
    const name = item.descripcion.length > 28 ? item.descripcion.substring(0, 28) + "..." : item.descripcion
    page.drawText(name, { x: margin, y, size: 7, font: fontBold, color: black })
    y -= smallLine

    // Quantity x price                  subtotal
    const qtyPrice = `  ${item.cantidad} x ${formatCurrencyPDF(item.precioUnitario)}`
    page.drawText(qtyPrice, { x: margin, y, size: 7, font, color: gray })
    drawRight(formatCurrencyPDF(item.subtotal), y, 7, font, black)

    if (item.diasGarantia > 0) {
      y -= smallLine
      page.drawText(`  Garantia: ${item.diasGarantia} dias`, { x: margin, y, size: 6, font, color: gray })
    }

    y -= lineHeight + 1
  }

  y -= 2
  drawDash(y)
  y -= 10

  // === TOTALES ===
  page.drawText("Subtotal:", { x: margin, y, size: 7, font, color: gray })
  drawRight(formatCurrencyPDF(data.subtotal), y, 7, font, black)
  y -= lineHeight

  if (data.descuento > 0) {
    page.drawText("Descuento:", { x: margin, y, size: 7, font, color: gray })
    drawRight(`-${formatCurrencyPDF(data.descuento)}`, y, 7, font, black)
    y -= lineHeight
  }

  // Total line (bigger, bold)
  y -= 2
  page.drawRectangle({ x: margin, y: y - 3, width: contentWidth, height: 14, color: MONO.totalBg })
  page.drawText("TOTAL:", { x: margin + 3, y, size: 9, font: fontBold, color: black })
  drawRight(formatCurrencyPDF(data.total), y, 9, fontBold, black)
  y -= 18

  // Metodo de pago
  page.drawText("Pago:", { x: margin, y, size: 7, font, color: gray })
  page.drawText(metodoPago, { x: margin + 22, y, size: 7, font: fontBold, color: black })
  y -= 14

  drawDash(y)
  y -= 10

  // === FOOTER ===
  drawCenter("Gracias por su compra!", y, 8, fontBold)
  y -= 10
  drawCenter("Conserve este ticket", y, 6, font, gray)
  y -= 8
  drawCenter("como comprobante", y, 6, font, gray)

  const pdfBytes = await pdfDoc.save()
  return Buffer.from(pdfBytes)
}

// ========================================
// CERTIFICADO DE GARANTIA DE VENTA
// ========================================

interface GarantiaVentaPDFData {
  numeroGarantia: string
  venta: {
    numeroVenta: number
    fecha: Date
  }
  cliente: {
    nombre: string
    telefono?: string | null
  }
  item: {
    descripcion: string
    cantidad: number
    marca?: string | null
  }
  diasValidez: number
  fechaInicio: Date
  fechaVencimiento: Date
  nombreEmpresa?: string
  telefonoEmpresa?: string | null
  direccionEmpresa?: string | null
  logoUrl?: string | null
  moneda?: string
  zonaHoraria?: string
  firmaEncargado?: string | null
  firmaEncargadoMime?: string | null
  nombreEncargado?: string | null
}

export async function generateGarantiaVentaPDF(data: GarantiaVentaPDFData): Promise<Buffer> {
  const safe = (val: unknown): string => {
    if (val === null || val === undefined) return ""
    if (typeof val === "string") return val.replace(/[\r\n]+/g, " ").trim()
    if (typeof val === "number") return String(val)
    return ""
  }

  const formatDatePDF = (date: Date | string | null | undefined): string => {
    if (!date) return ""
    const d = new Date(date)
    if (isNaN(d.getTime())) return ""
    return d.toLocaleDateString("es-AR", { day: "2-digit", month: "long", year: "numeric", timeZone: data.zonaHoraria || DEFAULT_TIMEZONE })
  }

  // Extraer datos
  const empresaNombre = safe(data.nombreEmpresa) || "Servicio Tecnico"
  const telefonoEmpresa = safe(data.telefonoEmpresa)
  const direccionEmpresa = safe(data.direccionEmpresa)
  const numeroGarantia = safe(data.numeroGarantia)
  const clienteNombre = safe(data.cliente?.nombre) || "Consumidor Final"
  const clienteTelefono = safe(data.cliente?.telefono)
  const productoDescripcion = safe(data.item?.descripcion)
  const productoCantidad = data.item?.cantidad || 1
  const fechaInicio = formatDatePDF(data.fechaInicio)
  const fechaVencimiento = formatDatePDF(data.fechaVencimiento)
  const numeroVenta = data.venta?.numeroVenta || 0
  const fechaVenta = formatDatePDF(data.venta?.fecha)

  // Crear documento PDF
  const pdfDoc = await PDFLib.create()
  const page = pdfDoc.addPage([595, 842]) // A4
  const { width, height } = page.getSize()

  // Cargar fuentes
  const { regular: helvetica, bold: helveticaBold } = await embedCustomFonts(pdfDoc)

  const margin = 40
  const contentWidth = width - (margin * 2)

  let y = height - margin - 20

  // === LOGO (si existe) ===
  let logoWidth = 0
  if (data.logoUrl) {
    try {
      const logoResponse = await fetch(data.logoUrl)
      if (logoResponse.ok) {
        const logoArrayBuffer = await logoResponse.arrayBuffer()
        const logoBytes = new Uint8Array(logoArrayBuffer)

        let logoImage
        const contentType = logoResponse.headers.get("content-type") || ""

        if (contentType.includes("png") || data.logoUrl.toLowerCase().includes(".png")) {
          logoImage = await pdfDoc.embedPng(logoBytes)
        } else if (contentType.includes("jpeg") || contentType.includes("jpg") || data.logoUrl.toLowerCase().includes(".jpg") || data.logoUrl.toLowerCase().includes(".jpeg")) {
          logoImage = await pdfDoc.embedJpg(logoBytes)
        }

        if (logoImage) {
          const logoDims = logoImage.scale(1)
          const maxLogoHeight = 50
          const maxLogoWidth = 80
          const scale = Math.min(maxLogoHeight / logoDims.height, maxLogoWidth / logoDims.width)
          const scaledWidth = logoDims.width * scale
          const scaledHeight = logoDims.height * scale

          page.drawImage(logoImage, {
            x: margin,
            y: height - margin - 10 - scaledHeight,
            width: scaledWidth,
            height: scaledHeight,
          })

          logoWidth = scaledWidth + 15
        }
      }
    } catch (logoError) {
      console.error("Error loading logo:", logoError)
    }
  }

  // === HEADER: Empresa ===
  page.drawText(empresaNombre, { x: margin + logoWidth, y, size: 16, font: helveticaBold, color: MONO.ink })
  y -= 16
  if (telefonoEmpresa) {
    page.drawText(`Tel: ${telefonoEmpresa}`, { x: margin + logoWidth, y, size: TYPE.small, font: helvetica, color: MONO.label })
    y -= 12
  }
  if (direccionEmpresa) {
    page.drawText(direccionEmpresa, { x: margin + logoWidth, y, size: TYPE.small, font: helvetica, color: MONO.label })
    y -= 12
  }

  // Bloque GARANTÍA (lado derecho, alineado a la derecha, como el remito/venta)
  const garantiaDocLabel = "GARANTÍA"
  const garantiaDocLabelWidth = helveticaBold.widthOfTextAtSize(garantiaDocLabel, TYPE.docTitle)
  page.drawText(garantiaDocLabel, {
    x: width - margin - garantiaDocLabelWidth,
    y: height - margin - 12,
    size: TYPE.docTitle,
    font: helveticaBold,
    color: MONO.ink,
  })
  const numeroWidth = helveticaBold.widthOfTextAtSize(numeroGarantia, TYPE.docNumber)
  page.drawText(numeroGarantia, {
    x: width - margin - numeroWidth,
    y: height - margin - 34,
    size: TYPE.docNumber,
    font: helveticaBold,
    color: MONO.ink,
  })
  const fechaLabel = `Fecha: ${fechaInicio}`
  const fechaLabelWidth = helvetica.widthOfTextAtSize(fechaLabel, TYPE.small)
  page.drawText(fechaLabel, {
    x: width - margin - fechaLabelWidth,
    y: height - margin - 50,
    size: TYPE.small,
    font: helvetica,
    color: MONO.label,
  })

  y = height - margin - 90

  // Linea separadora
  drawRule(page, margin, width - margin, y)
  y -= 20

  // === TITULO ===
  const titleText = "CERTIFICADO DE GARANTÍA"
  const titleWidth = helveticaBold.widthOfTextAtSize(titleText, TYPE.docTitle)
  page.drawText(titleText, { x: (width - titleWidth) / 2, y, size: TYPE.docTitle, font: helveticaBold, color: MONO.ink })
  y -= 30

  // === DATOS DEL CLIENTE (sin caja: heading tipográfico + filas planas) ===
  drawSectionLabel(page, helveticaBold, "DATOS DEL CLIENTE", margin + 10, y)
  y -= 18
  page.drawText("Nombre:", { x: margin + 15, y, size: TYPE.small, font: helvetica, color: MONO.label })
  page.drawText(clienteNombre, { x: margin + 65, y, size: TYPE.body, font: helveticaBold, color: MONO.ink })
  if (clienteTelefono) {
    page.drawText("Teléfono:", { x: margin + 280, y, size: TYPE.small, font: helvetica, color: MONO.label })
    page.drawText(clienteTelefono, { x: margin + 335, y, size: TYPE.body, font: helvetica, color: MONO.ink })
  }
  y -= 17
  page.drawText("Venta N°:", { x: margin + 15, y, size: TYPE.small, font: helvetica, color: MONO.label })
  page.drawText(`${String(numeroVenta).padStart(4, "0")}`, { x: margin + 65, y, size: TYPE.body, font: helveticaBold, color: MONO.ink })
  page.drawText("Fecha:", { x: margin + 150, y, size: TYPE.small, font: helvetica, color: MONO.label })
  page.drawText(fechaVenta, { x: margin + 190, y, size: TYPE.body, font: helvetica, color: MONO.ink })
  y -= 15
  drawRule(page, margin, width - margin, y, { dotted: true })
  y -= 22

  // === PRODUCTO CUBIERTO POR LA GARANTÍA (sin caja) ===
  drawSectionLabel(page, helveticaBold, "PRODUCTO CUBIERTO POR LA GARANTÍA", margin + 10, y)
  y -= 18
  page.drawText("Producto:", { x: margin + 15, y, size: TYPE.small, font: helvetica, color: MONO.label })
  // Truncar descripción si es muy larga
  let descripcionDisplay = productoDescripcion
  const maxDescWidth = contentWidth - 135
  while (helvetica.widthOfTextAtSize(descripcionDisplay, TYPE.body) > maxDescWidth && descripcionDisplay.length > 3) {
    descripcionDisplay = descripcionDisplay.slice(0, -4) + "..."
  }
  page.drawText(descripcionDisplay, { x: margin + 65, y, size: TYPE.body, font: helveticaBold, color: MONO.ink })
  y -= 17
  page.drawText("Cantidad:", { x: margin + 15, y, size: TYPE.small, font: helvetica, color: MONO.label })
  page.drawText(String(productoCantidad), { x: margin + 65, y, size: TYPE.body, font: helveticaBold, color: MONO.ink })
  y -= 15
  drawRule(page, margin, width - margin, y, { dotted: true })
  y -= 24

  // === VIGENCIA DE LA GARANTÍA ===
  drawSectionLabel(page, helveticaBold, "VIGENCIA DE LA GARANTÍA", margin + 10, y)
  const vigenteBadgeWidth = measureBadgeWidth(helveticaBold, "VIGENTE")
  drawOutlinedBadge(page, helveticaBold, "VIGENTE", width - margin - vigenteBadgeWidth, y + 10)
  y -= 40

  // Días grandes, centrados
  const diasText = `${data.diasValidez}`
  const diasSize = 36
  const diasWidth = helveticaBold.widthOfTextAtSize(diasText, diasSize)
  const diasLabelText = "DÍAS"
  const diasLabelWidth = helveticaBold.widthOfTextAtSize(diasLabelText, TYPE.body)
  const diasBlockWidth = diasWidth + 8 + diasLabelWidth
  const diasBlockX = margin + (contentWidth - diasBlockWidth) / 2
  page.drawText(diasText, { x: diasBlockX, y: y - 26, size: diasSize, font: helveticaBold, color: MONO.ink })
  page.drawText(diasLabelText, { x: diasBlockX + diasWidth + 8, y: y - 18, size: TYPE.body, font: helveticaBold, color: MONO.label })
  y -= 48

  // Desde / Hasta
  const vigColX2 = margin + contentWidth / 2 + 20
  page.drawText("DESDE", { x: margin + 15, y, size: TYPE.small, font: helveticaBold, color: MONO.label })
  page.drawText(fechaInicio, { x: margin + 15, y: y - 14, size: TYPE.body, font: helveticaBold, color: MONO.ink })
  page.drawText("HASTA", { x: vigColX2, y, size: TYPE.small, font: helveticaBold, color: MONO.label })
  page.drawText(fechaVencimiento, { x: vigColX2, y: y - 14, size: TYPE.body, font: helveticaBold, color: MONO.ink })
  y -= 32
  drawRule(page, margin, width - margin, y, { dotted: true })
  y -= 22

  // === CONDICIONES DE LA GARANTÍA (sin caja, viñetas de texto) ===
  drawSectionLabel(page, helveticaBold, "CONDICIONES DE LA GARANTÍA", margin + 10, y)
  y -= 18

  const condiciones = [
    "Esta garantia cubre defectos de fabricacion del producto.",
    "No cubre danos por mal uso, caidas, liquidos o manipulacion inadecuada.",
    "Para hacer efectiva la garantia, presente este certificado y el producto.",
    "La garantia no es transferible. El producto sera reparado o reemplazado segun disponibilidad.",
  ]

  for (const condicion of condiciones) {
    page.drawText(`• ${condicion}`, { x: margin + 10, y, size: TYPE.small, font: helvetica, color: MONO.label })
    y -= 13
  }

  // === FIRMA DEL ENCARGADO (caja con contorno, mismo tratamiento que las firmas de entrega) ===
  y -= 8
  const sigBoxW = 200
  const sigBoxH = 75
  const sigBoxX = width - margin - sigBoxW

  page.drawRectangle({ x: sigBoxX, y: y - sigBoxH, width: sigBoxW, height: sigBoxH, borderColor: MONO.rule, borderWidth: RULE_WIDTH })
  drawSectionLabel(page, helveticaBold, "Firma del encargado", sigBoxX + 12, y - 12)

  // Embed signature image if available
  if (data.firmaEncargado) {
    try {
      const sigBytes = Buffer.from(data.firmaEncargado, "base64")
      const sigUint8 = new Uint8Array(sigBytes)
      let sigImage
      const sigMime = data.firmaEncargadoMime || "image/png"
      if (sigMime.includes("png")) {
        sigImage = await pdfDoc.embedPng(sigUint8)
      } else {
        sigImage = await pdfDoc.embedJpg(sigUint8)
      }
      if (sigImage) {
        const sigDims = sigImage.scale(1)
        const sigScale = Math.min((sigBoxW - 40) / sigDims.width, 32 / sigDims.height)
        const sigW = sigDims.width * sigScale
        const sigH = sigDims.height * sigScale
        page.drawImage(sigImage, { x: sigBoxX + (sigBoxW - sigW) / 2, y: y - sigBoxH + 33, width: sigW, height: sigH })
      }
    } catch (sigError) {
      console.error("Error embedding signature:", sigError)
    }
  }

  drawRule(page, sigBoxX + 20, sigBoxX + sigBoxW - 20, y - sigBoxH + 28, { color: MONO.ink })
  const firmaLabel = data.nombreEncargado || "Encargado"
  page.drawText(firmaLabel.substring(0, 28), { x: sigBoxX + 20, y: y - sigBoxH + 16, size: TYPE.fine, font: helvetica, color: MONO.ink })

  y -= sigBoxH

  // === FOOTER ===
  const footerY = 40
  drawRule(page, margin, width - margin, footerY + 10)
  page.drawText("Conserve este certificado junto con su comprobante de compra.", { x: margin, y: footerY - 5, size: TYPE.fine, font: helvetica, color: MONO.faint })

  const fechaImpresion = formatDateValue(new Date(), data.zonaHoraria || DEFAULT_TIMEZONE)
  page.drawText(`Emitido: ${fechaImpresion}`, { x: width - margin - 110, y: footerY - 5, size: 7, font: helvetica, color: MONO.faint })

  const pdfBytes = await pdfDoc.save()
  return Buffer.from(pdfBytes)
}

// ========================================
// COMPROBANTE DE ENTREGA
// ========================================

interface ComprobanteEntregaPDFData {
  numeroOrden: number
  codigoOrden?: string | null
  fechaIngreso: Date
  fechaEntrega: Date
  cliente: {
    nombre: string
    telefono: string
    email?: string | null
  }
  dispositivo: string
  tipoDispositivo: string
  marca?: string | null
  problemaReportado: string
  diagnostico?: string | null
  // Firmas
  firmaClienteEntrega: string // base64
  firmaClienteMime: string
  firmaEncargadoEntrega: string // base64
  firmaEncargadoMime: string
  entregadoPor: string // nombre del usuario
  notasEntrega?: string | null
  // Empresa
  nombreEmpresa?: string
  telefonoEmpresa?: string | null
  direccionEmpresa?: string | null
  ciudadEmpresa?: string | null
  provinciaEmpresa?: string | null
  codigoPostalEmpresa?: string | null
  logoUrl?: string | null
  moneda?: string
  zonaHoraria?: string
  esRetiroSinReparacion?: boolean
}

export async function generateComprobanteEntregaPDF(data: ComprobanteEntregaPDFData): Promise<Buffer> {
  const safe = (val: unknown): string => {
    if (val === null || val === undefined) return ""
    if (typeof val === "string") return val.replace(/[\r\n]+/g, " ").trim()
    if (typeof val === "number") return String(val)
    return ""
  }

  const formatDatePDF = (date: Date | string | null | undefined): string => {
    return formatDateValue(date, data.zonaHoraria || DEFAULT_TIMEZONE)
  }

  const formatDateTimePDF = (date: Date | string | null | undefined): string => {
    return formatDateTimeValue(date, data.zonaHoraria || DEFAULT_TIMEZONE)
  }

  // Extraer datos
  const empresaNombre = safe(data.nombreEmpresa) || "Servicio Técnico"
  const telefonoEmpresa = safe(data.telefonoEmpresa)
  const direccionEmpresa = safe(data.direccionEmpresa)
  const ciudadEmpresa = safe(data.ciudadEmpresa)
  const provinciaEmpresa = safe(data.provinciaEmpresa)
  const codigoPostalEmpresa = safe(data.codigoPostalEmpresa)
  const numeroOrden = data.numeroOrden
  const codigoOrden = safe(data.codigoOrden)
  const fechaIngreso = formatDatePDF(data.fechaIngreso)
  const fechaEntrega = formatDateTimePDF(data.fechaEntrega)
  const clienteNombre = safe(data.cliente?.nombre) || "Sin nombre"
  const clienteTelefono = safe(data.cliente?.telefono)
  const clienteEmail = safe(data.cliente?.email)
  const dispositivo = safe(data.dispositivo)
  const tipoDispositivo = safe(data.tipoDispositivo)
  const marca = safe(data.marca)
  const problemaReportado = safe(data.problemaReportado)
  const diagnostico = safe(data.diagnostico)
  const entregadoPor = safe(data.entregadoPor)
  const notasEntrega = safe(data.notasEntrega)

  // Crear documento PDF
  const pdfDoc = await PDFLib.create()
  const page = pdfDoc.addPage([595, 842]) // A4
  const { width, height } = page.getSize()

  // Cargar fuentes
  const { regular: helvetica, bold: helveticaBold } = await embedCustomFonts(pdfDoc)

  const esRetiro = data.esRetiroSinReparacion || false

  const margin = 40
  const contentWidth = width - (margin * 2)
  const cardGap = 10
  const halfWidth = (contentWidth - cardGap) / 2

  let y = height - margin - 20

  // === LOGO (si existe) ===
  let logoWidth = 0
  if (data.logoUrl) {
    try {
      const logoResponse = await fetch(data.logoUrl)
      if (logoResponse.ok) {
        const logoArrayBuffer = await logoResponse.arrayBuffer()
        const logoBytes = new Uint8Array(logoArrayBuffer)
        let logoImage
        const contentType = logoResponse.headers.get("content-type") || ""
        if (contentType.includes("png") || data.logoUrl.toLowerCase().includes(".png")) {
          logoImage = await pdfDoc.embedPng(logoBytes)
        } else if (contentType.includes("jpeg") || contentType.includes("jpg")) {
          logoImage = await pdfDoc.embedJpg(logoBytes)
        }
        if (logoImage) {
          const logoDims = logoImage.scale(1)
          const maxLogoHeight = 45
          const maxLogoWidth = 60
          const scale = Math.min(maxLogoHeight / logoDims.height, maxLogoWidth / logoDims.width)
          const scaledWidth = logoDims.width * scale
          const scaledHeight = logoDims.height * scale
          page.drawImage(logoImage, { x: margin, y: y - scaledHeight + 5, width: scaledWidth, height: scaledHeight })
          logoWidth = scaledWidth + 12
        }
      }
    } catch (logoError) {
      console.error("Error loading logo:", logoError)
    }
  }

  // === HEADER: Empresa ===
  page.drawText(empresaNombre, { x: margin + logoWidth, y, size: 16, font: helveticaBold, color: MONO.ink })
  y -= 16
  if (telefonoEmpresa) {
    page.drawText(`Tel: ${telefonoEmpresa}`, { x: margin + logoWidth, y, size: TYPE.small, font: helvetica, color: MONO.label })
    y -= 12
  }
  const entregaLocationParts: string[] = []
  if (direccionEmpresa) entregaLocationParts.push(direccionEmpresa)
  if (ciudadEmpresa) entregaLocationParts.push(ciudadEmpresa)
  if (codigoPostalEmpresa) entregaLocationParts.push(`CP ${codigoPostalEmpresa}`)
  if (provinciaEmpresa) entregaLocationParts.push(provinciaEmpresa)
  if (entregaLocationParts.length > 0) {
    page.drawText(entregaLocationParts.join(", "), { x: margin + logoWidth, y, size: TYPE.small, font: helvetica, color: MONO.label })
  }

  // Bloque ENTREGA/RETIRO (lado derecho, alineado a la derecha, como los demás comprobantes)
  const badgeText = esRetiro ? "RETIRO" : "ENTREGA"
  const entregaBadgeWidth = measureBadgeWidth(helveticaBold, badgeText)
  drawOutlinedBadge(page, helveticaBold, badgeText, width - margin - entregaBadgeWidth, height - margin - 2)

  const ordenDisplay = codigoOrden || `#${String(numeroOrden).padStart(4, "0")}`
  const ordenTextWidth = helveticaBold.widthOfTextAtSize(ordenDisplay, TYPE.docNumber)
  page.drawText(ordenDisplay, {
    x: width - margin - ordenTextWidth,
    y: height - margin - 34,
    size: TYPE.docNumber,
    font: helveticaBold,
    color: MONO.ink,
  })
  const fechaLabel = `Fecha: ${fechaEntrega}`
  const fechaLabelWidth = helvetica.widthOfTextAtSize(fechaLabel, TYPE.small)
  page.drawText(fechaLabel, {
    x: width - margin - fechaLabelWidth,
    y: height - margin - 50,
    size: TYPE.small,
    font: helvetica,
    color: MONO.label,
  })

  y = height - margin - 90

  // Linea separadora
  drawRule(page, margin, width - margin, y)
  y -= 20

  // === TITULO ===
  const titleText = esRetiro ? "ORDEN DE RETIRO - SIN REPARACIÓN" : "COMPROBANTE DE ENTREGA"
  const titleWidth = helveticaBold.widthOfTextAtSize(titleText, TYPE.docTitle)
  page.drawText(titleText, { x: (width - titleWidth) / 2, y, size: TYPE.docTitle, font: helveticaBold, color: MONO.ink })
  y -= 30

  // === GRID: CLIENTE | DISPOSITIVO (sin caja, columnas tipográficas) ===
  const clientBlockTop = y
  drawSectionLabel(page, helveticaBold, "CLIENTE", margin + 10, clientBlockTop - 5)
  page.drawText(clienteNombre.substring(0, 28), { x: margin + 10, y: clientBlockTop - 20, size: TYPE.body, font: helveticaBold, color: MONO.ink })
  page.drawText(`Tel: ${clienteTelefono}`, { x: margin + 10, y: clientBlockTop - 33, size: TYPE.small, font: helvetica, color: MONO.label })
  if (clienteEmail) {
    page.drawText(clienteEmail.substring(0, 25), { x: margin + 10, y: clientBlockTop - 45, size: TYPE.small, font: helvetica, color: MONO.label })
  }

  const dispX = margin + contentWidth / 2 + 20
  drawSectionLabel(page, helveticaBold, "DISPOSITIVO", dispX, clientBlockTop - 5)
  page.drawText(dispositivo.substring(0, 25), { x: dispX, y: clientBlockTop - 20, size: TYPE.body, font: helveticaBold, color: MONO.ink })
  page.drawText(tipoDispositivo, { x: dispX, y: clientBlockTop - 33, size: TYPE.small, font: helvetica, color: MONO.label })
  if (marca) {
    page.drawText(`Marca: ${marca}`, { x: dispX, y: clientBlockTop - 45, size: TYPE.small, font: helvetica, color: MONO.label })
  }

  const clientBoxHeight = 55
  drawRule(page, margin, width - margin, clientBlockTop - clientBoxHeight, { dotted: true })
  y -= clientBoxHeight + 15

  // === FECHAS Y ENTREGADO POR (plano, mismo tratamiento que la página de entrega de generateOrdenPDF) ===
  page.drawText("Ingreso:", { x: margin, y, size: TYPE.small, font: helvetica, color: MONO.label })
  page.drawText(fechaIngreso, { x: margin + 110, y, size: TYPE.body, font: helveticaBold, color: MONO.ink })
  y -= 16

  page.drawText(esRetiro ? "Retiro:" : "Entrega:", { x: margin, y, size: TYPE.small, font: helvetica, color: MONO.label })
  page.drawText(fechaEntrega, { x: margin + 110, y, size: TYPE.body, font: helveticaBold, color: MONO.ink })
  y -= 16

  page.drawText("Entregado por:", { x: margin, y, size: TYPE.small, font: helvetica, color: MONO.label })
  page.drawText(entregadoPor, { x: margin + 110, y, size: TYPE.body, font: helveticaBold, color: MONO.ink })
  y -= 20

  // === PROBLEMA / DIAGNOSTICO ===
  drawSectionLabel(page, helveticaBold, esRetiro ? "MOTIVO DE NO REPARACIÓN" : "TRABAJO REALIZADO", margin, y)
  y -= 16
  page.drawText("Problema:", { x: margin, y, size: TYPE.small, font: helvetica, color: MONO.label })
  page.drawText(problemaReportado.substring(0, 70), { x: margin + 60, y, size: TYPE.body, font: helvetica, color: MONO.ink })
  y -= 14
  if (diagnostico) {
    page.drawText("Diagnóstico:", { x: margin, y, size: TYPE.small, font: helvetica, color: MONO.label })
    page.drawText(diagnostico.substring(0, 65), { x: margin + 70, y, size: TYPE.body, font: helvetica, color: MONO.ink })
    y -= 14
  }
  y -= 6
  drawRule(page, margin, width - margin, y, { dotted: true })
  y -= 18

  // === NOTAS DE ENTREGA (si hay) ===
  if (notasEntrega) {
    drawSectionLabel(page, helveticaBold, "NOTAS DE ENTREGA", margin, y)
    y -= 14
    page.drawText(notasEntrega.substring(0, 80), { x: margin, y, size: TYPE.body, font: helvetica, color: MONO.ink })
    y -= 12
  }

  // === SECCION DE FIRMAS (misma caja con contorno que la página de entrega de generateOrdenPDF) ===
  y -= 8
  drawRule(page, margin, width - margin, y)
  drawSectionLabel(page, helveticaBold, "FIRMAS DE CONFORMIDAD", margin, y - 15)
  y -= 40

  const firmaClienteX = margin
  const firmaEncargadoX = margin + halfWidth + cardGap

  // Firma Cliente
  page.drawRectangle({ x: firmaClienteX, y: y - 85, width: halfWidth, height: 100, borderColor: MONO.rule, borderWidth: RULE_WIDTH })
  drawSectionLabel(page, helveticaBold, "Cliente (quien recibe)", firmaClienteX + 12, y + 5)

  try {
    const firmaClienteBytes = Uint8Array.from(atob(data.firmaClienteEntrega), c => c.charCodeAt(0))
    const firmaClienteImage = await pdfDoc.embedPng(firmaClienteBytes)
    const clienteDims = firmaClienteImage.scale(1)
    const clienteScale = Math.min((halfWidth - 40) / clienteDims.width, 50 / clienteDims.height)
    page.drawImage(firmaClienteImage, {
      x: firmaClienteX + (halfWidth - clienteDims.width * clienteScale) / 2,
      y: y - 70,
      width: clienteDims.width * clienteScale,
      height: clienteDims.height * clienteScale,
    })
  } catch (e) {
    console.error("Error embedding client signature:", e)
  }

  drawRule(page, firmaClienteX + 20, firmaClienteX + halfWidth - 20, y - 55, { color: MONO.ink })
  page.drawText(clienteNombre.substring(0, 25), { x: firmaClienteX + 30, y: y - 70, size: TYPE.fine, font: helvetica, color: MONO.ink })

  // Firma Encargado
  page.drawRectangle({ x: firmaEncargadoX, y: y - 85, width: halfWidth, height: 100, borderColor: MONO.rule, borderWidth: RULE_WIDTH })
  drawSectionLabel(page, helveticaBold, "Encargado (quien entrega)", firmaEncargadoX + 12, y + 5)

  try {
    const firmaEncargadoBytes = Uint8Array.from(atob(data.firmaEncargadoEntrega), c => c.charCodeAt(0))
    const firmaEncargadoImage = await pdfDoc.embedPng(firmaEncargadoBytes)
    const encargadoDims = firmaEncargadoImage.scale(1)
    const encargadoScale = Math.min((halfWidth - 40) / encargadoDims.width, 50 / encargadoDims.height)
    page.drawImage(firmaEncargadoImage, {
      x: firmaEncargadoX + (halfWidth - encargadoDims.width * encargadoScale) / 2,
      y: y - 70,
      width: encargadoDims.width * encargadoScale,
      height: encargadoDims.height * encargadoScale,
    })
  } catch (e) {
    console.error("Error embedding staff signature:", e)
  }

  drawRule(page, firmaEncargadoX + 20, firmaEncargadoX + halfWidth - 20, y - 55, { color: MONO.ink })
  page.drawText(entregadoPor.substring(0, 25), { x: firmaEncargadoX + 30, y: y - 70, size: TYPE.fine, font: helvetica, color: MONO.ink })

  y -= 100

  // === FOOTER (términos, mismo tratamiento fine-print que generateOrdenPDF) ===
  const terminosTitle = esRetiro ? "TÉRMINOS DE RETIRO" : "TÉRMINOS DE ENTREGA"
  page.drawText(terminosTitle, { x: margin, y: y - 4, size: TYPE.sectionLabel, font: helveticaBold, color: MONO.faint })
  const terminos = esRetiro
    ? [
        "• El cliente retira el equipo sin reparar, en el estado en que se encuentra.",
        "• Al firmar, el cliente exime al taller de toda responsabilidad sobre el equipo y su funcionamiento.",
        "• Conserve este comprobante como constancia de retiro del equipo.",
      ]
    : [
        "• Al firmar este documento, el cliente confirma haber recibido el equipo en condiciones satisfactorias.",
        "• La garantía del servicio aplica según lo acordado. Consulte las condiciones específicas.",
        "• Conserve este comprobante como prueba de entrega del equipo.",
      ]
  let termY = y - 16
  terminos.forEach(t => {
    page.drawText(t, { x: margin, y: termY, size: TYPE.fine, font: helvetica, color: MONO.faint })
    termY -= 10
  })

  const footerY = termY - 10
  drawRule(page, margin, width - margin, footerY + 10)
  page.drawText(`Orden ${ordenDisplay}`, { x: margin, y: footerY - 5, size: TYPE.fine, font: helveticaBold, color: MONO.ink })

  const fechaImpresion2 = formatDateTimeValue(new Date(), data.zonaHoraria || DEFAULT_TIMEZONE)
  page.drawText(`Impreso: ${fechaImpresion2}`, { x: width - margin - 110, y: footerY - 5, size: 7, font: helvetica, color: MONO.faint })

  const pdfBytes = await pdfDoc.save()
  return Buffer.from(pdfBytes)
}

// ========================================
// FACTURA (INVOICE) PDF
// ========================================

interface FacturaPago {
  monto: number
  metodoPago: string
  fecha: Date | string
  referencia?: string | null
  cuotas?: number | null
  recargoPorcentaje?: number | null
  montoOriginal?: number | null
}

interface FacturaPDFData {
  numeroFactura: string
  fecha: Date | string
  estadoPago: string
  cliente: {
    nombre: string
    telefono?: string | null
    email?: string | null
    direccion?: string | null
  }
  orden?: {
    numeroOrden: number
    codigoOrden?: string | null
    dispositivo: string
  }
  venta?: {
    numeroVenta: number
  }
  // venta-sourced only — orden-sourced facturas have no discount concept.
  descuento?: number
  redondeo?: number
  items?: Array<{
    descripcion: string
    cantidad: number
    precioUnitario: number
    subtotal: number
  }>
  subtotal: number
  iva: number
  total: number
  montoAbonado: number
  pagos: FacturaPago[]
  nombreEmpresa?: string
  telefonoEmpresa?: string | null
  direccionEmpresa?: string | null
  logoUrl?: string | null
  moneda?: string
  zonaHoraria?: string
}

const estadoPagoLabels: Record<string, string> = {
  PENDIENTE: "PENDIENTE",
  PAGADO_PARCIAL: "PAGO PARCIAL",
  PAGADO: "PAGADO",
  ANULADA: "ANULADA",
}

const metodoPagoFacturaLabels: Record<string, string> = {
  EFECTIVO: "Efectivo",
  TRANSFERENCIA: "Transferencia",
  TARJETA_DEBITO: "Tarjeta Debito",
  TARJETA_CREDITO: "Tarjeta Credito",
  MERCADOPAGO: "MercadoPago",
  OTRO: "Otro",
}

export async function generateFacturaPDF(data: FacturaPDFData): Promise<Buffer> {
  const safe = (val: unknown): string => {
    if (val === null || val === undefined) return ""
    if (typeof val === "string") return val.replace(/[\r\n]+/g, " ").trim()
    if (typeof val === "number") return String(val)
    return ""
  }

  const formatDatePDF = (date: Date | string | null | undefined): string => {
    return formatDateValue(date, data.zonaHoraria || DEFAULT_TIMEZONE)
  }

  const formatCurrencyPDF = (amount: number | null | undefined): string => {
    return formatCurrencyValue(amount, (data.moneda as CurrencyCode) || DEFAULT_CURRENCY)
  }

  const empresaNombre = safe(data.nombreEmpresa) || "Servicio Tecnico"
  const telefonoEmpresa = safe(data.telefonoEmpresa)
  const direccionEmpresa = safe(data.direccionEmpresa)
  const numeroFactura = safe(data.numeroFactura)
  const fecha = formatDatePDF(data.fecha)
  const clienteNombre = safe(data.cliente?.nombre) || "Consumidor Final"
  const clienteTelefono = safe(data.cliente?.telefono)
  const clienteEmail = safe(data.cliente?.email)
  const clienteDireccion = safe(data.cliente?.direccion)
  const ordenDisplay = data.orden
    ? data.orden.codigoOrden || `#${String(data.orden.numeroOrden).padStart(4, "0")}`
    : ""
  const dispositivo = data.orden ? safe(data.orden.dispositivo) : ""
  const pendiente = data.total - (data.montoAbonado || 0)

  // Crear documento PDF
  const pdfDoc = await PDFLib.create()
  let page = pdfDoc.addPage([595, 842]) // A4 — reassigned by startContinuationPage() below
  const { width, height } = page.getSize()

  const { regular: helvetica, bold: helveticaBold } = await embedCustomFonts(pdfDoc)

  const margin = 40
  const contentWidth = width - (margin * 2)

  let y = height - margin - 20

  // === LOGO ===
  let logoWidth = 0
  if (data.logoUrl) {
    try {
      const logoResponse = await fetch(data.logoUrl)
      if (logoResponse.ok) {
        const logoArrayBuffer = await logoResponse.arrayBuffer()
        const logoBytes = new Uint8Array(logoArrayBuffer)

        let logoImage
        const contentType = logoResponse.headers.get("content-type") || ""

        if (contentType.includes("png") || data.logoUrl.toLowerCase().includes(".png")) {
          logoImage = await pdfDoc.embedPng(logoBytes)
        } else if (contentType.includes("jpeg") || contentType.includes("jpg") || data.logoUrl.toLowerCase().includes(".jpg") || data.logoUrl.toLowerCase().includes(".jpeg")) {
          logoImage = await pdfDoc.embedJpg(logoBytes)
        }

        if (logoImage) {
          const logoDims = logoImage.scale(1)
          const maxLogoHeight = 50
          const maxLogoWidth = 80
          const scale = Math.min(maxLogoHeight / logoDims.height, maxLogoWidth / logoDims.width)
          const scaledWidth = logoDims.width * scale
          const scaledHeight = logoDims.height * scale

          page.drawImage(logoImage, {
            x: margin,
            y: height - margin - 10 - scaledHeight,
            width: scaledWidth,
            height: scaledHeight,
          })

          logoWidth = scaledWidth + 15
        }
      }
    } catch (logoError) {
      console.error("Error loading logo:", logoError)
    }
  }

  // === HEADER: Empresa ===
  page.drawText(empresaNombre, { x: margin + logoWidth, y, size: 16, font: helveticaBold, color: MONO.ink })
  y -= 16
  if (telefonoEmpresa) {
    page.drawText(`Tel: ${telefonoEmpresa}`, { x: margin + logoWidth, y, size: TYPE.small, font: helvetica, color: MONO.label })
    y -= 12
  }
  if (direccionEmpresa) {
    page.drawText(direccionEmpresa, { x: margin + logoWidth, y, size: TYPE.small, font: helvetica, color: MONO.label })
    y -= 12
  }

  // Bloque REMITO (lado derecho, alineado a la derecha)
  const remitoLabel = "REMITO"
  const remitoLabelWidth = helveticaBold.widthOfTextAtSize(remitoLabel, TYPE.docTitle)
  page.drawText(remitoLabel, {
    x: width - margin - remitoLabelWidth,
    y: height - margin - 12,
    size: TYPE.docTitle,
    font: helveticaBold,
    color: MONO.ink,
  })
  const numeroWidth = helveticaBold.widthOfTextAtSize(numeroFactura, TYPE.docNumber)
  page.drawText(numeroFactura, {
    x: width - margin - numeroWidth,
    y: height - margin - 34,
    size: TYPE.docNumber,
    font: helveticaBold,
    color: MONO.ink,
  })
  const fechaLabel = `Fecha: ${fecha}`
  const fechaLabelWidth = helvetica.widthOfTextAtSize(fechaLabel, TYPE.small)
  page.drawText(fechaLabel, {
    x: width - margin - fechaLabelWidth,
    y: height - margin - 50,
    size: TYPE.small,
    font: helvetica,
    color: MONO.label,
  })

  y = height - margin - 90

  // Linea separadora (reemplaza el titulo centrado "FACTURA")
  drawRule(page, margin, width - margin, y)
  y -= 30

  // === DATOS DEL CLIENTE ===
  const clientBoxHeight = 60
  const clientBlockTop = y
  drawSectionLabel(page, helveticaBold, "CLIENTE", margin + 10, clientBlockTop - 5)
  page.drawText(clienteNombre, { x: margin + 10, y: clientBlockTop - 20, size: TYPE.body, font: helvetica, color: MONO.ink })
  let clientY = clientBlockTop - 33
  if (clienteTelefono) {
    page.drawText(`Tel: ${clienteTelefono}`, { x: margin + 10, y: clientY, size: TYPE.small, font: helvetica, color: MONO.label })
    clientY -= 12
  }
  if (clienteEmail) {
    page.drawText(clienteEmail, { x: margin + 10, y: clientY, size: TYPE.small, font: helvetica, color: MONO.label })
  }

  // === DATOS DE LA ORDEN / VENTA ===
  if (data.venta) {
    drawSectionLabel(page, helveticaBold, "VENTA", margin + contentWidth / 2 + 20, clientBlockTop - 5)
    page.drawText(`Venta: V${String(data.venta.numeroVenta).padStart(4, "0")}`, { x: margin + contentWidth / 2 + 20, y: clientBlockTop - 20, size: TYPE.body, font: helvetica, color: MONO.ink })
  } else {
    drawSectionLabel(page, helveticaBold, "ORDEN DE SERVICIO", margin + contentWidth / 2 + 20, clientBlockTop - 5)
    page.drawText(`Orden: ${ordenDisplay}`, { x: margin + contentWidth / 2 + 20, y: clientBlockTop - 20, size: TYPE.body, font: helvetica, color: MONO.ink })
    page.drawText(`Dispositivo: ${dispositivo}`, { x: margin + contentWidth / 2 + 20, y: clientBlockTop - 33, size: TYPE.small, font: helvetica, color: MONO.label })
  }

  drawRule(page, margin, width - margin, clientBlockTop - clientBoxHeight + 10, { dotted: true })
  y -= clientBoxHeight + 15

  // === TABLA DE ITEMS ===
  // Old facturas may have no items_factura rows (pre-dates this table, or the
  // caller didn't fetch them) — skip the table entirely and keep the
  // aggregate-only layout below, exactly as before this section existed.
  const floorY = margin + 80 // clearance kept above the fixed-position footer

  // Column header rows, factored out because they get re-drawn at the top
  // of every continuation page for their respective table.
  const drawItemsTableHeader = (pg: typeof page, yPos: number) => {
    pg.drawText("DESCRIPCIÓN", { x: margin + 10, y: yPos, size: TYPE.small, font: helveticaBold, color: MONO.label })
    pg.drawText("CANT.", { x: margin + 280, y: yPos, size: TYPE.small, font: helveticaBold, color: MONO.label })
    pg.drawText("PRECIO", { x: margin + 330, y: yPos, size: TYPE.small, font: helveticaBold, color: MONO.label })
    pg.drawText("SUBTOTAL", { x: margin + 410, y: yPos, size: TYPE.small, font: helveticaBold, color: MONO.label })
  }
  const drawPagosTableHeader = (pg: typeof page, yPos: number) => {
    pg.drawText("FECHA", { x: margin + 10, y: yPos, size: TYPE.small, font: helveticaBold, color: MONO.label })
    pg.drawText("MÉTODO", { x: margin + 140, y: yPos, size: TYPE.small, font: helveticaBold, color: MONO.label })
    pg.drawText("REFERENCIA", { x: margin + 280, y: yPos, size: TYPE.small, font: helveticaBold, color: MONO.label })
    pg.drawText("MONTO", { x: width - margin - 90, y: yPos, size: TYPE.small, font: helveticaBold, color: MONO.label })
  }

  // Starts a fresh A4 page for a table (or block) that ran out of room on
  // the current one: draws the "REMITO {numero} — continuación" marker,
  // resets the cursor, and — when given a table header drawer — re-draws
  // that table's column header row so the continued rows stay legible.
  const startContinuationPage = (drawTableHeader?: (pg: typeof page, yPos: number) => void): void => {
    page = pdfDoc.addPage([width, height])
    const contTitle = `REMITO ${numeroFactura} — continuación`
    page.drawText(contTitle, { x: margin, y: height - margin - 12, size: TYPE.docTitle, font: helveticaBold, color: MONO.ink })
    drawRule(page, margin, width - margin, height - margin - 24)
    y = height - margin - 44
    if (drawTableHeader) {
      drawTableHeader(page, y)
      y -= 8
      drawRule(page, margin, width - margin, y)
      y -= 17
    }
  }

  if (data.items && data.items.length > 0) {
    drawSectionLabel(page, helveticaBold, "DETALLE DE ITEMS", margin, y)
    y -= 4
    drawRule(page, margin, width - margin, y)
    y -= 20

    drawItemsTableHeader(page, y)
    y -= 8
    drawRule(page, margin, width - margin, y)
    y -= 17

    // Filas de items — a row that would land below the footer's clearance
    // line now flows onto a fresh continuation page instead of being
    // silently dropped (the old `break` truncated long lists here).
    for (const item of data.items) {
      if (y - 18 < floorY) {
        startContinuationPage(drawItemsTableHeader)
      }

      page.drawText(safe(item.descripcion).substring(0, 40), { x: margin + 10, y, size: TYPE.body, font: helvetica, color: MONO.ink })
      page.drawText(String(item.cantidad), { x: margin + 285, y, size: TYPE.body, font: helvetica, color: MONO.ink })
      page.drawText(formatCurrencyPDF(item.precioUnitario), { x: margin + 330, y, size: TYPE.body, font: helvetica, color: MONO.ink })
      page.drawText(formatCurrencyPDF(item.subtotal), { x: margin + 410, y, size: TYPE.body, font: helvetica, color: MONO.ink })
      y -= 18
      drawRule(page, margin, width - margin, y + 10)
    }

    y -= 15
  }

  // === DETALLE DE MONTOS ===
  // Kept together with ESTADO DE PAGO below: if the combined block doesn't
  // fit above the footer's clearance line, it moves to a continuation page
  // as a unit rather than splitting across the page boundary.
  const detalleOptionalRows =
    (data.iva > 0 ? 1 : 0) +
    (data.descuento && data.descuento > 0 ? 1 : 0) +
    (data.redondeo && data.redondeo !== 0 ? 1 : 0)
  const totalsBlockH = 141 + 18 * detalleOptionalRows // DETALLE + TOTAL + ESTADO DE PAGO
  if (y - totalsBlockH < floorY) {
    startContinuationPage()
  }

  drawSectionLabel(page, helveticaBold, "DETALLE", margin, y)
  y -= 4
  drawRule(page, margin, width - margin, y) // hairline above the label:value block
  y -= 20

  // Subtotal
  page.drawText("Subtotal", { x: margin + 10, y, size: TYPE.body, font: helvetica, color: MONO.label })
  page.drawText(formatCurrencyPDF(data.subtotal), { x: width - margin - 100, y, size: TYPE.body, font: helvetica, color: MONO.ink })
  y -= 18
  drawRule(page, margin, width - margin, y + 10)

  // IVA
  if (data.iva > 0) {
    page.drawText("IVA", { x: margin + 10, y, size: TYPE.body, font: helvetica, color: MONO.label })
    page.drawText(formatCurrencyPDF(data.iva), { x: width - margin - 100, y, size: TYPE.body, font: helvetica, color: MONO.ink })
    y -= 18
    drawRule(page, margin, width - margin, y + 10)
  }

  // Descuento (venta-sourced only; PDF-display only, never recomputed —
  // data.total already has it baked in). No longer red — grayscale only,
  // the "-amount" prefix carries the meaning instead of color.
  if (data.descuento && data.descuento > 0) {
    page.drawText("Descuento", { x: margin + 10, y, size: TYPE.body, font: helvetica, color: MONO.label })
    page.drawText(`-${formatCurrencyPDF(data.descuento)}`, { x: width - margin - 100, y, size: TYPE.body, font: helvetica, color: MONO.ink })
    y -= 18
    drawRule(page, margin, width - margin, y + 10)
  }

  // Redondeo (venta-sourced only; can be positive or negative).
  if (data.redondeo && data.redondeo !== 0) {
    page.drawText("Redondeo", { x: margin + 10, y, size: TYPE.body, font: helvetica, color: MONO.label })
    page.drawText(`${data.redondeo >= 0 ? "+" : ""}${formatCurrencyPDF(data.redondeo)}`, { x: width - margin - 100, y, size: TYPE.body, font: helvetica, color: MONO.ink })
    y -= 18
    drawRule(page, margin, width - margin, y + 10)
  }

  // Linea antes del total
  y -= 5
  drawRule(page, margin, width - margin, y + 5)
  y -= 5

  // Total
  page.drawRectangle({ x: margin, y: y - 8, width: contentWidth, height: 28, color: MONO.totalBg })
  page.drawText("TOTAL", { x: margin + 10, y, size: TYPE.total, font: helveticaBold, color: MONO.ink })
  page.drawText(formatCurrencyPDF(data.total), { x: width - margin - 100, y, size: TYPE.total, font: helveticaBold, color: MONO.ink })
  y -= 35

  // === ESTADO DE PAGO ===
  const estadoLabel = estadoPagoLabels[data.estadoPago] || data.estadoPago

  drawSectionLabel(page, helveticaBold, "ESTADO DE PAGO", margin, y)
  y -= 4
  drawRule(page, margin, width - margin, y)
  y -= 20

  // Badge del estado (contorno, sin relleno — mismo texto que antes)
  const estadoBadge = drawOutlinedBadge(page, helveticaBold, estadoLabel, margin, y + 14)

  // Montos abonado y pendiente al lado
  const montoX = margin + estadoBadge.width + 20
  page.drawText(`Abonado: ${formatCurrencyPDF(data.montoAbonado)}`, { x: montoX, y: y + 3, size: TYPE.body, font: helvetica, color: MONO.ink })
  if (pendiente > 0 && data.estadoPago !== "ANULADA") {
    page.drawText(`Pendiente: ${formatCurrencyPDF(pendiente)}`, { x: montoX + 150, y: y + 3, size: TYPE.body, font: helveticaBold, color: MONO.ink })
  }

  y -= 30

  // === HISTORIAL DE PAGOS ===
  if (data.pagos && data.pagos.length > 0) {
    // Keep the section label + column header together: a dangling header
    // with zero rows below it is worse than starting the whole section on
    // a fresh page.
    const pagosHeaderH = 4 + 20 + 8 + 17
    if (y - pagosHeaderH < floorY) {
      startContinuationPage()
    }

    drawSectionLabel(page, helveticaBold, "HISTORIAL DE PAGOS", margin, y)
    y -= 4
    drawRule(page, margin, width - margin, y)
    y -= 20

    // Header (mismo tratamiento que DETALLE DE ITEMS: sin fill, mayusculas)
    drawPagosTableHeader(page, y)
    y -= 8
    drawRule(page, margin, width - margin, y)
    y -= 17

    // Same continuation treatment as the items table above — long payment
    // histories now flow onto extra pages instead of the old `break`
    // truncation.
    for (const pago of data.pagos) {
      if (y - 18 < floorY) {
        startContinuationPage(drawPagosTableHeader)
      }

      const pagoFecha = formatDatePDF(pago.fecha)
      const pagoMetodo = metodoPagoFacturaLabels[pago.metodoPago] || pago.metodoPago
      const pagoRef = safe(pago.referencia)

      page.drawText(pagoFecha, { x: margin + 10, y, size: TYPE.body, font: helvetica, color: MONO.ink })
      page.drawText(pagoMetodo, { x: margin + 140, y, size: TYPE.body, font: helvetica, color: MONO.ink })
      if (pagoRef) {
        page.drawText(pagoRef.substring(0, 25), { x: margin + 280, y, size: TYPE.body, font: helvetica, color: MONO.label })
      }
      page.drawText(formatCurrencyPDF(pago.monto), { x: width - margin - 90, y, size: TYPE.body, font: helveticaBold, color: MONO.ink })
      y -= 18
      drawRule(page, margin, width - margin, y + 10)
    }
  }

  // === FOOTER ===
  const footerY = margin + 50

  drawRule(page, margin, width - margin, footerY)

  page.drawText("Remito interno — no válido como comprobante fiscal.", { x: margin, y: footerY - 15, size: TYPE.fine, font: helvetica, color: MONO.faint })

  const fechaImpresion = formatDateTimeValue(new Date(), data.zonaHoraria || DEFAULT_TIMEZONE)
  page.drawText(`Impreso: ${fechaImpresion}`, { x: width - margin - 110, y: footerY - 27, size: 7, font: helvetica, color: MONO.faint })

  const pdfBytes = await pdfDoc.save()
  return Buffer.from(pdfBytes)
}

// ========================================
// PDF DEVOLUCION (NOTA DE CREDITO)
// ========================================

interface DevolucionPDFData {
  numeroDevolucion: string
  fecha: Date | string
  ventaNumero: number
  motivo: string
  tipo: string
  observaciones?: string | null
  items: Array<{
    descripcion: string
    cantidad: number
    precioUnitario: number
    subtotal: number
  }>
  montoDevolucion: number
  cliente: {
    nombre: string
    telefono?: string | null
  }
  nombreEmpresa?: string
  telefonoEmpresa?: string | null
  direccionEmpresa?: string | null
  logoUrl?: string | null
  moneda?: string
  zonaHoraria?: string
}

export async function generateDevolucionPDF(data: DevolucionPDFData): Promise<Buffer> {
  const safe = (val: unknown): string => {
    if (val === null || val === undefined) return ""
    if (typeof val === "string") return val.replace(/[\r\n]+/g, " ").trim()
    if (typeof val === "number") return String(val)
    return ""
  }

  const formatDatePDF = (date: Date | string | null | undefined): string => {
    return formatDateValue(date, data.zonaHoraria || DEFAULT_TIMEZONE)
  }

  const formatCurrencyPDF = (amount: number | null | undefined): string => {
    return formatCurrencyValue(amount, (data.moneda as CurrencyCode) || DEFAULT_CURRENCY)
  }

  const pdfDoc = await PDFLib.create()
  const page = pdfDoc.addPage([595, 842])
  const { width, height } = page.getSize()
  const margin = 40
  const contentWidth = width - margin * 2

  const { regular: helvetica, bold: helveticaBold } = await embedCustomFonts(pdfDoc)

  let y = height - margin - 20

  // === HEADER: Empresa ===
  const empresaNombre = safe(data.nombreEmpresa) || "Servicio Técnico"
  page.drawText(empresaNombre, { x: margin, y, size: 16, font: helveticaBold, color: MONO.ink })
  y -= 16

  const telefonoEmpresa = safe(data.telefonoEmpresa)
  const direccionEmpresa = safe(data.direccionEmpresa)
  if (telefonoEmpresa) {
    page.drawText(telefonoEmpresa, { x: margin, y, size: TYPE.small, font: helvetica, color: MONO.label })
    y -= 12
  }
  if (direccionEmpresa) {
    page.drawText(direccionEmpresa, { x: margin, y, size: TYPE.small, font: helvetica, color: MONO.label })
    y -= 12
  }

  // Bloque NOTA DE CRÉDITO (lado derecho, alineado a la derecha, como el remito)
  const notaLabel = "NOTA DE CRÉDITO"
  const notaLabelWidth = helveticaBold.widthOfTextAtSize(notaLabel, TYPE.docTitle)
  page.drawText(notaLabel, {
    x: width - margin - notaLabelWidth,
    y: height - margin - 12,
    size: TYPE.docTitle,
    font: helveticaBold,
    color: MONO.ink,
  })
  const numeroWidth = helveticaBold.widthOfTextAtSize(data.numeroDevolucion, TYPE.docNumber)
  page.drawText(data.numeroDevolucion, {
    x: width - margin - numeroWidth,
    y: height - margin - 34,
    size: TYPE.docNumber,
    font: helveticaBold,
    color: MONO.ink,
  })
  const fechaLabel = `Fecha: ${formatDatePDF(data.fecha)}`
  const fechaLabelWidth = helvetica.widthOfTextAtSize(fechaLabel, TYPE.small)
  page.drawText(fechaLabel, {
    x: width - margin - fechaLabelWidth,
    y: height - margin - 50,
    size: TYPE.small,
    font: helvetica,
    color: MONO.label,
  })

  y = height - margin - 90

  // Separator
  drawRule(page, margin, width - margin, y)
  y -= 25

  // Info section
  const col1X = margin
  const col2X = width / 2 + 20

  drawSectionLabel(page, helveticaBold, "CLIENTE", col1X, y)
  drawSectionLabel(page, helveticaBold, "REFERENCIA", col2X, y)
  y -= 14

  const clienteNombre = safe(data.cliente?.nombre) || "Consumidor Final"
  page.drawText(clienteNombre, { x: col1X, y, size: TYPE.body, font: helvetica, color: MONO.ink })
  page.drawText(`Venta V${String(data.ventaNumero).padStart(4, "0")}`, { x: col2X, y, size: TYPE.body, font: helvetica, color: MONO.ink })
  y -= 13

  if (data.cliente?.telefono) {
    page.drawText(safe(data.cliente.telefono), { x: col1X, y, size: TYPE.small, font: helvetica, color: MONO.label })
  }
  page.drawText(`Tipo: ${safe(data.tipo)}`, { x: col2X, y, size: TYPE.small, font: helvetica, color: MONO.label })
  y -= 13
  page.drawText(`Motivo: ${safe(data.motivo)}`, { x: col2X, y, size: TYPE.small, font: helvetica, color: MONO.label })

  y -= 25

  // Items table (sin fill, mayusculas, MONO.label, hairlines)
  const colWidths = [contentWidth * 0.5, contentWidth * 0.15, contentWidth * 0.15, contentWidth * 0.2]
  const colX = [margin + 8, margin + colWidths[0], margin + colWidths[0] + colWidths[1], margin + colWidths[0] + colWidths[1] + colWidths[2]]

  page.drawText("PRODUCTO", { x: colX[0], y, size: TYPE.small, font: helveticaBold, color: MONO.label })
  page.drawText("CANT.", { x: colX[1] + 10, y, size: TYPE.small, font: helveticaBold, color: MONO.label })
  page.drawText("PRECIO", { x: colX[2] + 5, y, size: TYPE.small, font: helveticaBold, color: MONO.label })
  page.drawText("SUBTOTAL", { x: colX[3] + 5, y, size: TYPE.small, font: helveticaBold, color: MONO.label })
  y -= 8
  drawRule(page, margin, width - margin, y)
  y -= 17

  // Items rows
  for (const item of data.items) {
    const desc = safe(item.descripcion).substring(0, 45)
    page.drawText(desc, { x: colX[0], y, size: TYPE.body, font: helvetica, color: MONO.ink })
    page.drawText(String(item.cantidad), { x: colX[1] + 15, y, size: TYPE.body, font: helvetica, color: MONO.ink })
    page.drawText(formatCurrencyPDF(item.precioUnitario), { x: colX[2] + 5, y, size: TYPE.body, font: helvetica, color: MONO.ink })
    page.drawText(formatCurrencyPDF(item.subtotal), { x: colX[3] + 5, y, size: TYPE.body, font: helveticaBold, color: MONO.ink })
    y -= 18
    drawRule(page, margin, width - margin, y + 10)
  }

  y -= 15

  // Total (barra MONO.totalBg)
  page.drawRectangle({ x: margin, y: y - 8, width: contentWidth, height: 28, color: MONO.totalBg })
  page.drawText("TOTAL DEVOLUCIÓN:", { x: margin + 10, y, size: TYPE.total, font: helveticaBold, color: MONO.ink })
  const totalText = formatCurrencyPDF(data.montoDevolucion)
  const totalTextW = helveticaBold.widthOfTextAtSize(totalText, TYPE.total)
  page.drawText(totalText, { x: width - margin - 10 - totalTextW, y, size: TYPE.total, font: helveticaBold, color: MONO.ink })

  y -= 35

  // Observaciones
  if (data.observaciones) {
    y -= 15
    page.drawText("Observaciones:", { x: margin, y, size: TYPE.small, font: helveticaBold, color: MONO.label })
    y -= 13
    page.drawText(safe(data.observaciones).substring(0, 120), { x: margin, y, size: TYPE.body, font: helvetica, color: MONO.ink })
  }

  // Footer
  const footerY = 40
  drawRule(page, margin, width - margin, footerY + 10)
  page.drawText("Este documento es una nota de crédito válida.", { x: margin, y: footerY - 5, size: TYPE.fine, font: helvetica, color: MONO.faint })

  const fechaImpresion = formatDateTimeValue(new Date(), data.zonaHoraria || DEFAULT_TIMEZONE)
  page.drawText(`Impreso: ${fechaImpresion}`, { x: width - margin - 110, y: footerY - 5, size: 7, font: helvetica, color: MONO.faint })

  const pdfBytes = await pdfDoc.save()
  return Buffer.from(pdfBytes)
}

export type { CotizacionPDFData, CotizacionItem, OrdenPDFData, VentaPDFData, VentaItem, GarantiaVentaPDFData, ComprobanteEntregaPDFData, FacturaPDFData, FacturaPago, DevolucionPDFData }
