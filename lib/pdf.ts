import { PDFDocument as PDFLib, rgb, type PDFFont, type RGB } from "pdf-lib"
import fontkitModule from "@pdf-lib/fontkit"
import { readFile } from "fs/promises"
import { join } from "path"
import { formatCurrencyValue, type CurrencyCode, DEFAULT_CURRENCY } from "@/lib/currency"
import { formatDateValue, formatDateTimeValue, getZonedParts, DEFAULT_TIMEZONE } from "@/lib/timezone"
import { parseRecepcionTerminos } from "@/lib/terminos"
import QRCode from "qrcode"
import { resolveTerminologia, t, type Terminologia } from "@/lib/terminologia"
import { MONO, TYPE, RULE_WIDTH, drawRule, drawSectionLabel, drawOutlinedBadge, measureBadgeWidth } from "@/lib/pdf-style"
import { ESTADO_FLOW, ESTADOS_COMPLETADOS, MOTIVO_SIN_COBRO_LABELS, type MotivoSinCobro } from "@/lib/seguimiento-state"

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
// FUENTES DEL EXPEDIENTE (orden expediente redesign)
// ========================================
// Loader separado de loadFonts/embedCustomFonts (Inter) para no tocar el
// path de las demás generadoras de PDF. Todas son TTF estáticas (SIL OFL,
// sin tabla `fvar`): pdf-lib/fontkit no aplica ejes de variación, así que
// una variable font solo renderiza en su instancia default — inaceptable
// para Archivo Condensed, que necesita el peso Bold/Black reales.
let expedienteFontCache: {
  archivoRegular: Buffer
  archivoBold: Buffer
  archivoBlack: Buffer
  archivoCondensedBold: Buffer
  archivoCondensedBlack: Buffer
  plexMonoRegular: Buffer
} | null = null

async function loadExpedienteFonts() {
  if (expedienteFontCache) return expedienteFontCache
  const fontsDir = join(process.cwd(), "lib", "fonts")
  const [
    archivoRegular,
    archivoBold,
    archivoBlack,
    archivoCondensedBold,
    archivoCondensedBlack,
    plexMonoRegular,
  ] = await Promise.all([
    readFile(join(fontsDir, "Archivo-Regular.ttf")),
    readFile(join(fontsDir, "Archivo-Bold.ttf")),
    readFile(join(fontsDir, "Archivo-Black.ttf")),
    readFile(join(fontsDir, "ArchivoCondensed-Bold.ttf")),
    readFile(join(fontsDir, "ArchivoCondensed-Black.ttf")),
    readFile(join(fontsDir, "IBMPlexMono-Regular.ttf")),
  ])
  expedienteFontCache = {
    archivoRegular,
    archivoBold,
    archivoBlack,
    archivoCondensedBold,
    archivoCondensedBlack,
    plexMonoRegular,
  }
  return expedienteFontCache
}

export async function embedExpedienteFonts(pdfDoc: PDFLib) {
  pdfDoc.registerFontkit(fontkit)
  const fonts = await loadExpedienteFonts()
  const [
    archivoRegular,
    archivoBold,
    archivoBlack,
    archivoCondensedBold,
    archivoCondensedBlack,
    plexMonoRegular,
  ] = await Promise.all([
    pdfDoc.embedFont(fonts.archivoRegular, { subset: true }),
    pdfDoc.embedFont(fonts.archivoBold, { subset: true }),
    pdfDoc.embedFont(fonts.archivoBlack, { subset: true }),
    pdfDoc.embedFont(fonts.archivoCondensedBold, { subset: true }),
    pdfDoc.embedFont(fonts.archivoCondensedBlack, { subset: true }),
    pdfDoc.embedFont(fonts.plexMonoRegular, { subset: true }),
  ])
  return {
    archivoRegular,
    archivoBold,
    archivoBlack,
    archivoCondensedBold,
    archivoCondensedBlack,
    plexMonoRegular,
  }
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
    dni?: string | null
    cuit?: string | null
    razonSocial?: string | null
    tipoCliente?: string | null
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
  checklistItems?: Array<{ label: string; valor: boolean | string | null; categoria?: string | null }> | null
  checklistNotas?: string | null
  firmaRecepcion?: string | null
  firmaRecepcionMime?: string | null
  fotosIngreso?: Array<{ url: string; descripcion?: string | null }> | null
  terminologia?: Terminologia
  // Data layer for the orden expediente redesign (Task D2). Consumed by the
  // ENTREGA/RECEPCIÓN sheet drawing code (Tasks D3/D4) — this task only feeds
  // the contract, it draws nothing.
  codigoOrden?: string | null
  diagnostico?: string | null
  costoFinal?: number | null
  totalCobrado?: number | null
  estadoCobro?: string | null
  descuentoCobro?: number | null
  motivoSinCobro?: string | null
  telefonoContacto?: string | null
  /** Flattened from `metadata` JSONB via the tipo de dispositivo's `config.camposExtra`. */
  metadataCampos?: Array<{ label: string; valor: string }> | null
  esReingreso?: boolean
  ordenOrigenNumero?: number | null
  fechaCompletado?: Date | null
  emailEmpresa?: string | null
  sucursal?: { nombre: string; direccion?: string | null; telefono?: string | null } | null
  tecnicoNombre?: string | null
  recibidoPorNombre?: string | null
  /** repuestos_orden — precio de VENTA únicamente, nunca costo. */
  trabajos?: Array<{ nombre: string; cantidad: number; importe: number }> | null
  garantia?: { dias: number; fechaVencimiento: Date; notas?: string | null } | null
  /** cobros_orden no anulados. */
  cobros?: Array<{ fecha: Date; metodo: string; referencia?: string | null; monto: number }> | null
  /** orden_tiempos_estado: primera ocurrencia de cada estado, ordenado por inicio. */
  timeline?: Array<{ estado: string; fecha: Date }> | null
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
  const numeroOrden = safe(data.numeroOrden)
  const fechaIngreso = formatDatePDF(data.fechaIngreso)
  const fechaPrometida = formatDatePDF(data.fechaPrometida)

  const cliente = data.cliente || { nombre: "", telefono: "", email: null, direccion: null }
  const clienteNombre = safe(cliente.nombre) || "Sin nombre"
  const clienteTelefono = safe(cliente.telefono) || "Sin teléfono"
  const clienteEmail = safe(cliente.email)

  const dispositivo = safe(data.dispositivo) || "Sin especificar"
  const marca = safe(data.marca)
  const colorDisp = safe(data.color)
  const imei = safe(data.imei)
  const problemaReportado = safe(data.problemaReportado) || "Sin descripcion"
  const accesorios = safe(data.accesorios)
  const codigoAccesoDispositivo = safe(data.codigoAccesoDispositivo)
  const presupuesto = data.presupuesto ? formatCurrencyPDF(data.presupuesto) : ""

  // Fecha y hora de impresion
  const fechaImpresion = formatDateTimeValue(new Date(), data.zonaHoraria || DEFAULT_TIMEZONE)

  // Crear documento PDF — hoja RECEPCIÓN (expediente): parte cliente arriba,
  // línea de corte, talón interno del negocio abajo — todo en UNA página A4.
  // Fuente del diseño: .tmp-preview/mockups/orden-maximal.html, Hoja 2 (.sheet.rx).
  // Reemplaza el viejo par "copia cliente" + "copia local" + su merge vía
  // embedPages (ver git history de Task D3) por dibujo directo de ambas
  // zonas en la misma página — ya no hace falta escalar/incrustar.
  const pdfDoc = await PDFLib.create()
  const page = pdfDoc.addPage([595, 842]) // A4
  const { width, height } = page.getSize()

  // Fuentes Inter — solo las usan hoy las páginas de fotos/entrega más abajo
  // (D4 rediseña la hoja ENTREGA; hasta entonces ese tramo queda intacto).
  const { regular: helvetica, bold: helveticaBold } = await embedCustomFonts(pdfDoc)
  // Fuentes del expediente (Archivo + Plex Mono) — Task D1.
  const {
    archivoRegular,
    archivoBold,
    archivoBlack,
    archivoCondensedBold,
    archivoCondensedBlack,
    plexMonoRegular,
  } = await embedExpedienteFonts(pdfDoc)

  const margin = 40 // preservado: lo siguen usando las páginas de fotos/entrega
  const contentWidth = width - (margin * 2)
  const tz = data.zonaHoraria || DEFAULT_TIMEZONE

  // ---- Datos del expediente (Task D2) que esta hoja consume ----
  const codigoOrden = safe(data.codigoOrden)
  const recibidoPorNombre = safe(data.recibidoPorNombre)
  const tecnicoNombre = safe(data.tecnicoNombre)
  const telefonoContacto = safe(data.telefonoContacto)
  const sucursalNombre = data.sucursal ? safe(data.sucursal.nombre) : ""
  const sucursalDireccion = data.sucursal ? safe(data.sucursal.direccion) : ""
  const sucursalTelefono = data.sucursal ? safe(data.sucursal.telefono) : ""
  const clienteDni = safe(cliente.dni)
  const clienteCuit = safe(cliente.cuit)
  const clienteRazonSocial = safe(cliente.razonSocial)
  const clienteTipoCliente = safe(cliente.tipoCliente)
  const metadataCampos = Array.isArray(data.metadataCampos) ? data.metadataCampos : []
  const timelineRaw = Array.isArray(data.timeline) ? data.timeline : []
  const numeroOrdenPadded = `#${String(numeroOrden).padStart(4, "0")}`
  const estadoRaw = safe(data.estado).toUpperCase()
  const estadoDisplay = (estadoRaw || "RECIBIDO").replace(/_/g, " ")

  // ---- Helpers locales de esta hoja ----
  const rxMargin = 28 // ~10mm, como el mockup
  const rxContentW = width - rxMargin * 2

  const rxWrap = (text: string, font: PDFFont, size: number, maxWidth: number): string[] => {
    const lines: string[] = []
    let line = ""
    for (const word of text.split(" ")) {
      const testLine = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(testLine, size) <= maxWidth) {
        line = testLine
      } else {
        if (line) lines.push(line)
        line = word
      }
    }
    if (line) lines.push(line)
    return lines
  }

  const rxTruncate = (text: string, font: PDFFont, size: number, maxWidth: number): string => {
    if (font.widthOfTextAtSize(text, size) <= maxWidth) return text
    let t2 = text
    while (t2.length > 0 && font.widthOfTextAtSize(t2 + "…", size) > maxWidth) t2 = t2.slice(0, -1)
    return t2 + "…"
  }

  const rxDrawRight = (pg: typeof page, text: string, xRight: number, y: number, size: number, font: PDFFont, color: RGB) => {
    const w = font.widthOfTextAtSize(text, size)
    pg.drawText(text, { x: xRight - w, y, size, font, color })
  }

  // Corre varios segmentos (texto+fuente propios, p.ej. un prefijo en negrita
  // seguido de texto regular) sobre UNA misma línea de base. Cada segmento
  // sigue siendo un string completo en su propio drawText — no se trocea
  // ningún string individual entre llamadas.
  const rxDrawRun = (pg: typeof page, segments: Array<{ text: string; font: PDFFont; color?: RGB }>, x: number, y: number, size: number): number => {
    let cx = x
    for (const seg of segments) {
      if (!seg.text) continue
      pg.drawText(seg.text, { x: cx, y, size, font: seg.font, color: seg.color ?? MONO.ink })
      cx += seg.font.widthOfTextAtSize(seg.text, size)
    }
    return cx - x
  }

  // Nota: NO usar Intl.DateTimeFormat con { day: "2-digit", month: "2-digit",
  // hour: "2-digit", minute: "2-digit" } sin year — en builds Node con
  // small-icu (Windows dev) esa combinación pierde el cero a la izquierda del
  // mes y cae a reloj de 12 hs pese al locale es-AR (confirmado en este
  // entorno: ICU 78.3 → "12/8, 01:16 p. m." en vez de "12/08 14:32"). Se
  // arma el string a mano con getZonedParts (ya DST-safe, mismo helper que
  // usa el resto de lib/timezone.ts) para no depender de esa resolución.
  const pad2 = (n: number): string => String(n).padStart(2, "0")
  const formatTimelineDate = (d: Date): string => {
    if (Number.isNaN(d.getTime())) return ""
    const { day, month, hour, minute } = getZonedParts(d, tz)
    return `${pad2(day)}/${pad2(month)} ${pad2(hour)}:${pad2(minute)}`
  }

  // Excepción LOCAL de esta hoja (ver Global Constraints de Task D3): un
  // relleno sólido MONO.ink + texto blanco, normalmente reservado a
  // MONO.totalBg. Solo se usa para el tag de estado, el paso activo del
  // timeline y la celda de saldo del money3 — nada más en este archivo.
  const rxInkFill = (pg: typeof page, x: number, y: number, w: number, h: number) => {
    pg.drawRectangle({ x, y, width: w, height: h, color: MONO.ink })
  }

  // Íconos dibujados a mano (líneas/círculos), NO como glifo de texto: Archivo
  // Bold no trae los glifos ✓ (U+2713) ni ✂ (U+2702) en el subset embebido —
  // pdf-lib los sustituye por .notdef (un tofu ☐), confirmado al rasterizar
  // el sample. Un ícono vectorial es inmune a la cobertura de la fuente.
  const rxDrawCheck = (pg: typeof page, x: number, y: number, color: RGB) => {
    pg.drawLine({ start: { x, y: y + 1.6 }, end: { x: x + 1.5, y: y - 0.6 }, thickness: 0.9, color })
    pg.drawLine({ start: { x: x + 1.5, y: y - 0.6 }, end: { x: x + 4.2, y: y + 3.2 }, thickness: 0.9, color })
  }
  const rxDrawScissors = (pg: typeof page, x: number, y: number, color: RGB) => {
    const pivotX = x + 7
    pg.drawLine({ start: { x: pivotX, y }, end: { x: pivotX + 4, y }, thickness: 0.9, color })
    pg.drawLine({ start: { x: pivotX, y }, end: { x, y: y + 3 }, thickness: 0.9, color })
    pg.drawLine({ start: { x: pivotX, y }, end: { x, y: y - 3 }, thickness: 0.9, color })
    pg.drawCircle({ x, y: y + 3, size: 1.5, borderColor: color, borderWidth: 0.8 })
    pg.drawCircle({ x, y: y - 3, size: 1.5, borderColor: color, borderWidth: 0.8 })
  }

  // Grilla de celdas con borde (replica el `.grid`/`.cell` del mockup: borde
  // fino MONO.rule alrededor + separador entre columnas). La altura de la
  // fila la define el contenido más alto entre las celdas pasadas.
  type RxCellLine = { text: string; font: PDFFont; size: number; color: RGB }
  type RxCell = { x: number; width: number; label: string; lines: RxCellLine[] }
  const rxCellPadX = 8
  const rxCellPadY = 7
  const rxDrawGridRow = (cells: RxCell[], topY: number): number => {
    let maxContentH = 0
    for (const cell of cells) {
      const h = 12 + cell.lines.length * 10
      if (h > maxContentH) maxContentH = h
    }
    const rowH = maxContentH + rxCellPadY * 2
    page.drawRectangle({ x: rxMargin, y: topY - rowH, width: rxContentW, height: rowH, borderColor: MONO.rule, borderWidth: RULE_WIDTH })
    for (let i = 1; i < cells.length; i++) {
      page.drawLine({ start: { x: cells[i].x, y: topY }, end: { x: cells[i].x, y: topY - rowH }, thickness: RULE_WIDTH, color: MONO.rule })
    }
    for (const cell of cells) {
      drawSectionLabel(page, archivoBold, cell.label, cell.x + rxCellPadX, topY - rxCellPadY - 6)
      let cy = topY - rxCellPadY - 6 - 12
      for (const line of cell.lines) {
        page.drawText(line.text, { x: cell.x + rxCellPadX, y: cy, size: line.size, font: line.font, color: line.color })
        cy -= 10
      }
    }
    return rowH
  }

  // ============================================================
  // TIMELINE: 7 pasos canónicos, reutilizando el mismo flujo/orden que ya
  // usa la vista pública de seguimiento (lib/seguimiento-state.ts) para que
  // el PDF y esa pantalla nunca queden desincronizados.
  // ============================================================
  const TIMELINE_LABELS = ["Recibido", "Diagnóstico", "Presupuestado", "Aprobado", "En reparación", "Reparado", "Entregado"]
  const foldEstado = (raw: string): string => (raw === "ESPERANDO_REPUESTO" ? "EN_REPARACION" : raw)

  const stepDates: Array<Date | null> = ESTADO_FLOW.map(() => null)
  for (const entry of timelineRaw) {
    const mapped = foldEstado(safe(entry?.estado).toUpperCase())
    const idx = ESTADO_FLOW.indexOf(mapped as (typeof ESTADO_FLOW)[number])
    if (idx < 0) continue
    const fecha = entry.fecha instanceof Date ? entry.fecha : new Date(entry.fecha as unknown as string)
    if (Number.isNaN(fecha.getTime())) continue
    if (!stepDates[idx] || fecha < (stepDates[idx] as Date)) stepDates[idx] = fecha
  }

  // Estados sin paso lineal (CANCELADO, SIN_REPARACION, SIN_FALLA_DETECTADA,
  // ENTREGADO_SIN_REPARACION, ENTREGADO_SIN_COBRO, o vacío/desconocido): se
  // marcan sobre el paso canónico más cercano ya alcanzado según el
  // timeline (o el paso 0 si no hay ninguno), en vez de perderse.
  const estadoNormFolded = foldEstado(estadoRaw)
  const canonicalIdx = ESTADO_FLOW.indexOf(estadoNormFolded as (typeof ESTADO_FLOW)[number])
  let currentStepIndex = 0
  let nonCanonicalTag = ""
  if (canonicalIdx >= 0) {
    currentStepIndex = canonicalIdx
  } else {
    for (let i = ESTADO_FLOW.length - 1; i >= 0; i--) {
      if (stepDates[i]) { currentStepIndex = i; break }
    }
    nonCanonicalTag = estadoDisplay
  }

  // Sheet selection (Task D4): terminal delivery estados print the full
  // ENTREGA expediente sheet (client-facing, one page, no cut line, no
  // stub, access code never rendered) instead of the RECEPCIÓN sheet below.
  const isEntregaSheet = ESTADOS_COMPLETADOS.has(estadoRaw)

  if (isEntregaSheet) {
    // ============================================================
    // HOJA ENTREGA — expediente completo (Task D4)
    // ============================================================
    // Reemplaza, para ENTREGADO/ENTREGADO_SIN_REPARACION/ENTREGADO_SIN_COBRO,
    // la hoja RECEPCIÓN de más abajo: un único documento client-facing (sin
    // corte, sin talón interno, sin código de acceso) — el legajo completo
    // que se entrega al cliente al cerrar la orden. Fuente del diseño:
    // .tmp-preview/mockups/orden-maximal.html, Hoja 1.
    let ey = height - rxMargin

    // ---- Header: logo + empresa/sucursal + idbox (#numero, código, tag de
    // estado ink-fill, línea de reingreso) ----
    const headerTopY = ey
    const logoBoxSize = 42

    let enLogo: Awaited<ReturnType<typeof pdfDoc.embedPng>> | Awaited<ReturnType<typeof pdfDoc.embedJpg>> | null = null
    if (data.logoUrl) {
      try {
        const res = await fetch(data.logoUrl)
        if (res.ok) {
          const buf = new Uint8Array(await res.arrayBuffer())
          const ct = res.headers.get("content-type") || ""
          if (ct.includes("png") || data.logoUrl.toLowerCase().includes(".png")) {
            enLogo = await pdfDoc.embedPng(buf)
          } else if (ct.includes("jpeg") || ct.includes("jpg") || data.logoUrl.toLowerCase().includes(".jpg") || data.logoUrl.toLowerCase().includes(".jpeg")) {
            enLogo = await pdfDoc.embedJpg(buf)
          }
        }
      } catch { /* logo no disponible — se omite, sin placeholder */ }
    }
    if (enLogo) {
      page.drawRectangle({ x: rxMargin, y: headerTopY - logoBoxSize, width: logoBoxSize, height: logoBoxSize, borderColor: MONO.ink, borderWidth: 1 })
      const s = enLogo.scale(1)
      const inset = 5
      const ratio = Math.min((logoBoxSize - inset * 2) / s.width, (logoBoxSize - inset * 2) / s.height)
      const lw = s.width * ratio
      const lh = s.height * ratio
      page.drawImage(enLogo, { x: rxMargin + (logoBoxSize - lw) / 2, y: headerTopY - logoBoxSize + (logoBoxSize - lh) / 2, width: lw, height: lh })
    }

    const bizX = rxMargin + (enLogo ? logoBoxSize + 12 : 0)

    const reingresoLabelEn = data.esReingreso && data.ordenOrigenNumero
      ? `Reingreso de #${String(data.ordenOrigenNumero).padStart(4, "0")}`
      : ""

    const numSizeEn = 20
    const numWEn = archivoCondensedBlack.widthOfTextAtSize(numeroOrdenPadded, numSizeEn)
    const codeWEn = codigoOrden ? plexMonoRegular.widthOfTextAtSize(codigoOrden, 8) : 0
    const tagLabelEn = estadoDisplay.toUpperCase()
    const tagWEn = archivoBold.widthOfTextAtSize(tagLabelEn, 7) + 10
    const reingresoWEn = reingresoLabelEn ? archivoRegular.widthOfTextAtSize(reingresoLabelEn, 7.5) : 0
    const idboxReservedEn = Math.max(numWEn, codeWEn, tagWEn, reingresoWEn) + 4
    const bizMaxWidthEn = (width - rxMargin) - idboxReservedEn - 10 - bizX

    const bizNameSizeEn = 13
    page.drawText(rxTruncate(empresaNombre, archivoBlack, bizNameSizeEn, bizMaxWidthEn), { x: bizX, y: headerTopY - 11, size: bizNameSizeEn, font: archivoBlack, color: MONO.ink })
    const contactLineTextEn = [sucursalNombre, sucursalDireccion || direccionEmpresa, sucursalTelefono || telefonoEmpresa, data.emailEmpresa ? safe(data.emailEmpresa) : ""].filter(Boolean).join(" · ")
    const contactLinesEn = rxWrap(contactLineTextEn, archivoRegular, 7.5, bizMaxWidthEn).slice(0, 2)
    let bizYEn = headerTopY - 11 - 14
    for (const l of contactLinesEn) {
      page.drawText(l, { x: bizX, y: bizYEn, size: 7.5, font: archivoRegular, color: MONO.label })
      bizYEn -= 10
    }

    const idboxRightEn = width - rxMargin
    rxDrawRight(page, numeroOrdenPadded, idboxRightEn, headerTopY - 16, numSizeEn, archivoCondensedBlack, MONO.ink)
    let idboxYEn = headerTopY - 27
    if (codigoOrden) {
      rxDrawRight(page, codigoOrden, idboxRightEn, idboxYEn, 8, plexMonoRegular, MONO.label)
      idboxYEn -= 12
    } else {
      idboxYEn -= 4
    }
    // Tag de estado — relleno ink local (excepción de esta hoja, ver Global
    // Constraints Task D3/D4).
    rxInkFill(page, idboxRightEn - tagWEn, idboxYEn - 12, tagWEn, 12)
    page.drawText(tagLabelEn, { x: idboxRightEn - tagWEn + 5, y: idboxYEn - 9, size: 7, font: archivoBold, color: MONO.white })
    idboxYEn -= 12
    if (reingresoLabelEn) {
      rxDrawRight(page, reingresoLabelEn, idboxRightEn, idboxYEn - 9, 7.5, archivoRegular, MONO.label)
      idboxYEn -= 11
    }

    const headerHEn = Math.max(logoBoxSize, 46 + (reingresoLabelEn ? 11 : 0))
    const headerBottomYEn = Math.min(headerTopY - headerHEn, bizYEn, idboxYEn)
    ey = headerBottomYEn - 8
    drawRule(page, rxMargin, width - rxMargin, ey, { color: MONO.ink, thickness: 1.4 })
    ey -= 10

    // ---- Timeline: los 7 pasos, alcanzados con ✓ + fecha, el paso final
    // con relleno ink (mismo mecanismo que la hoja RECEPCIÓN) ----
    const timelineHEn = 24
    const timelineTopEn = ey
    const colWEn = rxContentW / 7
    page.drawRectangle({ x: rxMargin, y: timelineTopEn - timelineHEn, width: rxContentW, height: timelineHEn, borderColor: MONO.ink, borderWidth: 1 })
    for (let i = 0; i < 7; i++) {
      const colX = rxMargin + i * colWEn
      const isOn = i === currentStepIndex
      const isDone = i < currentStepIndex && !!stepDates[i]
      if (isOn) rxInkFill(page, colX, timelineTopEn - timelineHEn, colWEn, timelineHEn)
      if (i > 0) {
        page.drawLine({ start: { x: colX, y: timelineTopEn }, end: { x: colX, y: timelineTopEn - timelineHEn }, thickness: RULE_WIDTH, color: isOn ? MONO.ink : MONO.rule })
      }
      const labelColor = isOn ? MONO.white : (isDone ? MONO.ink : MONO.faint)
      const dateColor = isOn ? MONO.white : (isDone ? MONO.label : MONO.faint)
      const stepLabelSize = 6
      const checkW = isDone ? 6 : 0
      const stepLabelTrunc = rxTruncate(TIMELINE_LABELS[i].toUpperCase(), archivoBold, stepLabelSize, colWEn - 4 - checkW)
      const labelW = archivoBold.widthOfTextAtSize(stepLabelTrunc, stepLabelSize)
      const blockX = colX + (colWEn - (labelW + checkW)) / 2
      if (isDone) rxDrawCheck(page, blockX, timelineTopEn - 8.7, labelColor)
      page.drawText(stepLabelTrunc, { x: blockX + checkW, y: timelineTopEn - 10, size: stepLabelSize, font: archivoBold, color: labelColor })
      let dateText = "—"
      if (isOn && nonCanonicalTag) {
        dateText = rxTruncate(nonCanonicalTag, archivoRegular, 6, colWEn - 4)
      } else if (stepDates[i]) {
        dateText = formatTimelineDate(stepDates[i] as Date)
      }
      const dateW = archivoRegular.widthOfTextAtSize(dateText, 6)
      page.drawText(dateText, { x: colX + (colWEn - dateW) / 2, y: timelineTopEn - 19, size: 6, font: archivoRegular, color: dateColor })
    }
    ey = timelineTopEn - timelineHEn - 10

    // ---- Grid: Cliente | Equipo ----
    const colGridWEn = rxContentW / 2
    const isEmpresaEn = clienteTipoCliente.toUpperCase() === "EMPRESA" && !!clienteRazonSocial
    const clienteLinesEn: RxCellLine[] = []
    if (isEmpresaEn) {
      const idSuffix = clienteCuit ? ` · CUIT ${clienteCuit}` : ""
      clienteLinesEn.push({ text: `${clienteRazonSocial}${idSuffix}`.substring(0, 60), font: archivoBold, size: 9, color: MONO.ink })
      const contactSuffix = clienteDni ? ` · DNI ${clienteDni}` : ""
      clienteLinesEn.push({ text: `Contacto: ${clienteNombre}${contactSuffix}`.substring(0, 60), font: archivoRegular, size: 8, color: MONO.label })
    } else {
      const idSuffix = clienteDni ? ` · DNI ${clienteDni}` : (clienteCuit ? ` · CUIT ${clienteCuit}` : "")
      clienteLinesEn.push({ text: `${clienteNombre}${idSuffix}`.substring(0, 60), font: archivoBold, size: 9, color: MONO.ink })
    }
    const telPartsEn = [clienteTelefono]
    if (telefonoContacto && telefonoContacto !== clienteTelefono) telPartsEn.push(`tel. de esta orden: ${telefonoContacto}`)
    clienteLinesEn.push({ text: telPartsEn.join(" · ").substring(0, 65), font: archivoRegular, size: 8, color: MONO.label })
    if (clienteEmail) clienteLinesEn.push({ text: clienteEmail.substring(0, 50), font: archivoRegular, size: 8, color: MONO.label })

    const equipoLinesEn: RxCellLine[] = []
    const equipoTitleEn = [dispositivo, marca, colorDisp].filter(Boolean).join(" · ")
    equipoLinesEn.push({ text: equipoTitleEn.substring(0, 55), font: archivoBold, size: 9, color: MONO.ink })
    if (imei) equipoLinesEn.push({ text: `${t(term, "serie")} ${imei}`.substring(0, 55), font: plexMonoRegular, size: 8, color: MONO.ink })
    if (metadataCampos.length > 0) {
      const metaText = metadataCampos.map(m => `${m.label}: ${m.valor}`).join(" · ")
      equipoLinesEn.push({ text: metaText.substring(0, 65), font: archivoRegular, size: 7.5, color: MONO.label })
    }

    const rowClienteEquipoEn = rxDrawGridRow([
      { x: rxMargin, width: colGridWEn, label: "Cliente", lines: clienteLinesEn },
      { x: rxMargin + colGridWEn, width: colGridWEn, label: t(term, "equipo"), lines: equipoLinesEn },
    ], ey)
    ey -= rowClienteEquipoEn

    // ---- Falla declarada | Diagnóstico técnico (lado a lado) ----
    const fallaLinesEn: RxCellLine[] = rxWrap(problemaReportado, archivoRegular, 9, colGridWEn - rxCellPadX * 2)
      .slice(0, 3)
      .map(l => ({ text: l, font: archivoRegular, size: 9, color: MONO.ink }))
    const diagnosticoTextEn = safe(data.diagnostico)
    const diagnosticoLinesEn: RxCellLine[] = diagnosticoTextEn
      ? rxWrap(diagnosticoTextEn, archivoRegular, 9, colGridWEn - rxCellPadX * 2).slice(0, 3).map(l => ({ text: l, font: archivoRegular, size: 9, color: MONO.ink }))
      : [{ text: "—", font: archivoRegular, size: 9, color: MONO.faint }]
    const rowFallaDiagEn = rxDrawGridRow([
      { x: rxMargin, width: colGridWEn, label: "Falla declarada", lines: fallaLinesEn },
      { x: rxMargin + colGridWEn, width: colGridWEn, label: "Diagnóstico técnico", lines: diagnosticoLinesEn },
    ], ey)
    ey -= rowFallaDiagEn

    // ---- Accesorios recibidos | Fotos — el código de acceso NUNCA se
    // dibuja en esta hoja (es client-facing; ver Global Constraints D4) ----
    const accesoriosLinesEn: RxCellLine[] = accesorios
      ? [{ text: accesorios.substring(0, 70), font: archivoRegular, size: 9, color: MONO.ink }]
      : [{ text: "—", font: archivoRegular, size: 9, color: MONO.faint }]
    const fotosCountEn = Array.isArray(data.fotosIngreso) ? data.fotosIngreso.length : 0
    // La capa de datos (Task D2) solo expone fotosIngreso — no hay conteo
    // separado de fotos de reparación/entrega todavía. Se muestra lo que
    // existe (decisión documentada en task-D4-report.md).
    const fotosTextEn = fotosCountEn > 0 ? `${fotosCountEn} de ingreso` : "Sin fotos"
    const accWEn = rxContentW * 0.7
    const rowAccFotosEn = rxDrawGridRow([
      { x: rxMargin, width: accWEn, label: "Accesorios recibidos", lines: accesoriosLinesEn },
      { x: rxMargin + accWEn, width: rxContentW - accWEn, label: "Fotos", lines: [{ text: fotosTextEn, font: archivoRegular, size: 9, color: fotosCountEn > 0 ? MONO.ink : MONO.faint }] },
    ], ey)
    ey -= rowAccFotosEn + 8

    // ---- Mid split: TRABAJO REALIZADO + totales (58%) | Pagos + Chequeo (42%) ----
    const midGapEn = 8
    const midLeftWEn = (rxContentW - midGapEn) * 0.58
    const midRightWEn = (rxContentW - midGapEn) * 0.42
    const midLeftXEn = rxMargin
    const midRightXEn = rxMargin + midLeftWEn + midGapEn
    const midTopYEn = ey

    // LEFT — trabajo realizado (tabla + totales)
    let ly = midTopYEn
    drawSectionLabel(page, archivoBold, "Trabajo realizado — repuestos y mano de obra", midLeftXEn, ly)
    ly -= 12

    const trabajosAllEn = Array.isArray(data.trabajos) ? data.trabajos.slice(0, 20) : []
    const trabajosShownEn = trabajosAllEn.filter(it => (Number(it.importe) || 0) !== 0)
    const omittedCountEn = trabajosAllEn.length - trabajosShownEn.length
    const qtyColRightEn = midLeftXEn + midLeftWEn * 0.62
    const amtColRightEn = midLeftXEn + midLeftWEn

    if (trabajosAllEn.length > 0) {
      page.drawText("DETALLE", { x: midLeftXEn, y: ly, size: 6.8, font: archivoBold, color: MONO.label })
      rxDrawRight(page, "CANT.", qtyColRightEn, ly, 6.8, archivoBold, MONO.label)
      rxDrawRight(page, "IMPORTE", amtColRightEn, ly, 6.8, archivoBold, MONO.label)
      ly -= 4
      drawRule(page, midLeftXEn, midLeftXEn + midLeftWEn, ly, { color: MONO.ink, thickness: 1 })
      ly -= 11
      if (trabajosShownEn.length > 0) {
        const nombreWEn = midLeftWEn * 0.48
        for (const item of trabajosShownEn) {
          page.drawText(rxTruncate(safe(item.nombre) || "—", archivoRegular, 9, nombreWEn), { x: midLeftXEn, y: ly, size: 9, font: archivoRegular, color: MONO.ink })
          rxDrawRight(page, item.cantidad ? String(item.cantidad) : "—", qtyColRightEn, ly, 9, archivoRegular, MONO.label)
          rxDrawRight(page, formatCurrencyPDF(item.importe), amtColRightEn, ly, 8.5, plexMonoRegular, MONO.ink)
          ly -= 4
          drawRule(page, midLeftXEn, midLeftXEn + midLeftWEn, ly, { color: MONO.rule })
          ly -= 10
        }
      } else {
        page.drawText("Sin ítems con precio.", { x: midLeftXEn, y: ly, size: 8.5, font: archivoRegular, color: MONO.faint })
        ly -= 12
      }
      if (omittedCountEn > 0) {
        // Decisión: filas legacy con importe $0 no se listan (no aportan al
        // subtotal ni son cobrables) pero se avisa que existen en vez de
        // esconderlas en silencio — ver task-D4-report.md.
        page.drawText(`${omittedCountEn} ítem${omittedCountEn === 1 ? "" : "s"} sin precio omitido${omittedCountEn === 1 ? "" : "s"}`, { x: midLeftXEn, y: ly, size: 6.5, font: archivoRegular, color: MONO.faint })
        ly -= 10
      }
    } else {
      page.drawText("Sin repuestos ni mano de obra registrados.", { x: midLeftXEn, y: ly, size: 8.5, font: archivoRegular, color: MONO.faint })
      ly -= 12
    }

    const subtotalTrabajoEn = trabajosAllEn.reduce((sum, it) => sum + (Number(it.importe) || 0), 0)
    const totalFinalValueEn = data.costoFinal != null ? data.costoFinal : (data.presupuesto != null ? data.presupuesto : null)
    const totalFinalLabelEn = data.costoFinal != null ? "TOTAL FINAL" : "PRESUPUESTO"
    const totalsWEn = Math.min(midLeftWEn, 176)
    const totalsXEn = midLeftXEn + midLeftWEn - totalsWEn

    type TotalsRowEn = { label: string; value: string; big?: boolean; neg?: boolean }
    const totalsRowsEn: TotalsRowEn[] = []
    // "Presupuesto estimado" solo aporta cuando hay un costoFinal real que
    // comparar contra — si no, sería la misma cifra que ya se muestra abajo
    // como fallback "PRESUPUESTO" en negrita (fila duplicada, ver
    // task-D4-report.md).
    if (data.presupuesto != null && data.costoFinal != null) totalsRowsEn.push({ label: "Presupuesto estimado", value: formatCurrencyPDF(data.presupuesto) })
    if (trabajosAllEn.length > 0) totalsRowsEn.push({ label: "Subtotal trabajo", value: formatCurrencyPDF(subtotalTrabajoEn) })
    if (data.descuentoCobro) totalsRowsEn.push({ label: "Descuento", value: `-${formatCurrencyPDF(data.descuentoCobro)}`, neg: true })
    if (totalFinalValueEn != null) totalsRowsEn.push({ label: totalFinalLabelEn, value: formatCurrencyPDF(totalFinalValueEn), big: true })

    ly -= 4
    for (const row of totalsRowsEn) {
      if (row.big) {
        drawRule(page, totalsXEn, totalsXEn + totalsWEn, ly, { color: MONO.ink, thickness: 1.5 })
        ly -= 12
      }
      page.drawText(row.label, { x: totalsXEn, y: ly, size: row.big ? 10 : 9, font: row.big ? archivoBold : archivoRegular, color: row.neg ? MONO.label : (row.big ? MONO.ink : MONO.label) })
      rxDrawRight(page, row.value, totalsXEn + totalsWEn, ly, row.big ? 11 : 9, row.big ? archivoCondensedBold : plexMonoRegular, row.neg ? MONO.label : MONO.ink)
      ly -= row.big ? 15 : 11
    }

    const showSaldoBandEn = totalFinalValueEn != null || !!data.motivoSinCobro
    if (showSaldoBandEn) {
      const saldoBandHEn = 18
      let saldoTextEn: string
      if (data.motivoSinCobro) {
        const motivoLabel = MOTIVO_SIN_COBRO_LABELS[data.motivoSinCobro as MotivoSinCobro] || data.motivoSinCobro
        saldoTextEn = `SIN COBRO — ${motivoLabel}`
      } else {
        const totalCobradoEn = data.totalCobrado ?? 0
        const saldoEn = Math.max((totalFinalValueEn as number) - totalCobradoEn, 0)
        saldoTextEn = saldoEn <= 0 ? `${formatCurrencyPDF(0)} — PAGADO` : formatCurrencyPDF(saldoEn)
      }
      ly -= 3
      rxInkFill(page, totalsXEn, ly - saldoBandHEn, totalsWEn, saldoBandHEn)
      page.drawText("SALDO", { x: totalsXEn + 6, y: ly - saldoBandHEn + 6, size: 9, font: archivoBold, color: MONO.white })
      const saldoFontSizeEn = saldoTextEn.length > 16 ? 8 : 11
      rxDrawRight(page, saldoTextEn, totalsXEn + totalsWEn - 6, ly - saldoBandHEn + 6, saldoFontSizeEn, archivoCondensedBold, MONO.white)
      ly -= saldoBandHEn
    }

    // RIGHT — pagos registrados (panel gris) + chequeo de recepción por categoría
    let ryCol = midTopYEn
    const formatShortDateEn = (d: Date): string => {
      if (Number.isNaN(d.getTime())) return ""
      const { day, month } = getZonedParts(d, tz)
      return `${pad2(day)}/${pad2(month)}`
    }
    const cobrosAllEn = Array.isArray(data.cobros) ? data.cobros.slice(0, 12) : []
    if (cobrosAllEn.length > 0) {
      const padXEn = 8, padYEn = 6, rowHEn = 11
      const panelHEn = padYEn * 2 + 12 + cobrosAllEn.length * rowHEn
      page.drawRectangle({ x: midRightXEn, y: ryCol - panelHEn, width: midRightWEn, height: panelHEn, color: MONO.totalBg })
      drawSectionLabel(page, archivoBold, "Pagos registrados", midRightXEn + padXEn, ryCol - padYEn - 6)
      let py = ryCol - padYEn - 6 - 12
      for (const c of cobrosAllEn) {
        const fechaD = c.fecha instanceof Date ? c.fecha : new Date(c.fecha as unknown as string)
        const fechaCorta = Number.isNaN(fechaD.getTime()) ? "" : formatShortDateEn(fechaD)
        const left = [fechaCorta, safe(c.metodo), c.referencia ? safe(c.referencia) : ""].filter(Boolean).join(" · ")
        page.drawText(rxTruncate(left, archivoRegular, 8.5, midRightWEn - padXEn * 2 - 60), { x: midRightXEn + padXEn, y: py, size: 8.5, font: archivoRegular, color: MONO.ink })
        rxDrawRight(page, formatCurrencyPDF(c.monto), midRightXEn + midRightWEn - padXEn, py, 8.5, plexMonoRegular, MONO.ink)
        py -= rowHEn
      }
      ryCol -= panelHEn + 8
    }

    const CATEGORIA_LABELS_EN: Record<string, string> = {
      FUNCIONAL: "Funcional",
      CONDICION_FISICA: "Condición física",
      ACCESORIOS: "Accesorios",
      OTRO: "Otro",
      GENERAL: "General",
    }
    const checklistAllEn = Array.isArray(data.checklistItems) ? data.checklistItems : []
    if (checklistAllEn.length > 0) {
      const padXEn = 8, padYEn = 6
      const groupsEn = new Map<string, typeof checklistAllEn>()
      for (const item of checklistAllEn) {
        const cat = safe(item.categoria).toUpperCase() || "GENERAL"
        if (!groupsEn.has(cat)) groupsEn.set(cat, [])
        groupsEn.get(cat)!.push(item)
      }
      const panelTopEn = ryCol
      let cy = panelTopEn - padYEn - 6
      drawSectionLabel(page, archivoBold, "Chequeo de recepción", midRightXEn + padXEn, cy)
      cy -= 12
      for (const [cat, items] of groupsEn) {
        const groupLabel = CATEGORIA_LABELS_EN[cat] || cat
        page.drawText(groupLabel, { x: midRightXEn + padXEn, y: cy, size: 6.5, font: archivoBold, color: MONO.faint })
        cy -= 9
        const itemsText = items.map(it => {
          const v = it.valor === true ? "OK" : it.valor === false ? "NO" : safe(it.valor)
          return `${it.label}: ${v}`
        }).join(" · ")
        const itemLinesEn = rxWrap(itemsText, archivoRegular, 8.5, midRightWEn - padXEn * 2).slice(0, 3)
        for (const l of itemLinesEn) {
          page.drawText(l, { x: midRightXEn + padXEn, y: cy, size: 8.5, font: archivoRegular, color: MONO.ink })
          cy -= 10
        }
        cy -= 3
      }
      const panelBottomEn = cy - padYEn
      page.drawRectangle({ x: midRightXEn, y: panelBottomEn, width: midRightWEn, height: panelTopEn - panelBottomEn, borderColor: MONO.rule, borderWidth: RULE_WIDTH })
      ryCol = panelBottomEn - 8
    }

    ey = Math.min(ly, ryCol)

    // ---- GARANTÍA (solo si hay garantía — bloque omitido si no) ----
    if (data.garantia) {
      const garDiasEn = data.garantia.dias
      const garVencEn = formatDatePDF(data.garantia.fechaVencimiento)
      const garHeadingEn = `GARANTÍA ${garDiasEn} DÍAS`
      const garHeadingWEn = archivoCondensedBlack.widthOfTextAtSize(garHeadingEn, 15)
      const garTextXEn = rxMargin + Math.max(garHeadingWEn + 20, 110)
      const garNotasEn = [safe(data.garantia.notas), `Presentá este comprobante o el código ${codigoOrden || numeroOrdenPadded} para reclamos.`].filter(Boolean).join(" ")
      const garLinesEn = rxWrap(garNotasEn, archivoRegular, 8.5, rxContentW - (garTextXEn - rxMargin) - 10).slice(0, 3)
      const garHeightEn = 20 + 10 + garLinesEn.length * 10
      ey -= 4
      page.drawRectangle({ x: rxMargin, y: ey - garHeightEn, width: rxContentW, height: garHeightEn, borderColor: MONO.ink, borderWidth: 1.2 })
      page.drawText(garHeadingEn, { x: rxMargin + 10, y: ey - garHeightEn / 2 - 5, size: 15, font: archivoCondensedBlack, color: MONO.ink })
      page.drawText(rxTruncate(`Vigente hasta el ${garVencEn}`, archivoBold, 8.5, rxContentW - (garTextXEn - rxMargin) - 10), { x: garTextXEn, y: ey - 13, size: 8.5, font: archivoBold, color: MONO.ink })
      let gy = ey - 23
      for (const l of garLinesEn) {
        page.drawText(l, { x: garTextXEn, y: gy, size: 8, font: archivoRegular, color: MONO.label })
        gy -= 9.5
      }
      ey -= garHeightEn + 8
    }

    // ---- Pie: atribución + firmas + QR/seguimiento + términos ----
    ey -= 4
    drawRule(page, rxMargin, width - rxMargin, ey, { color: MONO.ink, thickness: 1 })
    ey -= 12

    const attrPartsEn: Array<{ label: string; value: string }> = []
    if (recibidoPorNombre) attrPartsEn.push({ label: "Recibió: ", value: recibidoPorNombre })
    if (tecnicoNombre) attrPartsEn.push({ label: "Técnico: ", value: tecnicoNombre })
    const entregadoPorEn = safe(data.entregadoPor)
    if (entregadoPorEn) attrPartsEn.push({ label: "Entregó: ", value: entregadoPorEn })
    let ax = rxMargin
    for (const p of attrPartsEn) {
      ax += rxDrawRun(page, [{ text: p.label, font: archivoRegular, color: MONO.label }, { text: p.value, font: archivoBold, color: MONO.ink }], ax, ey, 8)
      ax += 16
    }
    const dateSummaryPartsEn = [
      fechaIngreso ? `Ingreso ${fechaIngreso}` : "",
      data.fechaCompletado ? `Completado ${formatDatePDF(data.fechaCompletado)}` : "",
      data.fechaEntrega ? `Entrega ${formatDatePDF(data.fechaEntrega)}` : "",
    ].filter(Boolean).join(" · ")
    if (dateSummaryPartsEn) rxDrawRight(page, dateSummaryPartsEn, width - rxMargin, ey, 7.5, archivoRegular, MONO.label)
    ey -= 20

    // QR + seguimiento + 3 firmas (recepción en archivo, cliente entrega, negocio)
    const sigRowTopEn = ey
    const qrSizeEn = 40
    let qrImgEn: Awaited<ReturnType<typeof pdfDoc.embedPng>> | null = null
    const hasTrackingEn = !!(data.publicToken && data.baseUrl)
    if (hasTrackingEn) {
      try {
        const trackingUrl = `${data.baseUrl}/seguimiento/${data.publicToken}`
        const qrDataUrl = await QRCode.toDataURL(trackingUrl, { width: 200, margin: 1, color: { dark: "#111111", light: "#ffffff" } })
        const qrBytes = Uint8Array.from(atob(qrDataUrl.split(",")[1]), c => c.charCodeAt(0))
        qrImgEn = await pdfDoc.embedPng(qrBytes)
      } catch { /* ignore QR errors — se sigue sin el código */ }
    }
    let afterQrXEn = rxMargin
    if (qrImgEn) {
      page.drawImage(qrImgEn, { x: rxMargin, y: sigRowTopEn - qrSizeEn, width: qrSizeEn, height: qrSizeEn })
      afterQrXEn = rxMargin + qrSizeEn + 10
    }
    let trackWEn = 0
    if (hasTrackingEn) {
      trackWEn = 110
      const trackUrlDisplayEn = `${safe(data.baseUrl).replace(/^https?:\/\//, "")}/seguimiento/${safe(data.publicToken)}`
      const trackLinesEn = ["Historial completo, fotos y", "garantía online:", ...rxWrap(trackUrlDisplayEn, archivoBold, 6.5, trackWEn)]
      let tY = sigRowTopEn - 8
      for (const l of trackLinesEn.slice(0, 4)) {
        page.drawText(l, { x: afterQrXEn, y: tY, size: 6.5, font: l.includes("/") ? archivoBold : archivoRegular, color: MONO.label })
        tY -= 8
      }
    }
    const sigStartXEn = afterQrXEn + trackWEn + (hasTrackingEn ? 10 : 0)
    const sigAreaWEn = (rxMargin + rxContentW) - sigStartXEn
    if (sigAreaWEn > 100) {
      const gapSigEn = 8
      const sigColWEn = (sigAreaWEn - gapSigEn * 2) / 3
      const sigLineYEn = sigRowTopEn - qrSizeEn + 6

      // Firma 1 — cliente, recepción (queda en archivo, no se re-dibuja imagen)
      const sig1X = sigStartXEn
      drawRule(page, sig1X, sig1X + sigColWEn, sigLineYEn, { color: MONO.ink })
      const sig1Label = data.firmaRecepcion ? "CLIENTE — RECEPCIÓN (EN ARCHIVO)" : "CLIENTE — RECEPCIÓN"
      page.drawText(rxTruncate(sig1Label, archivoBold, 6, sigColWEn), { x: sig1X, y: sigLineYEn - 8, size: 6, font: archivoBold, color: MONO.label })

      // Firma 2 — cliente, entrega (imagen si existe)
      const sig2X = sig1X + sigColWEn + gapSigEn
      if (data.firmaClienteEntrega) {
        try {
          const bytes = Uint8Array.from(atob(data.firmaClienteEntrega), c => c.charCodeAt(0))
          const img = await pdfDoc.embedPng(bytes)
          const dims = img.scale(1)
          const scale = Math.min((sigColWEn - 6) / dims.width, (qrSizeEn - 14) / dims.height)
          page.drawImage(img, { x: sig2X + (sigColWEn - dims.width * scale) / 2, y: sigLineYEn + 3, width: dims.width * scale, height: dims.height * scale })
        } catch { /* ignore embedding errors — la línea queda en blanco */ }
      }
      drawRule(page, sig2X, sig2X + sigColWEn, sigLineYEn, { color: MONO.ink })
      page.drawText("CLIENTE — ENTREGA", { x: sig2X, y: sigLineYEn - 8, size: 6, font: archivoBold, color: MONO.label })

      // Firma 3 — negocio (imagen si existe) + nombre de quien entregó
      const sig3X = sig2X + sigColWEn + gapSigEn
      if (data.firmaEncargadoEntrega) {
        try {
          const bytes = Uint8Array.from(atob(data.firmaEncargadoEntrega), c => c.charCodeAt(0))
          const img = await pdfDoc.embedPng(bytes)
          const dims = img.scale(1)
          const scale = Math.min((sigColWEn - 6) / dims.width, (qrSizeEn - 14) / dims.height)
          page.drawImage(img, { x: sig3X + (sigColWEn - dims.width * scale) / 2, y: sigLineYEn + 3, width: dims.width * scale, height: dims.height * scale })
        } catch { /* ignore embedding errors */ }
      }
      drawRule(page, sig3X, sig3X + sigColWEn, sigLineYEn, { color: MONO.ink })
      const sig3Label = entregadoPorEn ? `ENTREGÓ — ${entregadoPorEn.toUpperCase()}` : "ENTREGÓ"
      page.drawText(rxTruncate(sig3Label, archivoBold, 6, sigColWEn), { x: sig3X, y: sigLineYEn - 8, size: 6, font: archivoBold, color: MONO.label })
    }
    ey = sigRowTopEn - 55

    // ---- Términos (mismo criterio que la hoja RECEPCIÓN) ----
    const terminosListEn = parseRecepcionTerminos(data.recepcionTerminos)
    const terminosFlatEn: string[] = []
    for (const raw of terminosListEn) {
      terminosFlatEn.push(...rxWrap(raw, archivoRegular, 6, rxContentW))
    }
    const shownTerminosEn = terminosFlatEn.slice(0, 6)
    for (const l of shownTerminosEn) {
      page.drawText(l, { x: rxMargin, y: ey, size: 6, font: archivoRegular, color: MONO.faint })
      ey -= 8
    }

    // ---- Recorte dinámico al contenido real (misma técnica que la hoja RECEPCIÓN) ----
    const contentBottomEn = ey - 10
    const minPageHeightEn = width
    const dynamicHeightEn = Math.max(height - contentBottomEn, minPageHeightEn)
    if (dynamicHeightEn < height) {
      page.setMediaBox(0, contentBottomEn, width, dynamicHeightEn)
      page.setCropBox(0, contentBottomEn, width, dynamicHeightEn)
      page.setTrimBox(0, contentBottomEn, width, dynamicHeightEn)
    }
  } else {
  // ============================================================
  // PARTE CLIENTE
  // ============================================================
  let ry = height - rxMargin

  // ---- Header: logo (si hay) + empresa/sucursal + idbox (#numero, código, estado) ----
  const headerTopY = ry
  const logoBoxSize = 42

  let rxLogo: Awaited<ReturnType<typeof pdfDoc.embedPng>> | Awaited<ReturnType<typeof pdfDoc.embedJpg>> | null = null
  if (data.logoUrl) {
    try {
      const res = await fetch(data.logoUrl)
      if (res.ok) {
        const buf = new Uint8Array(await res.arrayBuffer())
        const ct = res.headers.get("content-type") || ""
        if (ct.includes("png") || data.logoUrl.toLowerCase().includes(".png")) {
          rxLogo = await pdfDoc.embedPng(buf)
        } else if (ct.includes("jpeg") || ct.includes("jpg") || data.logoUrl.toLowerCase().includes(".jpg") || data.logoUrl.toLowerCase().includes(".jpeg")) {
          rxLogo = await pdfDoc.embedJpg(buf)
        }
      }
    } catch { /* logo no disponible — no se dibuja la caja (skip, no placeholder) */ }
  }

  if (rxLogo) {
    page.drawRectangle({ x: rxMargin, y: headerTopY - logoBoxSize, width: logoBoxSize, height: logoBoxSize, borderColor: MONO.ink, borderWidth: 1 })
    const s = rxLogo.scale(1)
    const inset = 5
    const ratio = Math.min((logoBoxSize - inset * 2) / s.width, (logoBoxSize - inset * 2) / s.height)
    const lw = s.width * ratio
    const lh = s.height * ratio
    page.drawImage(rxLogo, { x: rxMargin + (logoBoxSize - lw) / 2, y: headerTopY - logoBoxSize + (logoBoxSize - lh) / 2, width: lw, height: lh })
  }

  const bizX = rxMargin + (rxLogo ? logoBoxSize + 12 : 0)

  // idbox: se calcula primero su ancho reservado para poder acotar el
  // ancho disponible del bloque de empresa/sucursal a su izquierda.
  const numSize = 20
  const numW = archivoCondensedBlack.widthOfTextAtSize(numeroOrdenPadded, numSize)
  const codeW = codigoOrden ? plexMonoRegular.widthOfTextAtSize(codigoOrden, 8) : 0
  const tagLabel = estadoDisplay.toUpperCase()
  const tagW = archivoBold.widthOfTextAtSize(tagLabel, 7) + 10
  const idboxReserved = Math.max(numW, codeW, tagW) + 4
  const bizMaxWidth = (width - rxMargin) - idboxReserved - 10 - bizX

  const bizNameSize = 13
  page.drawText(rxTruncate(empresaNombre, archivoBlack, bizNameSize, bizMaxWidth), { x: bizX, y: headerTopY - 11, size: bizNameSize, font: archivoBlack, color: MONO.ink })
  const contactLineText = [sucursalNombre, sucursalDireccion || direccionEmpresa, sucursalTelefono || telefonoEmpresa, data.emailEmpresa ? safe(data.emailEmpresa) : ""].filter(Boolean).join(" · ")
  const contactLines = rxWrap(contactLineText, archivoRegular, 7.5, bizMaxWidth).slice(0, 2)
  let bizY = headerTopY - 11 - 14
  for (const l of contactLines) {
    page.drawText(l, { x: bizX, y: bizY, size: 7.5, font: archivoRegular, color: MONO.label })
    bizY -= 10
  }

  const idboxRight = width - rxMargin
  rxDrawRight(page, numeroOrdenPadded, idboxRight, headerTopY - 16, numSize, archivoCondensedBlack, MONO.ink)
  let idboxY = headerTopY - 27
  if (codigoOrden) {
    rxDrawRight(page, codigoOrden, idboxRight, idboxY, 8, plexMonoRegular, MONO.label)
    idboxY -= 12
  } else {
    idboxY -= 4
  }
  // Tag de estado — relleno ink local (ver rxInkFill más arriba).
  rxInkFill(page, idboxRight - tagW, idboxY - 12, tagW, 12)
  page.drawText(tagLabel, { x: idboxRight - tagW + 5, y: idboxY - 9, size: 7, font: archivoBold, color: MONO.white })

  const headerBottomY = headerTopY - Math.max(logoBoxSize, 46)
  ry = headerBottomY - 8
  drawRule(page, rxMargin, width - rxMargin, ry, { color: MONO.ink, thickness: 1.4 })
  ry -= 10

  // ---- Timeline ----
  const timelineH = 24
  const timelineTop = ry
  const colW = rxContentW / 7
  page.drawRectangle({ x: rxMargin, y: timelineTop - timelineH, width: rxContentW, height: timelineH, borderColor: MONO.ink, borderWidth: 1 })
  for (let i = 0; i < 7; i++) {
    const colX = rxMargin + i * colW
    const isOn = i === currentStepIndex
    const isDone = i < currentStepIndex && !!stepDates[i]
    if (isOn) rxInkFill(page, colX, timelineTop - timelineH, colW, timelineH)
    if (i > 0) {
      page.drawLine({ start: { x: colX, y: timelineTop }, end: { x: colX, y: timelineTop - timelineH }, thickness: RULE_WIDTH, color: isOn ? MONO.ink : MONO.rule })
    }
    const labelColor = isOn ? MONO.white : (isDone ? MONO.ink : MONO.faint)
    const dateColor = isOn ? MONO.white : (isDone ? MONO.label : MONO.faint)
    const stepLabelSize = 6
    const checkW = isDone ? 6 : 0 // vector check (rxDrawCheck) + gap — reserved, not part of the text string
    const stepLabelTrunc = rxTruncate(TIMELINE_LABELS[i].toUpperCase(), archivoBold, stepLabelSize, colW - 4 - checkW)
    const labelW = archivoBold.widthOfTextAtSize(stepLabelTrunc, stepLabelSize)
    const blockX = colX + (colW - (labelW + checkW)) / 2
    if (isDone) rxDrawCheck(page, blockX, timelineTop - 8.7, labelColor)
    page.drawText(stepLabelTrunc, { x: blockX + checkW, y: timelineTop - 10, size: stepLabelSize, font: archivoBold, color: labelColor })
    let dateText = "—"
    if (isOn && nonCanonicalTag) {
      dateText = rxTruncate(nonCanonicalTag, archivoRegular, 6, colW - 4)
    } else if (stepDates[i]) {
      dateText = formatTimelineDate(stepDates[i] as Date)
    }
    const dateW = archivoRegular.widthOfTextAtSize(dateText, 6)
    page.drawText(dateText, { x: colX + (colW - dateW) / 2, y: timelineTop - 19, size: 6, font: archivoRegular, color: dateColor })
  }
  ry = timelineTop - timelineH - 10

  // ---- Grid: Cliente | Equipo ----
  const colGridW = rxContentW / 2
  const isEmpresa = clienteTipoCliente.toUpperCase() === "EMPRESA" && !!clienteRazonSocial
  const clienteLines: RxCellLine[] = []
  if (isEmpresa) {
    const idSuffix = clienteCuit ? ` · CUIT ${clienteCuit}` : ""
    clienteLines.push({ text: `${clienteRazonSocial}${idSuffix}`.substring(0, 60), font: archivoBold, size: 9, color: MONO.ink })
    const contactSuffix = clienteDni ? ` · DNI ${clienteDni}` : ""
    clienteLines.push({ text: `Contacto: ${clienteNombre}${contactSuffix}`.substring(0, 60), font: archivoRegular, size: 8, color: MONO.label })
  } else {
    const idSuffix = clienteDni ? ` · DNI ${clienteDni}` : (clienteCuit ? ` · CUIT ${clienteCuit}` : "")
    clienteLines.push({ text: `${clienteNombre}${idSuffix}`.substring(0, 60), font: archivoBold, size: 9, color: MONO.ink })
  }
  const telParts = [clienteTelefono]
  if (telefonoContacto && telefonoContacto !== clienteTelefono) telParts.push(`tel. de esta orden: ${telefonoContacto}`)
  clienteLines.push({ text: telParts.join(" · ").substring(0, 65), font: archivoRegular, size: 8, color: MONO.label })
  if (clienteEmail) clienteLines.push({ text: clienteEmail.substring(0, 50), font: archivoRegular, size: 8, color: MONO.label })

  const equipoLines: RxCellLine[] = []
  const equipoTitle = [dispositivo, marca, colorDisp].filter(Boolean).join(" · ")
  equipoLines.push({ text: equipoTitle.substring(0, 55), font: archivoBold, size: 9, color: MONO.ink })
  if (imei) equipoLines.push({ text: `${t(term, "serie")} ${imei}`.substring(0, 55), font: plexMonoRegular, size: 8, color: MONO.ink })
  if (metadataCampos.length > 0) {
    const metaText = metadataCampos.map(m => `${m.label}: ${m.valor}`).join(" · ")
    equipoLines.push({ text: metaText.substring(0, 65), font: archivoRegular, size: 7.5, color: MONO.label })
  }

  const rowH1 = rxDrawGridRow([
    { x: rxMargin, width: colGridW, label: "Cliente", lines: clienteLines },
    { x: rxMargin + colGridW, width: colGridW, label: t(term, "equipo"), lines: equipoLines },
  ], ry)
  ry -= rowH1

  // ---- Falla declarada (fila completa) ----
  const fallaLines: RxCellLine[] = rxWrap(problemaReportado, archivoRegular, 9, rxContentW - rxCellPadX * 2)
    .slice(0, 3)
    .map(l => ({ text: l, font: archivoRegular, size: 9, color: MONO.ink }))
  const rowH2 = rxDrawGridRow([{ x: rxMargin, width: rxContentW, label: "Falla declarada", lines: fallaLines }], ry)
  ry -= rowH2

  // ---- Accesorios recibidos | Fotos de ingreso (fila completa, dividida 65/35) ----
  const accesoriosLines: RxCellLine[] = accesorios
    ? [{ text: accesorios.substring(0, 70), font: archivoRegular, size: 9, color: MONO.ink }]
    : [{ text: "—", font: archivoRegular, size: 9, color: MONO.faint }]
  const fotosCount = Array.isArray(data.fotosIngreso) ? data.fotosIngreso.length : 0
  const fotosLines: RxCellLine[] = [{ text: fotosCount > 0 ? `${fotosCount} registradas` : "Sin fotos", font: archivoRegular, size: 9, color: MONO.ink }]
  const accW = rxContentW * 0.65
  const rowH3 = rxDrawGridRow([
    { x: rxMargin, width: accW, label: "Accesorios recibidos", lines: accesoriosLines },
    { x: rxMargin + accW, width: rxContentW - accW, label: "Fotos de ingreso", lines: fotosLines },
  ], ry)
  ry -= rowH3 + 8

  // ---- money3: presupuesto | seña | saldo (última celda ink-fill) ----
  if (data.presupuesto || data.sena) {
    const presupNum = Number(data.presupuesto) || 0
    const senaNum = Number(data.sena) || 0
    const saldoNum = Math.max(presupNum - senaNum, 0)
    const money3Cells = [
      { label: "Presupuesto estimado", amt: formatCurrencyPDF(presupNum) },
      { label: `Seña abonada${data.metodoPagoSena ? " · " + data.metodoPagoSena : ""}`, amt: formatCurrencyPDF(senaNum) },
      { label: "Saldo estimado", amt: formatCurrencyPDF(saldoNum) },
    ]
    const mcW = rxContentW / 3
    const money3H = 34
    page.drawRectangle({ x: rxMargin, y: ry - money3H, width: rxContentW, height: money3H, borderColor: MONO.ink, borderWidth: 1 })
    money3Cells.forEach((c, i) => {
      const cx = rxMargin + i * mcW
      const isLast = i === 2
      if (isLast) rxInkFill(page, cx, ry - money3H, mcW, money3H)
      if (i > 0) page.drawLine({ start: { x: cx, y: ry }, end: { x: cx, y: ry - money3H }, thickness: RULE_WIDTH, color: isLast ? MONO.ink : MONO.rule })
      const lblColor = isLast ? MONO.faint : MONO.label
      const amtColor = isLast ? MONO.white : MONO.ink
      page.drawText(rxTruncate(c.label.toUpperCase(), archivoBold, 6, mcW - 12), { x: cx + 8, y: ry - 13, size: 6, font: archivoBold, color: lblColor })
      page.drawText(rxTruncate(c.amt, archivoCondensedBold, 13, mcW - 12), { x: cx + 8, y: ry - 27, size: 13, font: archivoCondensedBold, color: amtColor })
    })
    ry -= money3H + 8
  }

  // ---- Retiro estimado ----
  if (fechaPrometida) {
    rxDrawRun(page, [
      { text: "Retiro estimado: ", font: archivoRegular, color: MONO.ink },
      { text: fechaPrometida, font: archivoBold, color: MONO.ink },
      { text: " — te avisamos ante cada cambio de estado.", font: archivoRegular, color: MONO.label },
    ], rxMargin, ry - 9, 9)
    ry -= 18
  }

  // ---- QR + seguimiento + firma cliente + "Recibió — {recibidoPorNombre}" ----
  ry -= 4
  const sigRowTop = ry
  const sigBlockH = 55
  const qrSize = 45
  let qrImg: Awaited<ReturnType<typeof pdfDoc.embedPng>> | null = null
  const hasTracking = !!(data.publicToken && data.baseUrl)
  if (hasTracking) {
    try {
      const trackingUrl = `${data.baseUrl}/seguimiento/${data.publicToken}`
      const qrDataUrl = await QRCode.toDataURL(trackingUrl, { width: 200, margin: 1, color: { dark: "#111111", light: "#ffffff" } })
      const qrBytes = Uint8Array.from(atob(qrDataUrl.split(",")[1]), c => c.charCodeAt(0))
      qrImg = await pdfDoc.embedPng(qrBytes)
    } catch { /* ignore QR errors — se sigue sin el código */ }
  }
  let afterQrX = rxMargin
  if (qrImg) {
    page.drawImage(qrImg, { x: rxMargin, y: sigRowTop - qrSize, width: qrSize, height: qrSize })
    afterQrX = rxMargin + qrSize + 10
  }
  let trackW = 0
  if (hasTracking) {
    trackW = 130
    const trackUrlDisplay = `${safe(data.baseUrl).replace(/^https?:\/\//, "")}/seguimiento/${safe(data.publicToken)}`
    const trackLines = ["Estado en vivo, fotos y", "presupuesto online:", ...rxWrap(trackUrlDisplay, archivoBold, 7, trackW)]
    let tY = sigRowTop - 9
    for (const l of trackLines.slice(0, 4)) {
      page.drawText(l, { x: afterQrX, y: tY, size: 7, font: l.includes("/") ? archivoBold : archivoRegular, color: MONO.label })
      tY -= 9
    }
  }
  const sigStartX = afterQrX + trackW + (hasTracking ? 10 : 0)
  const sigAreaW = (rxMargin + rxContentW) - sigStartX
  if (sigAreaW > 80) {
    const sigColW = (sigAreaW - 10) / 2
    const sigLineY = sigRowTop - qrSize + 6
    drawRule(page, sigStartX, sigStartX + sigColW, sigLineY, { color: MONO.ink })
    page.drawText("FIRMA DEL CLIENTE", { x: sigStartX, y: sigLineY - 8, size: 6, font: archivoBold, color: MONO.label })
    const recibioX = sigStartX + sigColW + 10
    drawRule(page, recibioX, recibioX + sigColW, sigLineY, { color: MONO.ink })
    const recibioLabel = recibidoPorNombre ? `RECIBIÓ — ${recibidoPorNombre.toUpperCase()}` : "RECIBIÓ"
    page.drawText(rxTruncate(recibioLabel, archivoBold, 6, sigColW), { x: recibioX, y: sigLineY - 8, size: 6, font: archivoBold, color: MONO.label })
  }
  ry = sigRowTop - sigBlockH

  // ---- Términos (compacto) ----
  const terminosList = parseRecepcionTerminos(data.recepcionTerminos)
  const terminosFlat: string[] = []
  for (const raw of terminosList) {
    terminosFlat.push(...rxWrap(raw, archivoRegular, 6, rxContentW))
  }
  const shownTerminos = terminosFlat.slice(0, 6)
  if (shownTerminos.length > 0) {
    for (const l of shownTerminos) {
      page.drawText(l, { x: rxMargin, y: ry, size: 6, font: archivoRegular, color: MONO.faint })
      ry -= 8
    }
  }

  // ============================================================
  // soloCliente (compartir por WhatsApp): SOLO la parte cliente — sin
  // talón ni línea de corte. Recorte dinámico al contenido real, igual que
  // el comportamiento previo.
  // ============================================================
  if (data.soloCliente) {
    const contentBottom = ry - 10
    const minPageHeight = width
    const dynamicHeight = Math.max(height - contentBottom, minPageHeight)
    if (dynamicHeight < height) {
      page.setMediaBox(0, contentBottom, width, dynamicHeight)
      page.setCropBox(0, contentBottom, width, dynamicHeight)
      page.setTrimBox(0, contentBottom, width, dynamicHeight)
    }
    const pdfBytes = await pdfDoc.save()
    return Buffer.from(pdfBytes)
  }

  // ============================================================
  // ✂ LÍNEA DE CORTE
  // ============================================================
  ry -= 6
  const cutY = ry
  for (let dx = rxMargin + 16; dx < width - rxMargin - 16; dx += 10) {
    page.drawLine({ start: { x: dx, y: cutY }, end: { x: Math.min(dx + 5, width - rxMargin - 16), y: cutY }, thickness: 0.75, color: MONO.rule })
  }
  rxDrawScissors(page, rxMargin, cutY - 1, MONO.label)
  page.drawText("PARTE SUPERIOR · CLIENTE", { x: rxMargin + 16, y: cutY - 9, size: 6.5, font: archivoBold, color: MONO.label })
  const stubLabel = "TALÓN INFERIOR · NEGOCIO"
  rxDrawRight(page, stubLabel, width - rxMargin, cutY - 9, 6.5, archivoBold, MONO.label)

  // ============================================================
  // TALÓN INTERNO — NEGOCIO
  // ============================================================
  let sy = cutY - 20

  page.drawText("TALÓN INTERNO — RECEPCIÓN", { x: rxMargin, y: sy, size: 8, font: archivoBlack, color: MONO.ink })
  rxDrawRight(page, numeroOrdenPadded, width - rxMargin, sy - 1, 13, archivoCondensedBlack, MONO.ink)
  sy -= 14
  const stubSubText = [codigoOrden, fechaIngreso, sucursalNombre].filter(Boolean).join(" · ")
  if (stubSubText) {
    rxDrawRight(page, rxTruncate(stubSubText, plexMonoRegular, 7, rxContentW - 140), width - rxMargin, sy, 7, plexMonoRegular, MONO.label)
  }
  sy -= 12

  // ---- Fila 1: Cliente | Equipo ----
  const stubClienteLines: RxCellLine[] = [
    { text: `${clienteNombre} · ${clienteTelefono}`.substring(0, 55), font: archivoBold, size: 8, color: MONO.ink },
  ]
  if (clienteDni) stubClienteLines.push({ text: `DNI ${clienteDni}`, font: archivoRegular, size: 7.5, color: MONO.label })
  const stubEquipoLines: RxCellLine[] = [
    { text: [dispositivo, marca, colorDisp].filter(Boolean).join(" · ").substring(0, 55), font: archivoBold, size: 8, color: MONO.ink },
  ]
  if (imei) stubEquipoLines.push({ text: `IMEI ${imei}`, font: plexMonoRegular, size: 7, color: MONO.label })
  const stubRow1H = rxDrawGridRow([
    { x: rxMargin, width: colGridW, label: "Cliente", lines: stubClienteLines },
    { x: rxMargin + colGridW, width: colGridW, label: t(term, "equipo"), lines: stubEquipoLines },
  ], sy)
  sy -= stubRow1H

  // ---- Fila 2: Código de acceso (PIN/patrón — SOLO acá) | Chequeo rápido ----
  const checklistItemsList = Array.isArray(data.checklistItems) ? data.checklistItems : []
  const chequeoParts = checklistItemsList.map(it => {
    const v = it.valor === true ? "OK" : it.valor === false ? "NO" : safe(it.valor)
    return `${it.label}: ${v}`
  })
  if (data.checklistNotas) chequeoParts.push(safe(data.checklistNotas))
  const chequeoText = chequeoParts.join(" · ") || "Sin chequeo registrado"
  const chequeoLines = rxWrap(chequeoText, archivoRegular, 7.5, colGridW - rxCellPadX * 2).slice(0, 4)

  const isPatternCode = !!codigoAccesoDispositivo && /^patr[oó]n:/i.test(codigoAccesoDispositivo)
  const row2H = Math.max(58, 12 + chequeoLines.length * 10 + rxCellPadY * 2)
  page.drawRectangle({ x: rxMargin, y: sy - row2H, width: rxContentW, height: row2H, borderColor: MONO.rule, borderWidth: RULE_WIDTH })
  page.drawLine({ start: { x: rxMargin + colGridW, y: sy }, end: { x: rxMargin + colGridW, y: sy - row2H }, thickness: RULE_WIDTH, color: MONO.rule })
  drawSectionLabel(page, archivoBold, "Código de acceso", rxMargin + rxCellPadX, sy - rxCellPadY - 6)
  if (codigoAccesoDispositivo) {
    if (isPatternCode) {
      const patternMatch = codigoAccesoDispositivo.match(/[\d-]+$/)
      const patternNumbers = patternMatch
        ? patternMatch[0].split("-").map(n => parseInt(n.trim(), 10)).filter(n => n >= 1 && n <= 9)
        : []
      const patCenterX = rxMargin + colGridW - 60
      const patTopY = sy - rxCellPadY - 16
      const cellSize = 11
      const dotR = 2.2
      const getPos = (num: number) => ({ x: patCenterX + ((num - 1) % 3 - 1) * cellSize, y: patTopY - Math.floor((num - 1) / 3) * cellSize })
      for (let i = 0; i < patternNumbers.length - 1; i++) {
        const s = getPos(patternNumbers[i])
        const e = getPos(patternNumbers[i + 1])
        page.drawLine({ start: s, end: e, thickness: 1, color: MONO.ink })
      }
      for (let num = 1; num <= 9; num++) {
        const pos = getPos(num)
        const inPat = patternNumbers.includes(num)
        page.drawCircle({ x: pos.x, y: pos.y, size: dotR, color: inPat ? MONO.ink : MONO.rule, borderWidth: 0 })
        if (inPat) page.drawCircle({ x: pos.x, y: pos.y, size: dotR - 1, color: MONO.white, borderWidth: 0 })
      }
      page.drawText("Patrón — solo talón interno", { x: rxMargin + rxCellPadX, y: sy - rxCellPadY - 32, size: 6.5, font: archivoRegular, color: MONO.label })
    } else {
      page.drawText(codigoAccesoDispositivo.substring(0, 20), { x: rxMargin + rxCellPadX, y: sy - rxCellPadY - 22, size: 9, font: plexMonoRegular, color: MONO.ink })
    }
  } else {
    page.drawText("—", { x: rxMargin + rxCellPadX, y: sy - rxCellPadY - 22, size: 9, font: archivoRegular, color: MONO.faint })
  }
  drawSectionLabel(page, archivoBold, "Chequeo rápido", rxMargin + colGridW + rxCellPadX, sy - rxCellPadY - 6)
  let chqY = sy - rxCellPadY - 6 - 12
  for (const l of chequeoLines) {
    page.drawText(l, { x: rxMargin + colGridW + rxCellPadX, y: chqY, size: 7.5, font: archivoRegular, color: MONO.ink })
    chqY -= 10
  }
  sy -= row2H

  // ---- Fila 3: Falla / notas de mostrador (+ técnico) | Presupuesto/Seña | Prometida ----
  const notasMostrador = [problemaReportado, tecnicoNombre ? `Técnico asignado: ${tecnicoNombre}` : ""].filter(Boolean).join(". ")
  const notasLines: RxCellLine[] = rxWrap(notasMostrador, archivoRegular, 7.5, rxContentW * 0.5 - rxCellPadX * 2)
    .slice(0, 3)
    .map(l => ({ text: l, font: archivoRegular, size: 7.5, color: MONO.ink }))
  const presupSenaText = `${presupuesto || formatCurrencyPDF(0)} / ${data.sena ? formatCurrencyPDF(data.sena) : "—"}`
  const row3H = rxDrawGridRow([
    { x: rxMargin, width: rxContentW * 0.5, label: "Falla / notas de mostrador", lines: notasLines },
    { x: rxMargin + rxContentW * 0.5, width: rxContentW * 0.25, label: "Presupuesto / Seña", lines: [{ text: presupSenaText, font: archivoBold, size: 8, color: MONO.ink }] },
    { x: rxMargin + rxContentW * 0.75, width: rxContentW * 0.25, label: "Prometida", lines: [{ text: fechaPrometida || "—", font: archivoBold, size: 8, color: MONO.ink }] },
  ], sy)
  sy -= row3H

  // ---- Recorte dinámico al contenido real (misma técnica que antes) ----
  const contentBottom = sy - 14
  const minPageHeight = width
  const dynamicHeight = Math.max(height - contentBottom, minPageHeight)
  if (dynamicHeight < height) {
    page.setMediaBox(0, contentBottom, width, dynamicHeight)
    page.setCropBox(0, contentBottom, width, dynamicHeight)
    page.setTrimBox(0, contentBottom, width, dynamicHeight)
  }
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

  // NOTA (Task D4): la vieja "SECCION DE ENTREGA" (segunda página con
  // COMPROBANTE DE ENTREGA + firmas) se eliminó — para los estados
  // terminales de entrega ahora se dibuja la hoja ENTREGA completa arriba
  // (isEntregaSheet), con atribución y firmas incluidas en esa misma
  // página. Este bloque solo se ejecutaba cuando `data.estado ===
  // "ENTREGADO"`, que ahora siempre cae en la rama isEntregaSheet — así que
  // era código inalcanzable en la rama RECEPCIÓN de todas formas.

  const pdfBytes = await pdfDoc.save()
  return Buffer.from(pdfBytes)
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
  // Accounting-grade remito: when present, drawn as a second "Operación:"
  // line below "Emisión:" — the date the goods/service actually moved,
  // which can differ from the document's emission date.
  fechaOperacion?: Date | string
  estadoPago: string
  cliente: {
    nombre: string
    telefono?: string | null
    email?: string | null
    direccion?: string | null
    dni?: string | null
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
  // Fiscal emitter identity — drawn in the EMISOR header block below.
  cuitEmpresa?: string | null
  condicionIvaEmpresa?: string | null
  domicilioFiscalEmpresa?: string | null
  // Payment terms — drawn in the CONDICIONES DE PAGO block below.
  vencimiento?: Date | string | null
  mediosPago?: string | null
  cbuAlias?: string | null
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
  // Fiscal emitter identity — accounting-grade remito header extras, each
  // line drawn only when present (see EMISOR block below).
  const cuitEmpresa = safe(data.cuitEmpresa)
  const condicionIvaEmpresa = safe(data.condicionIvaEmpresa)
  const domicilioFiscalEmpresa = safe(data.domicilioFiscalEmpresa)
  const numeroFactura = safe(data.numeroFactura)
  const fecha = formatDatePDF(data.fecha)
  const clienteNombre = safe(data.cliente?.nombre) || "Consumidor Final"
  const clienteTelefono = safe(data.cliente?.telefono)
  const clienteEmail = safe(data.cliente?.email)
  const clienteDireccion = safe(data.cliente?.direccion)
  const clienteDni = safe(data.cliente?.dni)
  const ordenDisplay = data.orden
    ? data.orden.codigoOrden || `#${String(data.orden.numeroOrden).padStart(4, "0")}`
    : ""
  const dispositivo = data.orden ? safe(data.orden.dispositivo) : ""
  const pendiente = data.total - (data.montoAbonado || 0)
  // Payment terms — accounting-grade remito CONDICIONES DE PAGO section
  // (see below); the whole section is drawn only when at least one of
  // these three is present.
  const vencimientoText = data.vencimiento ? formatDatePDF(data.vencimiento) : ""
  const mediosPago = safe(data.mediosPago)
  const cbuAlias = safe(data.cbuAlias)

  // Crear documento PDF
  const pdfDoc = await PDFLib.create()
  let page = pdfDoc.addPage([595, 842]) // A4 — reassigned by startContinuationPage() below
  const pages: (typeof page)[] = [page] // every page, so the footer can be drawn on each one
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
  // Fiscal emitter extras (CUIT / condición IVA / domicilio fiscal) — one
  // 8pt line each, only when present. Tracked so the separator below can
  // extend downward and avoid colliding with these lines.
  let emisorExtraLines = 0
  if (cuitEmpresa) {
    page.drawText(`CUIT: ${cuitEmpresa}`, { x: margin + logoWidth, y, size: TYPE.small, font: helvetica, color: MONO.label })
    y -= 12
    emisorExtraLines++
  }
  if (condicionIvaEmpresa) {
    page.drawText(condicionIvaEmpresa, { x: margin + logoWidth, y, size: TYPE.small, font: helvetica, color: MONO.label })
    y -= 12
    emisorExtraLines++
  }
  if (domicilioFiscalEmpresa) {
    page.drawText(domicilioFiscalEmpresa, { x: margin + logoWidth, y, size: TYPE.small, font: helvetica, color: MONO.label })
    y -= 12
    emisorExtraLines++
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
  const emisionLabel = `Emisión: ${fecha}`
  const emisionLabelWidth = helvetica.widthOfTextAtSize(emisionLabel, TYPE.small)
  page.drawText(emisionLabel, {
    x: width - margin - emisionLabelWidth,
    y: height - margin - 50,
    size: TYPE.small,
    font: helvetica,
    color: MONO.label,
  })
  // Accounting-grade remito: the date the goods/service actually moved can
  // differ from the emission date above — shown only when supplied.
  if (data.fechaOperacion) {
    const operacionLabel = `Operación: ${formatDatePDF(data.fechaOperacion)}`
    const operacionLabelWidth = helvetica.widthOfTextAtSize(operacionLabel, TYPE.small)
    page.drawText(operacionLabel, {
      x: width - margin - operacionLabelWidth,
      y: height - margin - 62,
      size: TYPE.small,
      font: helvetica,
      color: MONO.label,
    })
  }

  // Base offset (90) matches the original 2-line company block (name + one
  // of tel/direccion) with ~40pt clearance above this rule; each emisor
  // extra line pushes the rule down another 12 so that clearance is
  // preserved regardless of how many fiscal lines were drawn above.
  y = height - margin - (90 + 12 * emisorExtraLines)

  // Linea separadora (reemplaza el titulo centrado "FACTURA")
  drawRule(page, margin, width - margin, y)
  y -= 30

  // === DATOS DEL CLIENTE ===
  // clientBoxHeight grows by 12 when DNI/CUIT is present (accounting-grade
  // remito receptor identity) so the dotted rule below keeps the same ~5pt
  // clearance below the last drawn line — stays at the original 60 when
  // dni is absent (identical to before this task).
  const clientBoxHeight = 60 + (clienteDni ? 12 : 0)
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
    clientY -= 12
  }
  if (clienteDni) {
    page.drawText(`DNI/CUIT: ${clienteDni}`, { x: margin + 10, y: clientY, size: TYPE.small, font: helvetica, color: MONO.label })
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
  // Right-aligns text to xRight by measuring its width first — needed for
  // the HISTORIAL DE PAGOS money columns below, which sit side by side
  // (MONTO then the running-balance SALDO) and must never collide
  // regardless of how many digits either amount has.
  const drawTextRight = (pg: typeof page, text: string, xRight: number, yPos: number, size: number, font: typeof helvetica, color: ReturnType<typeof rgb>) => {
    pg.drawText(text, { x: xRight - font.widthOfTextAtSize(text, size), y: yPos, size, font, color })
  }

  // HISTORIAL DE PAGOS column layout. FECHA/MÉTODO/REFERENCIA stay
  // left-aligned; MONTO and the new running-balance SALDO column are
  // right-aligned to their own slots so multi-digit amounts never overlap.
  // Widths were sized against the longest realistic content at 9pt: dates
  // (~50pt), "Tarjeta Credito" (~75pt), and currency strings up to
  // "$ 1.234.567,89" (~66pt) — all comfortably inside their slots, with
  // colMontoR to colSaldoR alone leaving 130pt of breathing room.
  const colFechaX = margin + 10 // 50
  const colMetodoX = margin + 90 // 130
  const colRefX = margin + 175 // 215
  const colMontoR = margin + 385 // 425 — right edge of the MONTO column
  const colSaldoR = width - margin // 555 — right edge of the SALDO column, flush with the table's right border
  const drawPagosTableHeader = (pg: typeof page, yPos: number) => {
    pg.drawText("FECHA", { x: colFechaX, y: yPos, size: TYPE.small, font: helveticaBold, color: MONO.label })
    pg.drawText("MÉTODO", { x: colMetodoX, y: yPos, size: TYPE.small, font: helveticaBold, color: MONO.label })
    pg.drawText("REFERENCIA", { x: colRefX, y: yPos, size: TYPE.small, font: helveticaBold, color: MONO.label })
    drawTextRight(pg, "MONTO", colMontoR, yPos, TYPE.small, helveticaBold, MONO.label)
    drawTextRight(pg, "SALDO", colSaldoR, yPos, TYPE.small, helveticaBold, MONO.label)
  }

  // Starts a fresh A4 page for a table (or block) that ran out of room on
  // the current one: draws the "REMITO {numero} — continuación" marker,
  // resets the cursor, and — when given a table header drawer — re-draws
  // that table's column header row so the continued rows stay legible.
  const startContinuationPage = (drawTableHeader?: (pg: typeof page, yPos: number) => void): void => {
    page = pdfDoc.addPage([width, height])
    pages.push(page)
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
  // CONDICIONES DE PAGO joins this kept-together tail block (drawn right
  // after ESTADO DE PAGO, below) so it never gets split from
  // DETALLE/SALDO/ESTADO DE PAGO across a page break.
  const condicionesRows =
    (vencimientoText ? 1 : 0) +
    (mediosPago ? 1 : 0) +
    (cbuAlias ? 1 : 0)
  const hasCondiciones = condicionesRows > 0
  // 24 = section label+rule (4 + 20), same cost as the DETALLE/ESTADO DE
  // PAGO headers below; 12 per present row (Vencimiento/Medios de
  // pago/CBU-Alias); 10 = trailing gap before HISTORIAL DE PAGOS. Zero when
  // no payment-terms field is present.
  const condicionesBlockH = hasCondiciones ? 24 + 12 * condicionesRows + 10 : 0
  // 177 = DETALLE label+rule (24) + Subtotal row+rule (18) + pre-total rule
  // (10) + TOTAL row (18) + Pagado a cuenta row (18) + SALDO bar (35) +
  // ESTADO DE PAGO label+rule (24) + badge/montos row (30), plus 18 for
  // each optional Subtotal-block row (IVA / Descuento / Redondeo), plus
  // condicionesBlockH for the optional CONDICIONES DE PAGO section.
  const totalsBlockH = 177 + 18 * detalleOptionalRows + condicionesBlockH // DETALLE + TOTAL + PAGADO A CUENTA + SALDO + ESTADO DE PAGO + CONDICIONES DE PAGO
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

  // Total — plain bold row, no fill. The money block's visual weight now
  // goes to SALDO PENDIENTE below: TOTAL is what was billed, not what's
  // still owed.
  page.drawText("TOTAL", { x: margin + 10, y, size: TYPE.total, font: helveticaBold, color: MONO.ink })
  page.drawText(formatCurrencyPDF(data.total), { x: width - margin - 100, y, size: TYPE.total, font: helveticaBold, color: MONO.ink })
  y -= 18
  drawRule(page, margin, width - margin, y + 10)

  // Pagado a cuenta — always rendered, even when nothing has been paid yet.
  page.drawText("Pagado a cuenta", { x: margin + 10, y, size: TYPE.body, font: helvetica, color: MONO.label })
  page.drawText(formatCurrencyPDF(data.montoAbonado), { x: width - margin - 100, y, size: TYPE.body, font: helvetica, color: MONO.ink })
  y -= 18

  // Saldo pendiente — the MONO.totalBg fill (the only allowed area fill)
  // moves here from TOTAL: this is the accounting-grade remito's
  // protagonist figure, what the client still owes.
  const saldo = Math.max(0, pendiente)
  const saldoLabel = saldo === 0 ? "SALDO" : "SALDO PENDIENTE"
  page.drawRectangle({ x: margin, y: y - 8, width: contentWidth, height: 28, color: MONO.totalBg })
  page.drawText(saldoLabel, { x: margin + 10, y, size: TYPE.total, font: helveticaBold, color: MONO.ink })
  page.drawText(formatCurrencyPDF(saldo), { x: width - margin - 100, y, size: TYPE.total, font: helveticaBold, color: MONO.ink })
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

  // === CONDICIONES DE PAGO ===
  // Accounting-grade remito payment terms — drawn only when at least one
  // field is present. Its height was already reserved in totalsBlockH
  // above (condicionesBlockH), so it's kept together with
  // DETALLE/SALDO/ESTADO DE PAGO across the continuation-page check.
  if (hasCondiciones) {
    drawSectionLabel(page, helveticaBold, "Condiciones de pago", margin, y)
    y -= 4
    drawRule(page, margin, width - margin, y)
    y -= 20

    if (vencimientoText) {
      page.drawText(`Vencimiento: ${vencimientoText}`, { x: margin + 10, y, size: TYPE.small, font: helvetica, color: MONO.ink })
      y -= 12
    }
    if (mediosPago) {
      page.drawText(`Medios de pago: ${mediosPago}`, { x: margin + 10, y, size: TYPE.small, font: helvetica, color: MONO.ink })
      y -= 12
    }
    if (cbuAlias) {
      page.drawText(`CBU/Alias: ${cbuAlias}`, { x: margin + 10, y, size: TYPE.small, font: helvetica, color: MONO.ink })
      y -= 12
    }
    y -= 10
  }

  // === HISTORIAL DE PAGOS ===
  if (data.pagos && data.pagos.length > 0) {
    // Keep the section label + column header together: a dangling header
    // with zero rows below it is worse than starting the whole section on
    // a fresh page.
    const pagosHeaderH = 4 + 20 + 8 + 17 + 18
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
    // Running balance for the SALDO column: starts at the document total
    // and subtracts each pago's monto in the same order the rows are
    // drawn (data.pagos' own order — this is a display running total, not
    // a chronological reconciliation).
    let saldoCorrido = data.total
    for (const pago of data.pagos) {
      if (y - 18 < floorY) {
        startContinuationPage(drawPagosTableHeader)
      }

      const pagoFecha = formatDatePDF(pago.fecha)
      const pagoMetodo = metodoPagoFacturaLabels[pago.metodoPago] || pago.metodoPago
      const pagoRef = safe(pago.referencia)
      saldoCorrido -= pago.monto

      page.drawText(pagoFecha, { x: colFechaX, y, size: TYPE.body, font: helvetica, color: MONO.ink })
      page.drawText(pagoMetodo, { x: colMetodoX, y, size: TYPE.body, font: helvetica, color: MONO.ink })
      if (pagoRef) {
        page.drawText(pagoRef.substring(0, 16), { x: colRefX, y, size: TYPE.body, font: helvetica, color: MONO.label })
      }
      drawTextRight(page, formatCurrencyPDF(pago.monto), colMontoR, y, TYPE.body, helveticaBold, MONO.ink)
      drawTextRight(page, formatCurrencyPDF(saldoCorrido), colSaldoR, y, TYPE.body, helveticaBold, MONO.ink)
      y -= 18
      drawRule(page, margin, width - margin, y + 10)
    }
  }

  // === RECIBÍ CONFORME (orden-sourced only) ===
  // Physical signature block confirming the client received the repaired
  // device/service — a venta-sourced remito is a POS sale receipt with no
  // handoff signature workflow, so this is drawn only when data.orden is
  // present. Follows the same "kept together" discipline as CONDICIONES DE
  // PAGO above: its full height is checked against the remaining page
  // space right before drawing, so it never gets split across a page
  // break.
  if (data.orden) {
    // 24 = section label+rule (4 + 20), same cost as CONDICIONES DE PAGO's
    // header; 30 = blank space left above each underline for the physical
    // signature; 10 = gap between the underline and its caption; 12 =
    // trailing clearance before the footer.
    const recibiConformeBlockH = 24 + 30 + 10 + 12
    if (y - recibiConformeBlockH < floorY) {
      startContinuationPage()
    }

    drawSectionLabel(page, helveticaBold, "Recibí conforme", margin, y)
    y -= 4
    drawRule(page, margin, width - margin, y)
    y -= 20

    // Two signature columns side by side within contentWidth, symmetric
    // 10pt padding on both outer edges (matches the 10pt inset used by
    // CLIENTE/EQUIPO above) with a 20pt gap between them.
    const sigLineY = y - 30
    const sigColW = (contentWidth - 40) / 2
    const sigCol1X = margin + 10
    const sigCol2X = sigCol1X + sigColW + 20

    drawRule(page, sigCol1X, sigCol1X + sigColW, sigLineY, { color: MONO.ink })
    page.drawText("Firma", { x: sigCol1X, y: sigLineY - 10, size: TYPE.fine, font: helvetica, color: MONO.label })

    drawRule(page, sigCol2X, sigCol2X + sigColW, sigLineY, { color: MONO.ink })
    page.drawText("Aclaración", { x: sigCol2X, y: sigLineY - 10, size: TYPE.fine, font: helvetica, color: MONO.label })

    y = sigLineY - 10 - 12
  }

  // === FOOTER (drawn on every page, so a multi-page remito never leaves a
  // continuation page blank at the bottom) ===
  const footerY = margin + 50
  const fechaImpresion = formatDateTimeValue(new Date(), data.zonaHoraria || DEFAULT_TIMEZONE)
  const totalPages = pages.length

  for (let i = 0; i < pages.length; i++) {
    const pg = pages[i]
    drawRule(pg, margin, width - margin, footerY)
    pg.drawText("Remito interno — no válido como comprobante fiscal.", { x: margin, y: footerY - 15, size: TYPE.fine, font: helvetica, color: MONO.faint })
    pg.drawText(`Impreso: ${fechaImpresion}`, { x: width - margin - 110, y: footerY - 27, size: 7, font: helvetica, color: MONO.faint })
    if (totalPages > 1) {
      const pgText = `Página ${String(i + 1)} de ${String(totalPages)}`
      const pgW = helvetica.widthOfTextAtSize(pgText, TYPE.small)
      pg.drawText(pgText, { x: width - margin - pgW, y: footerY - 15, size: TYPE.small, font: helvetica, color: MONO.faint })
    }
  }

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
