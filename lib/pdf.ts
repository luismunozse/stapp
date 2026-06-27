import { PDFDocument as PDFLib, rgb, StandardFonts } from "pdf-lib"
import fontkitModule from "@pdf-lib/fontkit"
import { readFile } from "fs/promises"
import { join } from "path"
import { formatCurrencyValue, type CurrencyCode, DEFAULT_CURRENCY } from "@/lib/currency"
import { formatDateValue, formatDateTimeValue, DEFAULT_TIMEZONE } from "@/lib/timezone"
import { parseRecepcionTerminos } from "@/lib/terminos"
import QRCode from "qrcode"
import { resolveTerminologia, t, type Terminologia } from "@/lib/terminologia"

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

  // Colors
  const accent = rgb(0.290, 0.310, 0.890)    // #4a4fe3 - slightly deeper indigo
  const accentLight = rgb(0.925, 0.930, 0.985) // #ecedfc
  const dark = rgb(0.098, 0.094, 0.259)       // #191842
  const textDark = rgb(0.118, 0.161, 0.231)   // #1e293b
  const textMuted = rgb(0.392, 0.455, 0.545)  // #64748b
  const border = rgb(0.850, 0.875, 0.910)     // #d9dfe8
  const bgLight = rgb(0.965, 0.973, 0.984)    // #f7f8fb
  const white = rgb(1, 1, 1)
  const green = rgb(0.086, 0.627, 0.322)      // #16a34a
  const warnBg = rgb(1, 0.976, 0.922)         // #fff9eb
  const warnBorder = rgb(0.933, 0.580, 0.027) // #ee9407
  const warnText = rgb(0.573, 0.251, 0.055)   // #92400e
  const notesBg = rgb(0.945, 0.961, 0.976)    // #f1f5f9
  const notesText = rgb(0.278, 0.333, 0.412)  // #475569

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

  // Helper to center text
  const drawTextCenter = (pg: ReturnType<typeof pdfDoc.addPage>, text: string, x: number, boxW: number, y: number, size: number, font: typeof helvetica, color: ReturnType<typeof rgb>) => {
    const w = font.widthOfTextAtSize(text, size)
    pg.drawText(text, { x: x + (boxW - w) / 2, y, size, font, color })
  }

  // Draw footer on a page
  const drawFooter = (pg: ReturnType<typeof pdfDoc.addPage>, pageNum: number, totalPages: number) => {
    pg.drawLine({ start: { x: marginL, y: 45 }, end: { x: pageW - marginR, y: 45 }, thickness: 0.5, color: border })
    pg.drawText(
      firmaAprobacion ? "Documento aprobado por el cliente" : "Gracias por su confianza",
      { x: marginL, y: 32, size: 8, font: helvetica, color: textMuted }
    )
    const brandW = helveticaBold.widthOfTextAtSize(empresaNombre, 8)
    pg.drawText(empresaNombre, { x: pageW - marginR - brandW, y: 32, size: 8, font: helveticaBold, color: accent })
    if (totalPages > 1) {
      const pgText = `Pagina ${String(pageNum)} de ${String(totalPages)}`
      const pgW = helvetica.widthOfTextAtSize(pgText, 7)
      pg.drawText(pgText, { x: (pageW - pgW) / 2, y: 20, size: 7, font: helvetica, color: textMuted })
    }
    // Bottom accent bar
    pg.drawRectangle({ x: 0, y: 0, width: pageW, height: 5, color: accent })
  }

  // ====== PAGE 1 ======
  let page = pdfDoc.addPage([pageW, pageH])

  // Top accent bar
  page.drawRectangle({ x: 0, y: pageH - 6, width: pageW, height: 6, color: accent })

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

  // Calculate text block height: company name (18pt) + details line (8pt) + gap
  const nameSize = 18
  const detailSize = 8
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
  page.drawText(empresaNombre, { x: marginL + logoOffset, y: textTopY, size: nameSize, font: helveticaBold, color: dark })
  if (companyDetails.length > 0) {
    page.drawText(companyDetails.join("  |  "), { x: marginL + logoOffset, y: textTopY - nameSize - 2, size: detailSize, font: helvetica, color: textMuted })
  }

  // COTIZACION badge + number (right side)
  const badgeText = "COTIZACIÓN"
  const badgeW = helveticaBold.widthOfTextAtSize(badgeText, 10) + 28
  const badgeH = 22
  const badgeX = pageW - marginR - badgeW
  const badgeY = pageH - 38
  // Rounded badge effect
  page.drawRectangle({ x: badgeX, y: badgeY, width: badgeW, height: badgeH, color: accent })
  drawTextCenter(page, badgeText, badgeX, badgeW, badgeY + 6, 10, helveticaBold, white)

  // Number and date below badge
  drawTextRight(page, cotizacionNumber, pageW - marginR, badgeY - 20, 16, helveticaBold, dark)
  drawTextRight(page, cotizacionDate, pageW - marginR, badgeY - 34, 9, helvetica, textMuted)
  if (fechaVencimiento) {
    drawTextRight(page, `Vence: ${fechaVencimiento}`, pageW - marginR, badgeY - 47, 8, helvetica, warnText)
  }

  // Separator line
  cursor = pageH - 100
  page.drawLine({ start: { x: marginL, y: cursor }, end: { x: pageW - marginR, y: cursor }, thickness: 0.5, color: border })
  cursor -= 20

  // ---- Info cards ----
  // Si la cotización tiene equipo (PRESUPUESTO) lo dibujamos como card de equipo
  // reemplazando el mini-card de orden. Si es ORDEN ligada, sigue el layout original.
  const equipo = data.equipo
  const hasEquipo = !!equipo
  const hasOrden = !!data.orden && !hasEquipo
  const hasRightCard = hasEquipo || hasOrden
  const cardGap = 12
  const cardW = hasRightCard ? (contentWidth - cardGap) / 2 : contentWidth

  // Calculate client card height
  const clienteLines = 2 + (clienteEmail ? 1 : 0) + (clienteDireccion ? 1 : 0) + (sectorNombre ? 1 : 0)
  const clienteCardH = 20 + clienteLines * 16

  // Client card
  page.drawRectangle({ x: marginL, y: cursor - clienteCardH, width: cardW, height: clienteCardH, color: bgLight, borderColor: border, borderWidth: 0.5 })
  page.drawRectangle({ x: marginL, y: cursor - clienteCardH, width: 3, height: clienteCardH, color: accent })

  let cy = cursor - 15
  page.drawText("CLIENTE", { x: marginL + 14, y: cy, size: 9, font: helveticaBold, color: accent })
  cy -= 16
  page.drawText(clienteNombre.substring(0, 40), { x: marginL + 14, y: cy, size: 10, font: helveticaBold, color: textDark })
  cy -= 15
  if (clienteTelefono) {
    page.drawText(`Tel: ${clienteTelefono}`, { x: marginL + 14, y: cy, size: 9, font: helvetica, color: textMuted })
    cy -= 15
  }
  if (clienteEmail) {
    page.drawText(clienteEmail.substring(0, 35), { x: marginL + 14, y: cy, size: 9, font: helvetica, color: textMuted })
    cy -= 15
  }
  if (clienteDireccion) {
    page.drawText(clienteDireccion.substring(0, 40), { x: marginL + 14, y: cy, size: 9, font: helvetica, color: textMuted })
    cy -= 15
  }
  if (sectorNombre) {
    page.drawText(`Sector: ${sectorNombre.substring(0, 30)}`, { x: marginL + 14, y: cy, size: 9, font: helveticaBold, color: notesText })
  }

  // Equipo card (PRESUPUESTO) — tiene prioridad sobre el mini-card de orden.
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

    // Líneas: titulo + dispositivo/marca + color/modelo + imei/serie + problema (2 líneas)
    const extraLines =
      (equipoMarca || equipoModelo ? 1 : 0) +
      (equipoColor ? 1 : 0) +
      (equipoImei || equipoSerie ? 1 : 0)
    const equipoCardH = Math.max(clienteCardH, 75 + extraLines * 14)

    page.drawRectangle({ x: ox, y: cursor - equipoCardH, width: cardW, height: equipoCardH, color: bgLight, borderColor: border, borderWidth: 0.5 })
    page.drawRectangle({ x: ox, y: cursor - equipoCardH, width: 3, height: equipoCardH, color: accent })

    let oy = cursor - 15
    page.drawText("EQUIPO", { x: ox + 14, y: oy, size: 9, font: helveticaBold, color: accent })
    oy -= 18
    page.drawText(equipoDispositivo.substring(0, 38), { x: ox + 14, y: oy, size: 10, font: helveticaBold, color: textDark })
    oy -= 14

    if (equipoMarca || equipoModelo) {
      const txt = [equipoMarca, equipoModelo].filter(Boolean).join(" · ")
      page.drawText(txt.substring(0, 40), { x: ox + 14, y: oy, size: 8, font: helvetica, color: textMuted })
      oy -= 13
    }
    if (equipoColor) {
      page.drawText(`Color: ${equipoColor}`.substring(0, 40), { x: ox + 14, y: oy, size: 8, font: helvetica, color: textMuted })
      oy -= 13
    }
    if (equipoImei || equipoSerie) {
      const txt = equipoImei ? `IMEI: ${equipoImei}` : `N° serie: ${equipoSerie}`
      page.drawText(txt.substring(0, 40), { x: ox + 14, y: oy, size: 8, font: helvetica, color: textMuted })
      oy -= 13
    }

    oy -= 2
    page.drawText("Problema reportado", { x: ox + 14, y: oy, size: 8, font: helvetica, color: textMuted })
    oy -= 12
    page.drawText(equipoProblema.substring(0, 45), { x: ox + 14, y: oy, size: 9, font: helvetica, color: textDark })

    rightCardH = equipoCardH
  } else if (data.orden) {
    const ox = marginL + cardW + cardGap
    const ordenCardH = Math.max(clienteCardH, 75)
    page.drawRectangle({ x: ox, y: cursor - ordenCardH, width: cardW, height: ordenCardH, color: bgLight, borderColor: border, borderWidth: 0.5 })
    page.drawRectangle({ x: ox, y: cursor - ordenCardH, width: 3, height: ordenCardH, color: accent })

    let oy = cursor - 15
    page.drawText(`ORDEN #${safe(data.orden.numeroOrden)}`, { x: ox + 14, y: oy, size: 9, font: helveticaBold, color: accent })
    oy -= 18
    page.drawText("Equipo", { x: ox + 14, y: oy, size: 8, font: helvetica, color: textMuted })
    oy -= 13
    page.drawText(safe(data.orden.dispositivo).substring(0, 35), { x: ox + 14, y: oy, size: 9, font: helveticaBold, color: textDark })
    oy -= 16
    page.drawText("Problema reportado", { x: ox + 14, y: oy, size: 8, font: helvetica, color: textMuted })
    oy -= 13
    page.drawText(safe(data.orden.problemaReportado).substring(0, 45), { x: ox + 14, y: oy, size: 9, font: helvetica, color: textDark })

    rightCardH = ordenCardH
  }

  cursor -= Math.max(clienteCardH, rightCardH || clienteCardH) + 20

  // ====== ITEMS TABLE ======
  // Table column positions (right edge for right-aligned columns)
  const colDesc = marginL + 10
  const colCantR = marginL + 310
  const colUnitR = marginL + 400
  const colSubR = pageW - marginR - 10

  // Table header with integrated title
  const headerH = 24
  page.drawRectangle({ x: marginL, y: cursor - 4, width: contentWidth, height: headerH, color: accent })
  page.drawText("Descripción", { x: colDesc, y: cursor + 2, size: 8, font: helveticaBold, color: white })
  drawTextRight(page, "Cant.", colCantR, cursor + 2, 8, helveticaBold, white)
  drawTextRight(page, "P. Unitario", colUnitR, cursor + 2, 8, helveticaBold, white)
  drawTextRight(page, "Subtotal", colSubR, cursor + 2, 8, helveticaBold, white)
  cursor -= headerH + 2

  // Table rows with multi-page support
  const items = Array.isArray(data.items) ? data.items : []
  const rowH = 22
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
        page.drawRectangle({ x: 0, y: pageH - 4, width: pageW, height: 4, color: accent })
        cursor = pageH - 30

        // Re-draw table header on new page
        page.drawRectangle({ x: marginL, y: cursor - 4, width: contentWidth, height: headerH, color: accent })
        page.drawText("Descripción", { x: colDesc, y: cursor + 2, size: 8, font: helveticaBold, color: white })
        drawTextRight(page, "Cant.", colCantR, cursor + 2, 8, helveticaBold, white)
        drawTextRight(page, "P. Unitario", colUnitR, cursor + 2, 8, helveticaBold, white)
        drawTextRight(page, "Subtotal", colSubR, cursor + 2, 8, helveticaBold, white)
        cursor -= headerH + 2
      }
    }

    const item = items[i]
    const unitPrice = Number(item.precioUnitario || item.precio_unitario) || 0
    const unidad = safe(item.unidad) || "Unidad"
    const cantLabel = `${String(item.cantidad || 0)}${unidad !== "Unidad" ? ` ${unidad}` : ""}`.trim()
    const itemSubtotal = Number(item.subtotal) || 0

    // Alternating row background
    if (i % 2 === 0) {
      page.drawRectangle({ x: marginL, y: cursor - 5, width: contentWidth, height: rowH, color: bgLight })
    }

    // Description - allow longer text
    const tipoRep = safe(item.tipo_repuesto || item.tipoRepuesto)
    const tipoRepLabel = tipoRep && tipoRep !== "NO_APLICA"
      ? ` [${tipoRep === "ALTERNATIVO" ? "ALT" : tipoRep === "RECICLADO" ? "REC" : "ORIG"}]`
      : ""
    const descText = (safe(item.descripcion) + tipoRepLabel).substring(0, 60)
    page.drawText(descText, { x: colDesc, y: cursor + 1, size: 9, font: helvetica, color: textDark })

    // Item discount indicator
    const itemDescTipo = safe(item.descuento_tipo || item.descuentoTipo)
    const itemDescValor = Number(item.descuento_valor || item.descuentoValor) || 0
    if (itemDescValor > 0) {
      const discText = itemDescTipo === "porcentaje" ? `(-${String(itemDescValor)}%)` : `(-${fmtCurrency(itemDescValor)})`
      page.drawText(discText, { x: colDesc, y: cursor - 9, size: 7, font: helvetica, color: green })
    }

    // Right-aligned numeric columns
    drawTextRight(page, cantLabel, colCantR, cursor + 1, 9, helvetica, textDark)
    drawTextRight(page, fmtCurrency(unitPrice), colUnitR, cursor + 1, 9, helvetica, textDark)
    drawTextRight(page, fmtCurrency(itemSubtotal), colSubR, cursor + 1, 9, helveticaBold, textDark)

    cursor -= rowH
    // Row separator
    page.drawLine({ start: { x: marginL, y: cursor + rowH / 2 - 2 }, end: { x: pageW - marginR, y: cursor + rowH / 2 - 2 }, thickness: 0.3, color: border })
  }

  // Bottom border of table
  page.drawLine({ start: { x: marginL, y: cursor + rowH / 2 - 2 }, end: { x: pageW - marginR, y: cursor + rowH / 2 - 2 }, thickness: 1, color: border })
  cursor -= 18

  // ====== TOTALS SECTION ======
  const totalsW = 230
  const totalsX = pageW - marginR - totalsW

  // Calculate totals box height dynamically
  let totalsLines = 2 // subtotal + total
  if (descGlobalAmount > 0) totalsLines++
  if (ivaPct > 0) totalsLines++
  const totalsBoxH = totalsLines * 20 + 25

  // Totals box with accent left border
  page.drawRectangle({ x: totalsX, y: cursor - totalsBoxH, width: totalsW, height: totalsBoxH, color: bgLight, borderColor: border, borderWidth: 0.5 })

  let totY = cursor - 16
  const labelX = totalsX + 15
  const valueX = totalsX + totalsW - 15

  // Subtotal
  page.drawText("Subtotal", { x: labelX, y: totY, size: 9, font: helvetica, color: textMuted })
  drawTextRight(page, fmtCurrency(subtotalNum), valueX, totY, 10, helvetica, textDark)
  totY -= 18

  // Discount
  if (descGlobalAmount > 0) {
    const descLabel = descGlobalTipo === "porcentaje" ? `Descuento (${String(descGlobalValor)}%)` : "Descuento"
    page.drawText(descLabel, { x: labelX, y: totY, size: 9, font: helvetica, color: textMuted })
    drawTextRight(page, `-${fmtCurrency(descGlobalAmount)}`, valueX, totY, 10, helvetica, green)
    totY -= 18
  }

  // IVA
  if (ivaPct > 0) {
    page.drawText(`IVA (${String(ivaPct)}%)`, { x: labelX, y: totY, size: 9, font: helvetica, color: textMuted })
    drawTextRight(page, fmtCurrency(ivaNum), valueX, totY, 10, helvetica, textDark)
    totY -= 18
  }

  // Total line separator
  page.drawLine({ start: { x: labelX, y: totY + 10 }, end: { x: valueX, y: totY + 10 }, thickness: 1.5, color: accent })

  // Total row with accent background
  const totalRowH = 28
  page.drawRectangle({ x: totalsX, y: cursor - totalsBoxH, width: totalsW, height: totalRowH, color: accent })
  page.drawText("TOTAL", { x: labelX, y: cursor - totalsBoxH + 9, size: 12, font: helveticaBold, color: white })
  drawTextRight(page, fmtCurrency(totalNum), valueX, cursor - totalsBoxH + 9, 13, helveticaBold, white)

  cursor -= totalsBoxH + 12

  // ====== VALIDITY BANNER ======
  if (fechaVencimiento) {
    const bannerH = 26
    page.drawRectangle({ x: marginL, y: cursor - bannerH, width: contentWidth, height: bannerH, color: warnBg, borderColor: warnBorder, borderWidth: 0.5 })
    page.drawRectangle({ x: marginL, y: cursor - bannerH, width: 3, height: bannerH, color: warnBorder })
    const validText = `Cotizacion valida hasta el ${fechaVencimiento}`
    const validW = helvetica.widthOfTextAtSize(validText, 9)
    page.drawText(validText, { x: marginL + (contentWidth - validW) / 2, y: cursor - bannerH + 9, size: 9, font: helveticaBold, color: warnText })
    cursor -= bannerH + 8
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

    // Altura estimada: 22 de header + por categoria (12 titulo + 11 por item) + notas
    let estH = 22
    for (const cat of Object.keys(byCat)) {
      estH += 14
      estH += byCat[cat].length * 12
    }
    if (chk.notas) estH += 20

    // Si no entra en la página actual, crear una nueva
    if (cursor - estH < minY) {
      page = pdfDoc.addPage([pageW, pageH])
      pages.push(page)
      page.drawRectangle({ x: 0, y: pageH - 4, width: pageW, height: 4, color: accent })
      cursor = pageH - 30
    }

    page.drawRectangle({ x: marginL, y: cursor - estH, width: contentWidth, height: estH, color: notesBg, borderColor: border, borderWidth: 0.5 })
    page.drawText("CHECKLIST DE RECEPCIÓN", { x: marginL + 12, y: cursor - 14, size: 8, font: helveticaBold, color: notesText })
    let chY = cursor - 28

    const labelsByCat: Record<string, string> = {
      CONDICION_FISICA: "Condición física",
      ACCESORIOS: "Accesorios",
      FUNCIONAL: "Estado funcional",
      GENERAL: "General",
    }

    for (const [cat, items] of Object.entries(byCat)) {
      page.drawText(labelsByCat[cat] || cat, { x: marginL + 12, y: chY, size: 8, font: helveticaBold, color: textDark })
      chY -= 12
      for (const it of items) {
        const line = `• ${it.label}: ${it.valor}`.substring(0, 95)
        page.drawText(line, { x: marginL + 18, y: chY, size: 7.5, font: helvetica, color: textMuted })
        chY -= 11
      }
      chY -= 2
    }

    if (chk.notas) {
      page.drawText(`Observaciones: ${safe(chk.notas)}`.substring(0, 100), {
        x: marginL + 12, y: chY, size: 7.5, font: helvetica, color: textMuted,
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
        if (helvetica.widthOfTextAtSize(dLine + " " + word, 8) < contentWidth - 100) {
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
      const estH = 20 + (diagLines.length > 0 ? (14 + diagLines.length * 11 + 4) : 0) + condRows.length * 12 + 6

      if (cursor - estH < minY) {
        page = pdfDoc.addPage([pageW, pageH])
        pages.push(page)
        page.drawRectangle({ x: 0, y: pageH - 4, width: pageW, height: 4, color: accent })
        cursor = pageH - 30
      }

      page.drawRectangle({ x: marginL, y: cursor - estH, width: contentWidth, height: estH, color: notesBg, borderColor: border, borderWidth: 0.5 })
      page.drawText("CONDICIONES TÉCNICAS", { x: marginL + 12, y: cursor - 14, size: 8, font: helveticaBold, color: notesText })
      let cY = cursor - 28

      if (diagLines.length > 0) {
        page.drawText("Diagnóstico:", { x: marginL + 12, y: cY, size: 8, font: helveticaBold, color: textDark })
        cY -= 12
        for (const l of diagLines.slice(0, 4)) {
          page.drawText(l, { x: marginL + 18, y: cY, size: 7.5, font: helvetica, color: textMuted })
          cY -= 11
        }
        cY -= 4
      }

      for (const row of condRows) {
        page.drawText(row.label, { x: marginL + 12, y: cY, size: 8, font: helveticaBold, color: textDark })
        page.drawText(row.value, { x: marginL + 110, y: cY, size: 8, font: helvetica, color: textMuted })
        cY -= 12
      }

      cursor -= estH + 8
    }
  }

  // ====== NOTAS ======
  if (notas) {
    // Word-wrap notas
    const notaLines: string[] = []
    let nLine = ""
    for (const word of notas.split(" ")) {
      if (helvetica.widthOfTextAtSize(nLine + " " + word, 8) < contentWidth - 28) {
        nLine += (nLine ? " " : "") + word
      } else {
        notaLines.push(nLine)
        nLine = word
      }
    }
    if (nLine) notaLines.push(nLine)
    const notaBoxH = Math.max(32, notaLines.length * 12 + 22)
    page.drawRectangle({ x: marginL, y: cursor - notaBoxH, width: contentWidth, height: notaBoxH, color: notesBg, borderColor: border, borderWidth: 0.5 })
    page.drawText("OBSERVACIONES", { x: marginL + 12, y: cursor - 14, size: 8, font: helveticaBold, color: notesText })
    let nY = cursor - 28
    for (const l of notaLines.slice(0, 4)) {
      page.drawText(l, { x: marginL + 12, y: nY, size: 8, font: helvetica, color: textMuted })
      nY -= 12
    }
    cursor -= notaBoxH + 6
  }

  // ====== TERMINOS ======
  if (terminos) {
    const tLines: string[] = []
    let tLine = ""
    for (const word of terminos.split(" ")) {
      if (helvetica.widthOfTextAtSize(tLine + " " + word, 7.5) < contentWidth - 28) {
        tLine += (tLine ? " " : "") + word
      } else {
        tLines.push(tLine)
        tLine = word
      }
    }
    if (tLine) tLines.push(tLine)
    const tBoxH = Math.max(32, tLines.length * 11 + 22)
    page.drawRectangle({ x: marginL, y: cursor - tBoxH, width: contentWidth, height: tBoxH, color: notesBg, borderColor: border, borderWidth: 0.5 })
    page.drawText("TÉRMINOS Y CONDICIONES", { x: marginL + 12, y: cursor - 14, size: 8, font: helveticaBold, color: notesText })
    let tY = cursor - 27
    for (const l of tLines.slice(0, 8)) {
      page.drawText(l, { x: marginL + 12, y: tY, size: 7.5, font: helvetica, color: textMuted })
      tY -= 11
    }
    cursor -= tBoxH + 8
  }

  // ====== FIRMA (if approved) ======
  if (firmaAprobacion && firmaMime) {
    try {
      const sigBytes = Uint8Array.from(atob(firmaAprobacion), c => c.charCodeAt(0))
      const sigImg = firmaMime.includes("png")
        ? await pdfDoc.embedPng(sigBytes)
        : await pdfDoc.embedJpg(sigBytes)
      const ss = sigImg.scale(1)
      const ratio = Math.min(120 / ss.width, 50 / ss.height)
      const sigW = ss.width * ratio
      const sigH = ss.height * ratio
      const sigX = pageW - marginR - 90 - sigW / 2
      page.drawImage(sigImg, { x: sigX, y: cursor - sigH, width: sigW, height: sigH })
      cursor -= sigH + 5
    } catch { /* ignore sig errors */ }
    page.drawLine({ start: { x: pageW - marginR - 180, y: cursor }, end: { x: pageW - marginR, y: cursor }, thickness: 0.5, color: textMuted })
    page.drawText("Firma del Cliente", { x: pageW - marginR - 130, y: cursor - 12, size: 8, font: helvetica, color: textMuted })
    if (fechaAprobacion) {
      page.drawText(`Aprobado: ${fechaAprobacion}`, { x: pageW - marginR - 130, y: cursor - 22, size: 7, font: helvetica, color: green })
    }
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

  // Colores modernos (Indigo theme)
  const primaryColor = rgb(0.388, 0.400, 0.945) // #6366f1
  const textColor = rgb(0.118, 0.161, 0.231) // #1e293b
  const grayColor = rgb(0.392, 0.455, 0.545) // #64748b
  const lightGray = rgb(0.886, 0.910, 0.941) // #e2e8f0
  const bgGray = rgb(0.973, 0.980, 0.988) // #f8fafc
  const slateLight = rgb(0.945, 0.953, 0.965) // #f1f5f9
  const yellowBg = rgb(0.996, 0.953, 0.780) // #fef3c7
  const yellowBorder = rgb(0.961, 0.620, 0.043) // #f59e0b
  const brownColor = rgb(0.573, 0.251, 0.055) // #92400e
  const greenColor = rgb(0.134, 0.545, 0.373) // #22c55e
  const greenBg = rgb(0.863, 0.949, 0.898) // #dcfce7
  const white = rgb(1, 1, 1)

  // Margenes
  const margin = 40
  const contentWidth = width - (margin * 2)
  const cardGap = 10
  const halfWidth = (contentWidth - cardGap) / 2

  // === BARRA DE ACENTO SUPERIOR ===
  page.drawRectangle({ x: 0, y: height - 4, width, height: 4, color: primaryColor })

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
  page.drawText(empresaNombre, { x: margin, y: textStartY, size: 12, font: helveticaBold, color: textColor })

  const ordenText = `#${String(numeroOrden).padStart(4, "0")}`
  const ordenTextWidth = helveticaBold.widthOfTextAtSize(ordenText, 16)
  page.drawText(ordenText, { x: width - margin - ordenTextWidth, y: textStartY + 1, size: 16, font: helveticaBold, color: textColor })

  // Línea 2: Teléfono | Badge RECEPCIÓN
  const line2Y = textStartY - 13
  if (telefonoEmpresa) {
    page.drawText(`Tel: ${telefonoEmpresa}`, { x: margin, y: line2Y, size: 7.5, font: helvetica, color: grayColor })
  }
  const badgeText = "RECEPCIÓN"
  const badgeWidth = helveticaBold.widthOfTextAtSize(badgeText, 6) + 12
  page.drawRectangle({ x: width - margin - badgeWidth, y: line2Y - 2, width: badgeWidth, height: 12, color: primaryColor })
  page.drawText(badgeText, { x: width - margin - badgeWidth + 6, y: line2Y + 1.5, size: 6, font: helveticaBold, color: white })

  // Línea 3: Dirección completa | Fechas
  const line3Y = line2Y - 12
  const locationParts: string[] = []
  if (direccionEmpresa) locationParts.push(direccionEmpresa)
  if (ciudadEmpresa) locationParts.push(ciudadEmpresa)
  if (codigoPostalEmpresa) locationParts.push(`CP ${codigoPostalEmpresa}`)
  if (provinciaEmpresa) locationParts.push(provinciaEmpresa)
  if (locationParts.length > 0) {
    page.drawText(locationParts.join(", "), { x: margin, y: line3Y, size: 7.5, font: helvetica, color: grayColor })
  }

  const fechasText = `Ingreso: ${fechaIngreso}` + (fechaPrometida ? `  |  Entrega est.: ${fechaPrometida}` : "")
  const fechasW = helvetica.widthOfTextAtSize(fechasText, 6.5)
  page.drawText(fechasText, { x: width - margin - fechasW, y: line3Y, size: 6.5, font: helvetica, color: grayColor })

  y -= headerH + 4
  // Línea separadora + título
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.75, color: primaryColor })
  y -= 11
  const titleText = "COMPROBANTE DE RECEPCIÓN"
  const titleWidth = helveticaBold.widthOfTextAtSize(titleText, 9)
  page.drawText(titleText, { x: (width - titleWidth) / 2, y, size: 9, font: helveticaBold, color: primaryColor })
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

  // Card Cliente
  page.drawRectangle({ x: margin, y: y - cardHeight, width: halfWidth, height: cardHeight, color: white, borderColor: lightGray, borderWidth: 0.5 })
  page.drawRectangle({ x: margin, y: y - cardHeight, width: 3, height: cardHeight, color: primaryColor })
  page.drawRectangle({ x: margin + 3, y: y - 17, width: halfWidth - 3, height: 17, color: bgGray })
  page.drawText("CLIENTE", { x: margin + 10, y: y - 12, size: 8, font: helveticaBold, color: primaryColor })

  let clienteInfoY = y - 30
  page.drawText("Nombre:", { x: margin + 10, y: clienteInfoY, size: 7, font: helvetica, color: grayColor })
  page.drawText(truncateToWidth(clienteNombre, valueMaxWidth, helveticaBold, 8), { x: margin + labelCol + 10, y: clienteInfoY, size: 8, font: helveticaBold, color: textColor })
  clienteInfoY -= rowH
  if (sector) {
    page.drawText("Sector:", { x: margin + 10, y: clienteInfoY, size: 7, font: helvetica, color: grayColor })
    page.drawText(truncateToWidth(sector, valueMaxWidth, helveticaBold, 8), { x: margin + labelCol + 10, y: clienteInfoY, size: 8, font: helveticaBold, color: primaryColor })
    clienteInfoY -= rowH
  }
  page.drawText("Teléfono:", { x: margin + 10, y: clienteInfoY, size: 7, font: helvetica, color: grayColor })
  page.drawText(truncateToWidth(clienteTelefono, valueMaxWidth, helvetica, 8), { x: margin + labelCol + 10, y: clienteInfoY, size: 8, font: helvetica, color: textColor })
  clienteInfoY -= rowH
  if (clienteEmail) {
    page.drawText("Email:", { x: margin + 10, y: clienteInfoY, size: 7, font: helvetica, color: grayColor })
    page.drawText(truncateToWidth(clienteEmail, valueMaxWidth, helvetica, 7), { x: margin + labelCol + 10, y: clienteInfoY, size: 7, font: helvetica, color: textColor })
    clienteInfoY -= rowH
  }
  if (clienteDireccion) {
    page.drawText("Dir:", { x: margin + 10, y: clienteInfoY, size: 7, font: helvetica, color: grayColor })
    page.drawText(truncateToWidth(clienteDireccion, valueMaxWidth, helvetica, 7), { x: margin + labelCol + 10, y: clienteInfoY, size: 7, font: helvetica, color: textColor })
  }

  // Card Dispositivo
  const cardX2 = margin + halfWidth + cardGap
  page.drawRectangle({ x: cardX2, y: y - cardHeight, width: halfWidth, height: cardHeight, color: white, borderColor: lightGray, borderWidth: 0.5 })
  page.drawRectangle({ x: cardX2, y: y - cardHeight, width: 3, height: cardHeight, color: primaryColor })
  page.drawRectangle({ x: cardX2 + 3, y: y - 17, width: halfWidth - 3, height: 17, color: bgGray })
  page.drawText(t(term, "equipo").toUpperCase(), { x: cardX2 + 10, y: y - 12, size: 8, font: helveticaBold, color: primaryColor })

  const tipoBadgeText = tipoDispositivo.toUpperCase()
  const tipoBadgeWidth = helveticaBold.widthOfTextAtSize(tipoBadgeText, 6) + 10
  const tipoBadgeX = cardX2 + halfWidth - tipoBadgeWidth - 8
  page.drawRectangle({ x: tipoBadgeX, y: y - 16, width: tipoBadgeWidth, height: 14, color: primaryColor })
  page.drawText(tipoBadgeText, { x: tipoBadgeX + 5, y: y - 12, size: 6, font: helveticaBold, color: white })

  let deviceInfoY = y - 30
  page.drawText(t(term, "equipo") + ":", { x: cardX2 + 10, y: deviceInfoY, size: 7, font: helvetica, color: grayColor })
  page.drawText(truncateToWidth(dispositivo, valueMaxWidth, helveticaBold, 8), { x: cardX2 + labelCol + 10, y: deviceInfoY, size: 8, font: helveticaBold, color: textColor })
  deviceInfoY -= rowH
  if (marca) {
    page.drawText("Marca:", { x: cardX2 + 10, y: deviceInfoY, size: 7, font: helvetica, color: grayColor })
    const marcaText = truncateToWidth(marca, colorDisp ? valueMaxWidth * 0.55 : valueMaxWidth, helvetica, 7)
    page.drawText(marcaText, { x: cardX2 + labelCol + 10, y: deviceInfoY, size: 7, font: helvetica, color: textColor })
    if (colorDisp) {
      const colorLabelX = cardX2 + halfWidth * 0.6
      page.drawText("Color:", { x: colorLabelX, y: deviceInfoY, size: 7, font: helvetica, color: grayColor })
      page.drawText(truncateToWidth(colorDisp, halfWidth - (halfWidth * 0.6) - 42, helvetica, 7), { x: colorLabelX + 32, y: deviceInfoY, size: 7, font: helvetica, color: textColor })
    }
    deviceInfoY -= rowH
  } else if (colorDisp) {
    page.drawText("Color:", { x: cardX2 + 10, y: deviceInfoY, size: 7, font: helvetica, color: grayColor })
    page.drawText(truncateToWidth(colorDisp, valueMaxWidth, helvetica, 7), { x: cardX2 + labelCol + 10, y: deviceInfoY, size: 7, font: helvetica, color: textColor })
    deviceInfoY -= rowH
  }
  if (imei) {
    page.drawText(t(term, "serie") + ":", { x: cardX2 + 10, y: deviceInfoY, size: 7, font: helvetica, color: grayColor })
    page.drawText(truncateToWidth(imei, valueMaxWidth, courier, 7), { x: cardX2 + labelCol + 10, y: deviceInfoY, size: 7, font: courier, color: textColor })
  }

  y -= cardHeight + 6

  // === PROBLEMA REPORTADO (compacto) ===
  const problemaLines: string[] = []
  let tempLine = ""
  const words = problemaReportado.split(" ")
  for (const word of words) {
    if (helvetica.widthOfTextAtSize(tempLine + " " + word, 9) < contentWidth - 20) {
      tempLine += (tempLine ? " " : "") + word
    } else {
      problemaLines.push(tempLine)
      tempLine = word
    }
  }
  if (tempLine) problemaLines.push(tempLine)
  const displayedProblemaLines = problemaLines.slice(0, 3)
  const problemaHeight = 16 + displayedProblemaLines.length * 12 + 4

  page.drawRectangle({ x: margin, y: y - problemaHeight, width: contentWidth, height: problemaHeight, color: white, borderColor: lightGray, borderWidth: 0.5 })
  page.drawRectangle({ x: margin, y: y - problemaHeight, width: 3, height: problemaHeight, color: rgb(0.918, 0.306, 0.306) })
  page.drawRectangle({ x: margin + 3, y: y - 15, width: contentWidth - 3, height: 15, color: bgGray })
  page.drawText("PROBLEMA REPORTADO", { x: margin + 10, y: y - 11, size: 8, font: helveticaBold, color: rgb(0.918, 0.306, 0.306) })

  let problemaY = y - 28
  for (const line of displayedProblemaLines) {
    page.drawText(line, { x: margin + 10, y: problemaY, size: 9, font: helvetica, color: textColor })
    problemaY -= 12
  }
  y -= problemaHeight + 4

  // === ACCESORIOS + CÓDIGO DE ACCESO (lado a lado si hay patrón) ===
  const hasAccessCode = !!codigoAccesoDispositivo
  const isPatternCode = hasAccessCode &&
    (codigoAccesoDispositivo.toLowerCase().startsWith("patrón:") ||
     codigoAccesoDispositivo.toLowerCase().startsWith("patron:"))

  if (accesorios) {
    const accWidth = isPatternCode ? halfWidth : contentWidth
    const accHeight = 18
    page.drawRectangle({ x: margin, y: y - accHeight, width: accWidth, height: accHeight, color: yellowBg, borderColor: yellowBorder, borderWidth: 0.5 })
    page.drawText("ACCESORIOS:", { x: margin + 8, y: y - 12, size: 7, font: helveticaBold, color: brownColor })
    page.drawText(truncateToWidth(accesorios, accWidth - 85, helvetica, 7), { x: margin + 75, y: y - 12, size: 7, font: helvetica, color: brownColor })
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
      page.drawRectangle({ x: patBoxX, y: y - patBoxH, width: patBoxW, height: patBoxH, color: white, borderColor: lightGray, borderWidth: 0.5 })
      page.drawRectangle({ x: patBoxX, y: y - patBoxH, width: 3, height: patBoxH, color: grayColor })
      page.drawText("CÓDIGO DE ACCESO", { x: patBoxX + 10, y: y - 10, size: 7, font: helveticaBold, color: grayColor })
      page.drawText("Patrón", { x: patBoxX + patBoxW - 40, y: y - 10, size: 6, font: helvetica, color: grayColor })

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
          page.drawLine({ start, end, thickness: 1.2, color: primaryColor })
        }
      }
      for (let num = 1; num <= 9; num++) {
        const pos = getPointPosition(num)
        const inPat = patternNumbers.includes(num)
        page.drawCircle({ x: pos.x, y: pos.y, size: dotRadius, color: inPat ? primaryColor : lightGray, borderWidth: 0 })
        if (inPat) page.drawCircle({ x: pos.x, y: pos.y, size: dotRadius - 1.2, color: white, borderWidth: 0 })
      }

      y -= Math.max(patBoxH, accesorios ? 18 : 0) + 4
    } else {
      // PIN/Contraseña en línea compacta
      const codeH = 28
      page.drawRectangle({ x: margin, y: y - codeH, width: halfWidth, height: codeH, color: white, borderColor: lightGray, borderWidth: 0.5 })
      page.drawRectangle({ x: margin, y: y - codeH, width: 3, height: codeH, color: grayColor })
      page.drawText("CÓDIGO DE ACCESO", { x: margin + 10, y: y - 10, size: 7, font: helveticaBold, color: grayColor })
      page.drawText(codigoAccesoDispositivo, { x: margin + 10, y: y - 23, size: 10, font: courier, color: textColor })
      y -= codeH + 4
    }
  }

  // === PRESUPUESTO Y SEÑA ===
  if (presupuesto || data.sena) {
    const hasSena = data.sena && data.sena > 0
    const presupuestoHeight = hasSena ? 48 : 36
    page.drawRectangle({ x: margin, y: y - presupuestoHeight, width: contentWidth, height: presupuestoHeight, color: greenBg, borderColor: greenColor, borderWidth: 1 })
    page.drawRectangle({ x: margin, y: y - presupuestoHeight, width: 4, height: presupuestoHeight, color: greenColor })
    if (presupuesto) {
      page.drawText("PRESUPUESTO ESTIMADO", { x: margin + 14, y: y - 13, size: 8, font: helveticaBold, color: greenColor })
      page.drawText(presupuesto, { x: margin + 14, y: y - 30, size: 16, font: helveticaBold, color: greenColor })
      page.drawText("* Puede variar según diagnóstico", { x: margin + 180, y: y - 30, size: 7, font: helvetica, color: grayColor })
    }
    if (hasSena) {
      const senaFormatted = formatCurrencyPDF(data.sena!)
      const senaY = presupuesto ? y - 44 : y - 13
      const metodoPago = data.metodoPagoSena || "EFECTIVO"
      page.drawText(`SEÑA ABONADA: ${senaFormatted}`, { x: margin + 14, y: senaY, size: 9, font: helveticaBold, color: greenColor })
      page.drawText(`(${metodoPago})`, { x: margin + 14 + helveticaBold.widthOfTextAtSize(`SEÑA ABONADA: ${senaFormatted}`, 9) + 6, y: senaY, size: 8, font: helvetica, color: grayColor })
    }
    y -= presupuestoHeight + 8
  }

  // === OBSERVACIONES (si hay) ===
  if (observaciones) {
    const obsLines: string[] = []
    let obsTempLine = ""
    const obsWords = observaciones.split(" ")
    for (const word of obsWords) {
      if (helvetica.widthOfTextAtSize(obsTempLine + " " + word, 9) < contentWidth - 28) {
        obsTempLine += (obsTempLine ? " " : "") + word
      } else {
        obsLines.push(obsTempLine)
        obsTempLine = word
      }
    }
    if (obsTempLine) obsLines.push(obsTempLine)
    const displayedObsLines = obsLines.slice(0, 3)
    const obsHeight = 22 + displayedObsLines.length * 13 + 6

    page.drawRectangle({ x: margin, y: y - obsHeight, width: contentWidth, height: obsHeight, color: bgGray, borderColor: lightGray, borderWidth: 1 })
    page.drawText("OBSERVACIONES", { x: margin + 12, y: y - 14, size: 8, font: helveticaBold, color: grayColor })
    let obsY = y - 30
    for (const line of displayedObsLines) {
      page.drawText(line, { x: margin + 12, y: obsY, size: 9, font: helvetica, color: textColor })
      obsY -= 13
    }
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
        page.drawRectangle({ x: margin, y: y - checklistHeight, width: contentWidth, height: checklistHeight, color: white, borderColor: lightGray, borderWidth: 1 })
        page.drawRectangle({ x: margin, y: y - checklistHeight, width: 4, height: checklistHeight, color: primaryColor })
        page.drawRectangle({ x: margin + 4, y: y - 22, width: contentWidth - 4, height: 22, color: bgGray })
        page.drawText("CHECKLIST DE RECEPCION", { x: margin + 14, y: y - 15, size: 9, font: helveticaBold, color: primaryColor })

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
            const symbolColor = item.valor === true ? greenColor : rgb(0.918, 0.306, 0.306)
            const availableW = colRightEdge - colX

            page.drawText(truncateToWidth(item.label, availableW - 30, helvetica, 7), { x: colX, y: itemY, size: 7, font: helvetica, color: grayColor })
            page.drawText(symbol, { x: colRightEdge - helveticaBold.widthOfTextAtSize(symbol, 7), y: itemY, size: 7, font: helveticaBold, color: symbolColor })
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
        page.drawRectangle({ x: margin, y: y - textBlockHeight, width: contentWidth, height: textBlockHeight, color: bgGray, borderColor: lightGray, borderWidth: 0.5 })

        let tY = y - 12
        for (const item of textItems) {
          const labelText = item.label + ":"
          const labelW = helveticaBold.widthOfTextAtSize(labelText, 7)
          page.drawText(labelText, { x: margin + 14, y: tY, size: 7, font: helveticaBold, color: grayColor })
          page.drawText(truncateToWidth(String(item.valor), maxTextW - labelW - 8, helvetica, 7), { x: margin + 14 + labelW + 6, y: tY, size: 7, font: helvetica, color: textColor })
          tY -= textRowHeight
        }
        if (notasText) {
          const notasLabel = "Notas:"
          const notasLabelW = helveticaBold.widthOfTextAtSize(notasLabel, 7)
          page.drawText(notasLabel, { x: margin + 14, y: tY, size: 7, font: helveticaBold, color: grayColor })
          page.drawText(truncateToWidth(notasText, maxTextW - notasLabelW - 8, helvetica, 7), { x: margin + 14 + notasLabelW + 6, y: tY, size: 7, font: helvetica, color: textColor })
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

    if (hasQR && hasFirma) {
      // QR a la izquierda, firma a la derecha
      try {
        const trackingUrl = `${data.baseUrl}/seguimiento/${data.publicToken}`
        const qrDataUrl = await QRCode.toDataURL(trackingUrl, {
          width: 200,
          margin: 1,
          color: { dark: "#1e293b", light: "#ffffff" }
        })
        const qrBase64 = qrDataUrl.split(",")[1]
        const qrBytes = Uint8Array.from(atob(qrBase64), c => c.charCodeAt(0))
        const qrImage = await pdfDoc.embedPng(qrBytes)
        page.drawImage(qrImage, { x: margin, y: y - qrSize, width: qrSize, height: qrSize })
        page.drawText("Escanea para ver el estado", { x: margin, y: y - qrSize - 10, size: 6, font: helvetica, color: grayColor })
        page.drawText("de tu reparación", { x: margin, y: y - qrSize - 18, size: 6, font: helvetica, color: grayColor })
      } catch (qrError) {
        console.error("Error generating QR:", qrError)
      }

      try {
        const firmaX = margin + 90
        const firmaBoxWidth = contentWidth - 90

        page.drawRectangle({ x: firmaX, y: y - firmaHeight, width: firmaBoxWidth, height: firmaHeight, color: bgGray, borderColor: lightGray, borderWidth: 0.5 })
        page.drawText("FIRMA DEL CLIENTE AL ENTREGAR EQUIPO", { x: firmaX + 10, y: y - 12, size: 7, font: helveticaBold, color: grayColor })

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

        page.drawLine({ start: { x: firmaX + 20, y: y - firmaHeight + 12 }, end: { x: firmaX + firmaBoxWidth - 20, y: y - firmaHeight + 12 }, thickness: 0.5, color: grayColor })
        page.drawText(clienteNombre, { x: firmaX + 20, y: y - firmaHeight + 4, size: 7, font: helvetica, color: grayColor })
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
          color: { dark: "#1e293b", light: "#ffffff" }
        })
        const qrBase64 = qrDataUrl.split(",")[1]
        const qrBytes = Uint8Array.from(atob(qrBase64), c => c.charCodeAt(0))
        const qrImage = await pdfDoc.embedPng(qrBytes)
        page.drawImage(qrImage, { x: margin, y: y - qrSize, width: qrSize, height: qrSize })
        page.drawText("Escanea para ver el estado", { x: margin + qrSize + 10, y: y - 20, size: 7, font: helvetica, color: grayColor })
        page.drawText("de tu reparación", { x: margin + qrSize + 10, y: y - 30, size: 7, font: helvetica, color: grayColor })
      } catch (qrError) {
        console.error("Error generating QR:", qrError)
      }
      y -= qrSize + 8
    } else if (hasFirma) {
      try {
        page.drawRectangle({ x: margin, y: y - firmaHeight, width: contentWidth, height: firmaHeight, color: bgGray, borderColor: lightGray, borderWidth: 0.5 })
        page.drawText("FIRMA DEL CLIENTE AL ENTREGAR EQUIPO", { x: margin + 10, y: y - 12, size: 7, font: helveticaBold, color: grayColor })

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

        page.drawLine({ start: { x: margin + 20, y: y - firmaHeight + 12 }, end: { x: width - margin - 20, y: y - firmaHeight + 12 }, thickness: 0.5, color: grayColor })
        page.drawText(clienteNombre, { x: margin + 20, y: y - firmaHeight + 4, size: 7, font: helvetica, color: grayColor })
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

  // Terminos fluye directamente desde y
  page.drawRectangle({
    x: margin,
    y: y - terminosBoxHeight,
    width: contentWidth,
    height: terminosBoxHeight,
    color: rgb(0.98, 0.98, 0.98),
    borderColor: lightGray,
    borderWidth: 0.5
  })

  page.drawText("TÉRMINOS Y CONDICIONES", { x: margin + 10, y: y - 11, size: 6.5, font: helveticaBold, color: grayColor })

  let termY = y - 23
  displayedTerminos.forEach(t => {
    page.drawText(t, { x: margin + 10, y: termY, size: 6.5, font: helvetica, color: grayColor })
    termY -= 10
  })

  y -= terminosBoxHeight + 8

  // === FOOTER (fluye desde y) ===
  const footerY = y - 10
  page.drawLine({ start: { x: margin, y: footerY + 10 }, end: { x: width - margin, y: footerY + 10 }, thickness: 0.5, color: lightGray })
  page.drawText(`Orden #${numeroOrden}`, { x: margin, y: footerY, size: 8, font: helveticaBold, color: primaryColor })
  page.drawText(`Impreso: ${fechaImpresion}`, { x: width - margin - 120, y: footerY, size: 7, font: helvetica, color: grayColor })

  // === BARRA INFERIOR (justo debajo del footer) ===
  const barraY = footerY - 12
  page.drawRectangle({ x: 0, y: barraY, width, height: 6, color: primaryColor })

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
  const redColor = rgb(0.918, 0.306, 0.306)

  // Barra superior fina
  localPage.drawRectangle({ x: 0, y: 842 - 4, width: 595, height: 4, color: primaryColor })

  // Header: Orden # + fechas en misma línea
  const lOrdenText = `ORDEN #${String(numeroOrden).padStart(4, "0")}`
  localPage.drawText(lOrdenText, { x: lm, y: ly, size: 14, font: helveticaBold, color: primaryColor })
  const fechasText = `Ingreso: ${fechaIngreso}` + (fechaPrometida ? `  |  Entrega est.: ${fechaPrometida}` : "")
  const fechasW = helvetica.widthOfTextAtSize(fechasText, 7)
  localPage.drawText(fechasText, { x: 595 - lm - fechasW, y: ly + 2, size: 7, font: helvetica, color: grayColor })
  ly -= 12
  localPage.drawLine({ start: { x: lm, y: ly }, end: { x: 595 - lm, y: ly }, thickness: 1, color: primaryColor })
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

    localPage.drawText("ACCESO", { x: rightX, y: patGridY, size: 6, font: helveticaBold, color: grayColor })

    const getPatPos = (num: number) => ({
      x: patCenterX + ((num - 1) % 3 - 1) * patCellSize,
      y: patGridY - 14 - Math.floor((num - 1) / 3) * patCellSize,
    })

    // Líneas del patrón
    for (let i = 0; i < patternNumbers.length - 1; i++) {
      const s = getPatPos(patternNumbers[i])
      const e = getPatPos(patternNumbers[i + 1])
      localPage.drawLine({ start: s, end: e, thickness: 1.2, color: primaryColor })
    }
    // Puntos
    for (let num = 1; num <= 9; num++) {
      const pos = getPatPos(num)
      const inPat = patternNumbers.includes(num)
      localPage.drawCircle({ x: pos.x, y: pos.y, size: patDotR, color: inPat ? primaryColor : lightGray, borderWidth: 0 })
      if (inPat) localPage.drawCircle({ x: pos.x, y: pos.y, size: patDotR - 1.5, color: white, borderWidth: 0 })
    }
  } else if (codigoAccesoDispositivo) {
    // Código de acceso como texto a la derecha
    localPage.drawText("ACCESO", { x: rightX, y: ly, size: 6, font: helveticaBold, color: grayColor })
    localPage.drawText(codigoAccesoDispositivo.substring(0, 20), { x: rightX, y: ly - 12, size: 9, font: courier, color: textColor })
  }

  // === Columna izquierda: datos compactos ===
  // Fila: Cliente + Dispositivo
  localPage.drawText("CLIENTE", { x: lm, y: ly, size: 6, font: helveticaBold, color: primaryColor })
  localPage.drawText(`${clienteNombre.substring(0, 25)}  ·  Tel: ${clienteTelefono}`, { x: lm + 45, y: ly, size: 8, font: helvetica, color: textColor })
  ly -= 12

  localPage.drawText("EQUIPO", { x: lm, y: ly, size: 6, font: helveticaBold, color: primaryColor })
  const devInfo = [dispositivo, marca, colorDisp].filter(Boolean).join(" - ") + (imei ? `  ·  ${imei}` : "")
  localPage.drawText(devInfo.substring(0, 55), { x: lm + 45, y: ly, size: 8, font: helvetica, color: textColor })
  ly -= 14

  // Problema (destacado)
  localPage.drawRectangle({ x: lm, y: ly - 3, width: 3, height: 12, color: redColor })
  localPage.drawText("PROBLEMA", { x: lm + 8, y: ly, size: 6, font: helveticaBold, color: redColor })
  localPage.drawText(problemaReportado.substring(0, 60), { x: lm + 55, y: ly, size: 8, font: helvetica, color: textColor })
  ly -= 13

  // Accesorios + Presupuesto en misma línea si caben
  const infoLine: string[] = []
  if (accesorios) infoLine.push(`Acc: ${accesorios.substring(0, 30)}`)
  if (presupuesto) infoLine.push(`Presup: ${presupuesto}`)
  if (data.sena && data.sena > 0) infoLine.push(`Seña: ${formatCurrencyPDF(data.sena)}`)
  if (infoLine.length > 0) {
    localPage.drawText(infoLine.join("  |  "), { x: lm + 8, y: ly, size: 7, font: helvetica, color: grayColor })
    ly -= 12
  }

  // Observaciones
  if (observaciones) {
    localPage.drawText(`OBS: ${observaciones.substring(0, 70)}`, { x: lm + 8, y: ly, size: 6, font: helvetica, color: grayColor })
    ly -= 11
  }

  // Checklist compacto en línea
  if (data.checklistItems && data.checklistItems.length > 0) {
    localPage.drawLine({ start: { x: lm, y: ly + 4 }, end: { x: lm + leftColW, y: ly + 4 }, thickness: 0.5, color: lightGray })
    const colW = leftColW / 3
    let cx = lm
    let cy = ly - 2
    for (const item of data.checklistItems) {
      const val = item.valor === true ? "SI" : item.valor === false ? "NO" : String(item.valor || "").substring(0, 12)
      const valColor = item.valor === true ? greenColor : item.valor === false ? redColor : grayColor
      localPage.drawText(`${item.label}:`, { x: cx, y: cy, size: 5.5, font: helvetica, color: grayColor })
      localPage.drawText(val, { x: cx + helvetica.widthOfTextAtSize(`${item.label}: `, 5.5), y: cy, size: 5.5, font: helveticaBold, color: valColor })
      cx += colW
      if (cx + colW > lm + leftColW) { cx = lm; cy -= 10 }
    }
    ly = cy - 6
  }

  // Footer compacto
  localPage.drawLine({ start: { x: lm, y: ly }, end: { x: 595 - lm, y: ly }, thickness: 0.5, color: lightGray })
  localPage.drawText(`Orden #${numeroOrden} - COPIA LOCAL`, { x: lm, y: ly - 9, size: 6, font: helveticaBold, color: primaryColor })
  localPage.drawText(`Impreso: ${fechaImpresion}`, { x: 595 - lm - 100, y: ly - 9, size: 5.5, font: helvetica, color: grayColor })

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

    photosPage.drawRectangle({ x: 0, y: height - 8, width, height: 8, color: primaryColor })
    py -= 10

    photosPage.drawText("FOTOS DE INGRESO", { x: margin, y: py, size: 14, font: helveticaBold, color: primaryColor })
    photosPage.drawText(`Orden #${numeroOrden}`, { x: width - margin - 80, y: py, size: 10, font: helveticaBold, color: grayColor })
    py -= 8
    photosPage.drawLine({ start: { x: margin, y: py }, end: { x: width - margin, y: py }, thickness: 1, color: primaryColor })
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
          photosPage.drawRectangle({ x: photoX - 2, y: py - photoHeight - 2, width: photoSize + 4, height: photoHeight + 4, borderColor: lightGray, borderWidth: 1, color: white })
          // Image centered in box
          photosPage.drawImage(photoImage, {
            x: photoX + (photoSize - scaledW) / 2,
            y: py - photoHeight + (photoHeight - scaledH) / 2,
            width: scaledW,
            height: scaledH,
          })

          if (foto.descripcion) {
            photosPage.drawText(safe(foto.descripcion).substring(0, 40), { x: photoX, y: py - photoHeight - 12, size: 7, font: helvetica, color: grayColor })
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
    photosPage.drawText(`Orden #${numeroOrden} - Fotos de Ingreso`, { x: margin, y: 25, size: 8, font: helveticaBold, color: primaryColor })
    photosPage.drawText(`Impreso: ${fechaImpresion}`, { x: width - margin - 120, y: 25, size: 7, font: helvetica, color: grayColor })
    photosPage.drawRectangle({ x: 0, y: 0, width, height: 6, color: primaryColor })
  }

  // === SECCION DE ENTREGA (segunda pagina, solo si fue entregado) ===
  if (data.estado === "ENTREGADO" && data.firmaClienteEntrega) {
    const page2 = pdfDoc.addPage([width, height])
    let ey = height - margin

    // Barra superior
    page2.drawRectangle({ x: 0, y: height - 8, width, height: 8, color: primaryColor })
    ey -= 10

    // Titulo
    page2.drawText("COMPROBANTE DE ENTREGA", { x: margin, y: ey, size: 14, font: helveticaBold, color: primaryColor })
    page2.drawText(`Orden #${numeroOrden}`, { x: width - margin - 80, y: ey, size: 10, font: helveticaBold, color: grayColor })
    ey -= 25

    // Linea separadora
    page2.drawLine({ start: { x: margin, y: ey }, end: { x: width - margin, y: ey }, thickness: 1, color: primaryColor })
    ey -= 20

    // Info de entrega
    page2.drawText("Fecha de entrega:", { x: margin, y: ey, size: 9, font: helveticaBold, color: textColor })
    page2.drawText(data.fechaEntrega ? formatDatePDF(data.fechaEntrega) : "-", { x: margin + 110, y: ey, size: 9, font: helvetica, color: textColor })
    ey -= 16

    page2.drawText("Dispositivo:", { x: margin, y: ey, size: 9, font: helveticaBold, color: textColor })
    page2.drawText(safe(data.dispositivo), { x: margin + 110, y: ey, size: 9, font: helvetica, color: textColor })
    ey -= 16

    page2.drawText("Cliente:", { x: margin, y: ey, size: 9, font: helveticaBold, color: textColor })
    page2.drawText(safe(data.cliente.nombre), { x: margin + 110, y: ey, size: 9, font: helvetica, color: textColor })
    ey -= 16

    if (data.entregadoPor) {
      page2.drawText("Entregado por:", { x: margin, y: ey, size: 9, font: helveticaBold, color: textColor })
      page2.drawText(safe(data.entregadoPor), { x: margin + 110, y: ey, size: 9, font: helvetica, color: textColor })
      ey -= 16
    }

    if (data.notasEntrega) {
      ey -= 5
      page2.drawText("Notas de entrega:", { x: margin, y: ey, size: 9, font: helveticaBold, color: textColor })
      ey -= 14
      page2.drawText(safe(data.notasEntrega).substring(0, 200), { x: margin, y: ey, size: 9, font: helvetica, color: textColor })
      ey -= 16
    }

    ey -= 15

    // Firmas de entrega
    const entregaHalfWidth = (width - 2 * margin - 20) / 2
    const entregaCardX2 = margin + entregaHalfWidth + 20

    // Firma Cliente Entrega
    page2.drawRectangle({ x: margin, y: ey - 85, width: entregaHalfWidth, height: 100, color: bgGray, borderColor: lightGray, borderWidth: 1 })
    page2.drawRectangle({ x: margin, y: ey + 5, width: entregaHalfWidth, height: 18, color: rgb(0.95, 0.95, 0.95) })
    page2.drawText("CLIENTE (quien recibe)", { x: margin + 12, y: ey + 10, size: 8, font: helveticaBold, color: grayColor })

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

    page2.drawLine({ start: { x: margin + 20, y: ey - 55 }, end: { x: margin + entregaHalfWidth - 20, y: ey - 55 }, thickness: 1, color: grayColor })
    page2.drawText(safe(data.cliente.nombre).substring(0, 25), { x: margin + 30, y: ey - 70, size: 8, font: helvetica, color: textColor })

    // Firma Encargado Entrega
    page2.drawRectangle({ x: entregaCardX2, y: ey - 85, width: entregaHalfWidth, height: 100, color: bgGray, borderColor: lightGray, borderWidth: 1 })
    page2.drawRectangle({ x: entregaCardX2, y: ey + 5, width: entregaHalfWidth, height: 18, color: rgb(0.95, 0.95, 0.95) })
    page2.drawText("ENCARGADO (quien entrega)", { x: entregaCardX2 + 12, y: ey + 10, size: 8, font: helveticaBold, color: grayColor })

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

    page2.drawLine({ start: { x: entregaCardX2 + 20, y: ey - 55 }, end: { x: entregaCardX2 + entregaHalfWidth - 20, y: ey - 55 }, thickness: 1, color: grayColor })
    page2.drawText(safe(data.entregadoPor).substring(0, 25), { x: entregaCardX2 + 30, y: ey - 70, size: 8, font: helvetica, color: textColor })

    // Footer pagina 2
    page2.drawText(`Orden #${numeroOrden} - Comprobante de Entrega`, { x: margin, y: 25, size: 8, font: helveticaBold, color: primaryColor })
    page2.drawText(`Impreso: ${fechaImpresion}`, { x: width - margin - 100, y: 25, size: 7, font: helvetica, color: grayColor })
    page2.drawRectangle({ x: 0, y: 0, width, height: 8, color: primaryColor })
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
  const labelColor = rgb(0.5, 0.5, 0.5)

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

  // Colores modernos (Indigo theme)
  const primaryColor = rgb(0.388, 0.400, 0.945) // #6366f1
  const primaryDark = rgb(0.118, 0.106, 0.294) // #1e1b4b
  const textColor = rgb(0.118, 0.161, 0.231) // #1e293b
  const grayColor = rgb(0.392, 0.455, 0.545) // #64748b
  const lightGray = rgb(0.886, 0.910, 0.941) // #e2e8f0
  const bgGray = rgb(0.973, 0.980, 0.988) // #f8fafc
  const white = rgb(1, 1, 1)
  const greenColor = rgb(0.134, 0.545, 0.373)

  const margin = 40
  const contentWidth = width - (margin * 2)

  // === BARRA DE ACENTO SUPERIOR ===
  page.drawRectangle({
    x: 0,
    y: height - 10,
    width: width,
    height: 10,
    color: primaryColor,
  })

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

  // === HEADER ===
  page.drawText(empresaNombre, { x: margin + logoWidth, y, size: 20, font: helveticaBold, color: textColor })
  y -= 16
  if (telefonoEmpresa) {
    page.drawText(`Tel: ${telefonoEmpresa}`, { x: margin + logoWidth, y, size: 9, font: helvetica, color: grayColor })
    y -= 12
  }
  if (direccionEmpresa) {
    page.drawText(direccionEmpresa, { x: margin + logoWidth, y, size: 9, font: helvetica, color: grayColor })
    y -= 12
  }

  // Numero de venta (lado derecho)
  const ventaText = `VENTA #${String(numeroVenta).padStart(4, "0")}`
  const ventaWidth = helveticaBold.widthOfTextAtSize(ventaText, 16)
  page.drawRectangle({
    x: width - margin - ventaWidth - 20,
    y: height - margin - 35,
    width: ventaWidth + 16,
    height: 26,
    color: primaryColor,
  })
  page.drawText(ventaText, {
    x: width - margin - ventaWidth - 12,
    y: height - margin - 27,
    size: 16,
    font: helveticaBold,
    color: white
  })
  page.drawText(`Fecha: ${fecha}`, {
    x: width - margin - 90,
    y: height - margin - 55,
    size: 9,
    font: helvetica,
    color: grayColor
  })

  y = height - margin - 90

  // Linea separadora
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 2, color: primaryColor })
  y -= 20

  // === TITULO ===
  const titleText = "COMPROBANTE DE VENTA"
  const titleWidth = helveticaBold.widthOfTextAtSize(titleText, 14)
  page.drawText(titleText, { x: (width - titleWidth) / 2, y, size: 14, font: helveticaBold, color: primaryColor })
  y -= 30

  // === DATOS DEL CLIENTE ===
  page.drawRectangle({ x: margin, y: y - 40, width: contentWidth / 2 - 10, height: 50, color: bgGray })
  page.drawText("CLIENTE", { x: margin + 10, y: y - 5, size: 9, font: helveticaBold, color: primaryColor })
  page.drawText(clienteNombre, { x: margin + 10, y: y - 20, size: 10, font: helvetica, color: textColor })
  if (clienteTelefono) {
    page.drawText(`Tel: ${clienteTelefono}`, { x: margin + 10, y: y - 33, size: 9, font: helvetica, color: grayColor })
  }

  // === DATOS DEL VENDEDOR ===
  page.drawRectangle({ x: margin + contentWidth / 2 + 10, y: y - 40, width: contentWidth / 2 - 10, height: 50, color: bgGray })
  page.drawText("VENDEDOR", { x: margin + contentWidth / 2 + 20, y: y - 5, size: 9, font: helveticaBold, color: primaryColor })
  page.drawText(vendedor, { x: margin + contentWidth / 2 + 20, y: y - 20, size: 10, font: helvetica, color: textColor })
  page.drawText(`Pago: ${metodoPago}`, { x: margin + contentWidth / 2 + 20, y: y - 33, size: 9, font: helvetica, color: grayColor })

  y -= 60

  // === TABLA DE ITEMS ===
  page.drawText("DETALLE DE PRODUCTOS", { x: margin, y, size: 10, font: helveticaBold, color: primaryColor })
  y -= 5
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1, color: lightGray })
  y -= 20

  // Header de tabla (moderno con color primario)
  page.drawRectangle({ x: margin, y: y - 5, width: contentWidth, height: 22, color: primaryColor })
  page.drawText("Descripción", { x: margin + 10, y: y, size: 9, font: helveticaBold, color: white })
  page.drawText("Cant.", { x: margin + 280, y: y, size: 9, font: helveticaBold, color: white })
  page.drawText("P. Unit.", { x: margin + 330, y: y, size: 9, font: helveticaBold, color: white })
  page.drawText("Subtotal", { x: margin + 410, y: y, size: 9, font: helveticaBold, color: white })
  page.drawText("Garantia", { x: margin + 475, y: y, size: 9, font: helveticaBold, color: white })
  y -= 25

  // Filas de items
  for (const item of data.items) {
    page.drawText(item.descripcion.substring(0, 40), { x: margin + 10, y, size: 9, font: helvetica, color: textColor })
    page.drawText(String(item.cantidad), { x: margin + 285, y, size: 9, font: helvetica, color: textColor })
    page.drawText(formatCurrencyPDF(item.precioUnitario), { x: margin + 330, y, size: 9, font: helvetica, color: textColor })
    page.drawText(formatCurrencyPDF(item.subtotal), { x: margin + 410, y, size: 9, font: helvetica, color: textColor })
    page.drawText(item.diasGarantia > 0 ? `${item.diasGarantia} dias` : "-", { x: margin + 478, y, size: 9, font: helvetica, color: item.diasGarantia > 0 ? greenColor : grayColor })
    y -= 18
    page.drawLine({ start: { x: margin, y: y + 5 }, end: { x: width - margin, y: y + 5 }, thickness: 0.5, color: lightGray })
  }

  y -= 20

  // === TOTALES ===
  const totalsX = width - margin - 180

  page.drawText("Subtotal:", { x: totalsX, y, size: 10, font: helvetica, color: grayColor })
  page.drawText(formatCurrencyPDF(data.subtotal), { x: totalsX + 100, y, size: 10, font: helvetica, color: textColor })
  y -= 18

  if (data.descuento > 0) {
    page.drawText("Descuento:", { x: totalsX, y, size: 10, font: helvetica, color: grayColor })
    page.drawText(`-${formatCurrencyPDF(data.descuento)}`, { x: totalsX + 100, y, size: 10, font: helvetica, color: rgb(0.8, 0.2, 0.2) })
    y -= 18
  }

  page.drawLine({ start: { x: totalsX, y: y + 5 }, end: { x: width - margin, y: y + 5 }, thickness: 1, color: primaryColor })
  y -= 5

  page.drawText("TOTAL:", { x: totalsX, y, size: 12, font: helveticaBold, color: textColor })
  page.drawText(formatCurrencyPDF(data.total), { x: totalsX + 100, y, size: 12, font: helveticaBold, color: primaryColor })

  // === FOOTER ===
  const footerY = margin + 60

  page.drawLine({ start: { x: margin, y: footerY }, end: { x: width - margin, y: footerY }, thickness: 1, color: lightGray })

  page.drawText("Conserve este comprobante como prueba de compra.", { x: margin, y: footerY - 15, size: 8, font: helvetica, color: grayColor })
  page.drawText("Los productos con garantia incluyen certificado por separado.", { x: margin, y: footerY - 27, size: 8, font: helvetica, color: grayColor })
  page.drawText("Gracias por su compra!", { x: margin, y: footerY - 42, size: 9, font: helveticaBold, color: primaryColor })

  const fechaImpresion = formatDateTimeValue(new Date(), data.zonaHoraria || DEFAULT_TIMEZONE)
  page.drawText(`Impreso: ${fechaImpresion}`, { x: width - margin - 110, y: footerY - 42, size: 7, font: helvetica, color: grayColor })

  // Barra inferior de acento
  page.drawRectangle({
    x: 0,
    y: 0,
    width: width,
    height: 8,
    color: primaryColor,
  })

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

  const black = rgb(0, 0, 0)
  const gray = rgb(0.35, 0.35, 0.35)
  const lightGray = rgb(0.7, 0.7, 0.7)

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
  page.drawRectangle({ x: margin, y: y - 3, width: contentWidth, height: 14, color: rgb(0.95, 0.95, 0.95) })
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

  // Colores vibrantes
  const primaryColor = rgb(0.227, 0.384, 0.835) // #3a62d5 - Azul vibrante
  const primaryLight = rgb(0.380, 0.533, 0.906) // #6188e7 - Azul claro
  const primaryDark = rgb(0.118, 0.227, 0.525) // #1e3a86 - Azul oscuro
  const accentGold = rgb(0.855, 0.647, 0.125) // #daa520 - Dorado
  const accentGoldLight = rgb(1, 0.843, 0.4) // #ffd766 - Dorado claro
  const textColor = rgb(0.118, 0.161, 0.231) // #1e293b
  const grayColor = rgb(0.392, 0.455, 0.545) // #64748b
  const lightGray = rgb(0.918, 0.929, 0.941) // #eaecf0
  const greenColor = rgb(0.086, 0.608, 0.420) // #169b6b
  const greenDark = rgb(0.047, 0.408, 0.286) // #0c6849
  const greenLight = rgb(0.812, 0.949, 0.886) // #cff2e2
  const white = rgb(1, 1, 1)

  const margin = 40
  const contentWidth = width - (margin * 2)

  // === FONDO DECORATIVO SUPERIOR ===
  // Banda superior gruesa con gradiente visual
  page.drawRectangle({
    x: 0,
    y: height - 120,
    width: width,
    height: 120,
    color: primaryColor,
  })
  // Capa superpuesta para efecto
  page.drawRectangle({
    x: 0,
    y: height - 60,
    width: width,
    height: 60,
    color: primaryDark,
  })

  // === ESCUDO/BADGE DE GARANTIA (círculo decorativo) ===
  const badgeCenterX = width / 2
  const badgeCenterY = height - 90
  const badgeRadius = 45

  // Círculo exterior dorado
  page.drawCircle({
    x: badgeCenterX,
    y: badgeCenterY,
    size: badgeRadius + 8,
    color: accentGold,
  })
  // Círculo interior azul
  page.drawCircle({
    x: badgeCenterX,
    y: badgeCenterY,
    size: badgeRadius,
    color: primaryDark,
  })
  // Círculo interior más pequeño
  page.drawCircle({
    x: badgeCenterX,
    y: badgeCenterY,
    size: badgeRadius - 8,
    borderColor: accentGoldLight,
    borderWidth: 2,
  })

  // Texto dentro del badge
  const checkText = "OK"
  const checkWidth = helveticaBold.widthOfTextAtSize(checkText, 28)
  page.drawText(checkText, {
    x: badgeCenterX - checkWidth / 2,
    y: badgeCenterY - 10,
    size: 28,
    font: helveticaBold,
    color: accentGoldLight,
  })

  // === LOGO (esquina superior izquierda) ===
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
          const maxLogoHeight = 40
          const maxLogoWidth = 60
          const scale = Math.min(maxLogoHeight / logoDims.height, maxLogoWidth / logoDims.width)
          const scaledWidth = logoDims.width * scale
          const scaledHeight = logoDims.height * scale

          // Fondo blanco para el logo
          page.drawRectangle({
            x: margin - 5,
            y: height - 45 - scaledHeight / 2,
            width: scaledWidth + 10,
            height: scaledHeight + 10,
            color: white,
          })

          page.drawImage(logoImage, {
            x: margin,
            y: height - 40 - scaledHeight / 2,
            width: scaledWidth,
            height: scaledHeight,
          })
        }
      }
    } catch (logoError) {
      console.error("Error loading logo:", logoError)
    }
  }

  // === TITULO PRINCIPAL ===
  let y = height - 150

  const titleText = "CERTIFICADO DE GARANTÍA"
  const titleWidth = helveticaBold.widthOfTextAtSize(titleText, 22)
  page.drawText(titleText, {
    x: (width - titleWidth) / 2,
    y,
    size: 22,
    font: helveticaBold,
    color: primaryDark,
  })

  y -= 20

  // Línea decorativa dorada debajo del título
  const lineWidth = 160
  page.drawRectangle({
    x: (width - lineWidth) / 2,
    y,
    width: lineWidth,
    height: 2.5,
    color: accentGold,
  })

  y -= 25

  // === NUMERO DE GARANTIA (badge destacado) ===
  const garantiaText = `N° ${numeroGarantia}`
  const garantiaTextWidth = helveticaBold.widthOfTextAtSize(garantiaText, 13)
  const garantiaBadgeWidth = garantiaTextWidth + 36
  const garantiaBadgeHeight = 26

  page.drawRectangle({
    x: (width - garantiaBadgeWidth) / 2,
    y: y - 4,
    width: garantiaBadgeWidth,
    height: garantiaBadgeHeight,
    color: primaryColor,
    borderColor: primaryDark,
    borderWidth: 1,
  })
  page.drawText(garantiaText, {
    x: (width - garantiaTextWidth) / 2,
    y: y + 3,
    size: 13,
    font: helveticaBold,
    color: white,
  })

  y -= 45

  // === INFORMACIÓN DE LA EMPRESA ===
  page.drawText(empresaNombre.toUpperCase(), {
    x: margin,
    y,
    size: 12,
    font: helveticaBold,
    color: textColor,
  })
  y -= 14
  if (telefonoEmpresa) {
    page.drawText(`Tel: ${telefonoEmpresa}`, { x: margin, y, size: 9, font: helvetica, color: grayColor })
    if (direccionEmpresa) {
      page.drawText(`  |  ${direccionEmpresa}`, { x: margin + helvetica.widthOfTextAtSize(`Tel: ${telefonoEmpresa}`, 9), y, size: 9, font: helvetica, color: grayColor })
    }
  } else if (direccionEmpresa) {
    page.drawText(direccionEmpresa, { x: margin, y, size: 9, font: helvetica, color: grayColor })
  }

  y -= 30

  // === SECCIÓN: DATOS DEL CLIENTE ===
  // Header de sección con icono
  page.drawRectangle({
    x: margin,
    y: y - 2,
    width: 4,
    height: 16,
    color: primaryColor,
  })
  page.drawText("DATOS DEL CLIENTE", { x: margin + 12, y, size: 11, font: helveticaBold, color: primaryDark })
  y -= 8
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1, color: lightGray })
  y -= 20

  // Contenido del cliente en caja
  page.drawRectangle({
    x: margin,
    y: y - 35,
    width: contentWidth,
    height: 50,
    color: rgb(0.976, 0.980, 0.988),
    borderColor: lightGray,
    borderWidth: 1,
  })

  page.drawText("Nombre:", { x: margin + 15, y: y - 5, size: 9, font: helvetica, color: grayColor })
  page.drawText(clienteNombre, { x: margin + 65, y: y - 5, size: 10, font: helveticaBold, color: textColor })
  if (clienteTelefono) {
    page.drawText("Teléfono:", { x: margin + 280, y: y - 5, size: 9, font: helvetica, color: grayColor })
    page.drawText(clienteTelefono, { x: margin + 335, y: y - 5, size: 10, font: helvetica, color: textColor })
  }
  page.drawText("Venta N°:", { x: margin + 15, y: y - 22, size: 9, font: helvetica, color: grayColor })
  page.drawText(`${String(numeroVenta).padStart(4, "0")}`, { x: margin + 65, y: y - 22, size: 10, font: helveticaBold, color: textColor })
  page.drawText("Fecha:", { x: margin + 150, y: y - 22, size: 9, font: helvetica, color: grayColor })
  page.drawText(fechaVenta, { x: margin + 190, y: y - 22, size: 10, font: helvetica, color: textColor })

  y -= 55

  // === SECCIÓN: PRODUCTO CUBIERTO ===
  page.drawRectangle({
    x: margin,
    y: y - 2,
    width: 4,
    height: 16,
    color: primaryColor,
  })
  page.drawText("PRODUCTO CUBIERTO POR LA GARANTÍA", { x: margin + 12, y, size: 11, font: helveticaBold, color: primaryDark })
  y -= 8
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1, color: lightGray })
  y -= 20

  page.drawRectangle({
    x: margin,
    y: y - 35,
    width: contentWidth,
    height: 50,
    color: rgb(0.976, 0.980, 0.988),
    borderColor: lightGray,
    borderWidth: 1,
  })

  page.drawText("Producto:", { x: margin + 15, y: y - 5, size: 9, font: helvetica, color: grayColor })
  // Truncar descripción si es muy larga
  let descripcionDisplay = productoDescripcion
  const maxDescWidth = 380
  while (helvetica.widthOfTextAtSize(descripcionDisplay, 10) > maxDescWidth && descripcionDisplay.length > 3) {
    descripcionDisplay = descripcionDisplay.slice(0, -4) + "..."
  }
  page.drawText(descripcionDisplay, { x: margin + 65, y: y - 5, size: 10, font: helveticaBold, color: textColor })
  page.drawText("Cantidad:", { x: margin + 15, y: y - 22, size: 9, font: helvetica, color: grayColor })
  page.drawText(String(productoCantidad), { x: margin + 65, y: y - 22, size: 10, font: helveticaBold, color: textColor })

  y -= 60

  // === SECCIÓN DESTACADA: VIGENCIA DE LA GARANTIA ===
  const vigenciaHeight = 110
  // Fondo verde con borde
  page.drawRectangle({
    x: margin,
    y: y - vigenciaHeight + 15,
    width: contentWidth,
    height: vigenciaHeight,
    color: greenLight,
    borderColor: greenColor,
    borderWidth: 2,
  })

  // Badge "VIGENTE" en esquina
  const vigenteBadgeWidth = 70
  page.drawRectangle({
    x: width - margin - vigenteBadgeWidth,
    y: y + 5,
    width: vigenteBadgeWidth,
    height: 22,
    color: greenColor,
  })
  const vigenteText = "VIGENTE"
  const vigenteWidth = helveticaBold.widthOfTextAtSize(vigenteText, 9)
  page.drawText(vigenteText, {
    x: width - margin - vigenteBadgeWidth / 2 - vigenteWidth / 2,
    y: y + 11,
    size: 9,
    font: helveticaBold,
    color: white,
  })

  // Título de la sección
  page.drawText("VIGENCIA DE LA GARANTÍA", { x: margin + 20, y: y - 5, size: 12, font: helveticaBold, color: greenDark })
  y -= 35

  // Días grandes en el centro
  const diasText = `${data.diasValidez}`
  const diasWidth = helveticaBold.widthOfTextAtSize(diasText, 48)
  page.drawText(diasText, { x: (width - diasWidth) / 2 - 30, y: y - 5, size: 48, font: helveticaBold, color: greenDark })
  page.drawText("DIAS", { x: (width + diasWidth) / 2 - 20, y: y + 5, size: 16, font: helveticaBold, color: greenDark })

  y -= 45

  // Fechas con iconos visuales
  const fechaBoxWidth = (contentWidth - 40) / 2

  // Fecha inicio
  page.drawRectangle({
    x: margin + 10,
    y: y - 25,
    width: fechaBoxWidth,
    height: 35,
    color: white,
    borderColor: greenColor,
    borderWidth: 1,
  })
  page.drawText("DESDE", { x: margin + 20, y: y - 5, size: 8, font: helveticaBold, color: greenColor })
  page.drawText(fechaInicio, { x: margin + 20, y: y - 18, size: 10, font: helveticaBold, color: textColor })

  // Fecha fin
  page.drawRectangle({
    x: margin + 20 + fechaBoxWidth,
    y: y - 25,
    width: fechaBoxWidth,
    height: 35,
    color: white,
    borderColor: greenColor,
    borderWidth: 1,
  })
  page.drawText("HASTA", { x: margin + 30 + fechaBoxWidth, y: y - 5, size: 8, font: helveticaBold, color: greenColor })
  page.drawText(fechaVencimiento, { x: margin + 30 + fechaBoxWidth, y: y - 18, size: 10, font: helveticaBold, color: textColor })

  y -= 55

  // === CONDICIONES (más compactas) ===
  page.drawRectangle({
    x: margin,
    y: y - 2,
    width: 4,
    height: 16,
    color: grayColor,
  })
  page.drawText("CONDICIONES DE LA GARANTÍA", { x: margin + 12, y, size: 10, font: helveticaBold, color: grayColor })
  y -= 18

  const condiciones = [
    "Esta garantia cubre defectos de fabricacion del producto.",
    "No cubre danos por mal uso, caidas, liquidos o manipulacion inadecuada.",
    "Para hacer efectiva la garantia, presente este certificado y el producto.",
    "La garantia no es transferible. El producto sera reparado o reemplazado segun disponibilidad.",
  ]

  for (let i = 0; i < condiciones.length; i++) {
    // Bullet point
    page.drawCircle({ x: margin + 8, y: y + 3, size: 2, color: grayColor })
    page.drawText(condiciones[i], { x: margin + 18, y, size: 8, font: helvetica, color: grayColor })
    y -= 12
  }

  // === FIRMA DEL ENCARGADO ===
  y -= 10

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
        const maxSigH = 50
        const maxSigW = 150
        const sigScale = Math.min(maxSigH / sigDims.height, maxSigW / sigDims.width)
        const sigW = sigDims.width * sigScale
        const sigH = sigDims.height * sigScale
        const sigX = width - margin - 90 - sigW / 2
        page.drawImage(sigImage, { x: sigX, y: y - sigH + 5, width: sigW, height: sigH })
        y -= sigH
      }
    } catch (sigError) {
      console.error("Error embedding signature:", sigError)
    }
  }

  page.drawLine({ start: { x: width - margin - 180, y }, end: { x: width - margin, y }, thickness: 1, color: textColor })
  const firmaLabel = data.nombreEncargado ? `Firma - ${data.nombreEncargado}` : "Firma"
  const firmaLabelWidth = helvetica.widthOfTextAtSize(firmaLabel, 9)
  page.drawText(firmaLabel, { x: width - margin - 90 - firmaLabelWidth / 2, y: y - 12, size: 9, font: helvetica, color: grayColor })

  // === FOOTER ===
  page.drawRectangle({
    x: 0,
    y: 0,
    width: width,
    height: 35,
    color: primaryDark,
  })

  const footerText = "Conserve este certificado junto con su comprobante de compra"
  const footerTextWidth = helvetica.widthOfTextAtSize(footerText, 9)
  page.drawText(footerText, {
    x: (width - footerTextWidth) / 2,
    y: 18,
    size: 9,
    font: helvetica,
    color: rgb(0.8, 0.8, 0.85),
  })

  const fechaImpresion = formatDateValue(new Date(), data.zonaHoraria || DEFAULT_TIMEZONE)
  page.drawText(`Emitido: ${fechaImpresion}`, { x: width - margin - 80, y: 8, size: 7, font: helvetica, color: rgb(0.6, 0.6, 0.65) })

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

  // Colores modernos (Indigo theme)
  const primaryColor = rgb(0.388, 0.400, 0.945) // #6366f1
  const textColor = rgb(0.118, 0.161, 0.231) // #1e293b
  const grayColor = rgb(0.392, 0.455, 0.545) // #64748b
  const lightGray = rgb(0.886, 0.910, 0.941) // #e2e8f0
  const bgGray = rgb(0.973, 0.980, 0.988) // #f8fafc
  const esRetiro = data.esRetiroSinReparacion || false
  const accentColor = esRetiro ? rgb(0.800, 0.522, 0.082) : rgb(0.134, 0.545, 0.373) // amber vs green
  const accentBg = esRetiro ? rgb(1.0, 0.965, 0.890) : rgb(0.863, 0.949, 0.898) // amber-bg vs green-bg
  const white = rgb(1, 1, 1)

  const margin = 40
  const contentWidth = width - (margin * 2)
  const cardGap = 10
  const halfWidth = (contentWidth - cardGap) / 2

  // === BARRA DE ACENTO SUPERIOR ===
  page.drawRectangle({ x: 0, y: height - 10, width, height: 10, color: accentColor })

  let y = height - margin - 15

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

  // === HEADER - Empresa ===
  page.drawText(empresaNombre, { x: margin + logoWidth, y, size: 18, font: helveticaBold, color: textColor })
  y -= 14
  if (telefonoEmpresa) {
    page.drawText(`Tel: ${telefonoEmpresa}`, { x: margin + logoWidth, y, size: 9, font: helvetica, color: grayColor })
    y -= 11
  }
  const entregaLocationParts: string[] = []
  if (direccionEmpresa) entregaLocationParts.push(direccionEmpresa)
  if (ciudadEmpresa) entregaLocationParts.push(ciudadEmpresa)
  if (codigoPostalEmpresa) entregaLocationParts.push(`CP ${codigoPostalEmpresa}`)
  if (provinciaEmpresa) entregaLocationParts.push(provinciaEmpresa)
  if (entregaLocationParts.length > 0) {
    page.drawText(entregaLocationParts.join(", "), { x: margin + logoWidth, y, size: 9, font: helvetica, color: grayColor })
  }

  // === BADGE ENTREGA/RETIRO (lado derecho) ===
  const badgeText = esRetiro ? "RETIRO" : "ENTREGA"
  const badgeWidth = helveticaBold.widthOfTextAtSize(badgeText, 10) + 20
  page.drawRectangle({ x: width - margin - badgeWidth, y: height - margin - 25, width: badgeWidth, height: 22, color: accentColor })
  page.drawText(badgeText, { x: width - margin - badgeWidth + 10, y: height - margin - 19, size: 10, font: helveticaBold, color: white })

  // Numero de orden grande
  const ordenDisplay = codigoOrden || `#${String(numeroOrden).padStart(4, "0")}`
  const ordenTextWidth = helveticaBold.widthOfTextAtSize(ordenDisplay, 20)
  page.drawText(ordenDisplay, { x: width - margin - ordenTextWidth, y: height - margin - 50, size: 20, font: helveticaBold, color: textColor })

  y = height - margin - 90

  // === TITULO ===
  const titleText = esRetiro ? "ORDEN DE RETIRO - SIN REPARACIÓN" : "COMPROBANTE DE ENTREGA"
  const titleWidth = helveticaBold.widthOfTextAtSize(titleText, 14)
  page.drawText(titleText, { x: (width - titleWidth) / 2, y, size: 14, font: helveticaBold, color: accentColor })
  y -= 25

  // === GRID: CLIENTE | DISPOSITIVO ===
  const cardHeight = 70

  // Card Cliente
  page.drawRectangle({ x: margin, y: y - cardHeight, width: halfWidth, height: cardHeight, color: bgGray })
  page.drawText("CLIENTE", { x: margin + 12, y: y - 12, size: 9, font: helveticaBold, color: primaryColor })
  page.drawText(clienteNombre.substring(0, 28), { x: margin + 12, y: y - 28, size: 10, font: helveticaBold, color: textColor })
  page.drawText(`Tel: ${clienteTelefono}`, { x: margin + 12, y: y - 42, size: 9, font: helvetica, color: grayColor })
  if (clienteEmail) {
    page.drawText(clienteEmail.substring(0, 25), { x: margin + 12, y: y - 55, size: 8, font: helvetica, color: grayColor })
  }

  // Card Dispositivo
  const cardX2 = margin + halfWidth + cardGap
  page.drawRectangle({ x: cardX2, y: y - cardHeight, width: halfWidth, height: cardHeight, color: bgGray })
  page.drawText("DISPOSITIVO", { x: cardX2 + 12, y: y - 12, size: 9, font: helveticaBold, color: primaryColor })
  page.drawText(dispositivo.substring(0, 25), { x: cardX2 + 12, y: y - 28, size: 10, font: helveticaBold, color: textColor })
  page.drawText(tipoDispositivo, { x: cardX2 + 12, y: y - 42, size: 9, font: helvetica, color: grayColor })
  if (marca) {
    page.drawText(`Marca: ${marca}`, { x: cardX2 + 12, y: y - 55, size: 8, font: helvetica, color: grayColor })
  }

  y -= cardHeight + 15

  // === FECHAS ===
  page.drawRectangle({ x: margin, y: y - 35, width: contentWidth, height: 40, color: accentBg, borderColor: accentColor, borderWidth: 1 })
  page.drawText("Ingreso:", { x: margin + 15, y: y - 10, size: 9, font: helveticaBold, color: grayColor })
  page.drawText(fechaIngreso, { x: margin + 65, y: y - 10, size: 10, font: helvetica, color: textColor })
  page.drawText(esRetiro ? "Retiro:" : "Entrega:", { x: margin + 200, y: y - 10, size: 9, font: helveticaBold, color: grayColor })
  page.drawText(fechaEntrega, { x: margin + 250, y: y - 10, size: 10, font: helveticaBold, color: accentColor })
  page.drawText(esRetiro ? "Entregado por:" : "Entregado por:", { x: margin + 15, y: y - 25, size: 9, font: helveticaBold, color: grayColor })
  page.drawText(entregadoPor, { x: margin + 100, y: y - 25, size: 10, font: helvetica, color: textColor })

  y -= 55

  // === PROBLEMA / DIAGNOSTICO ===
  page.drawText(esRetiro ? "MOTIVO DE NO REPARACIÓN" : "TRABAJO REALIZADO", { x: margin, y, size: 9, font: helveticaBold, color: primaryColor })
  y -= 12

  page.drawRectangle({ x: margin, y: y - 50, width: contentWidth, height: 55, color: bgGray, borderColor: lightGray, borderWidth: 1 })
  page.drawText("Problema:", { x: margin + 10, y: y - 12, size: 8, font: helveticaBold, color: grayColor })
  page.drawText(problemaReportado.substring(0, 70), { x: margin + 60, y: y - 12, size: 9, font: helvetica, color: textColor })
  if (diagnostico) {
    page.drawText("Diagnóstico:", { x: margin + 10, y: y - 28, size: 8, font: helveticaBold, color: grayColor })
    page.drawText(diagnostico.substring(0, 65), { x: margin + 70, y: y - 28, size: 9, font: helvetica, color: textColor })
  }

  y -= 70

  // === NOTAS DE ENTREGA (si hay) ===
  if (notasEntrega) {
    page.drawText("NOTAS DE ENTREGA", { x: margin, y, size: 9, font: helveticaBold, color: primaryColor })
    y -= 12
    page.drawText(notasEntrega.substring(0, 80), { x: margin, y, size: 9, font: helvetica, color: textColor })
    y -= 20
  }

  // === SECCION DE FIRMAS ===
  y -= 10
  page.drawLine({ start: { x: margin, y: y + 10 }, end: { x: width - margin, y: y + 10 }, thickness: 1, color: lightGray })

  page.drawText("FIRMAS DE CONFORMIDAD", { x: margin, y: y - 5, size: 10, font: helveticaBold, color: primaryColor })
  y -= 25

  // Incrustar firma del cliente
  const firmaClienteX = margin
  const firmaEncargadoX = margin + halfWidth + cardGap

  // Card Firma Cliente
  page.drawRectangle({ x: firmaClienteX, y: y - 100, width: halfWidth, height: 105, color: bgGray })
  page.drawText("CLIENTE (quien recibe)", { x: firmaClienteX + 12, y: y - 12, size: 8, font: helveticaBold, color: grayColor })

  // Incrustar imagen de firma del cliente
  try {
    const firmaClienteBytes = Uint8Array.from(atob(data.firmaClienteEntrega), c => c.charCodeAt(0))
    const firmaClienteImage = await pdfDoc.embedPng(firmaClienteBytes)
    const clienteDims = firmaClienteImage.scale(1)
    const clienteScale = Math.min(100 / clienteDims.width, 50 / clienteDims.height)
    page.drawImage(firmaClienteImage, {
      x: firmaClienteX + (halfWidth - clienteDims.width * clienteScale) / 2,
      y: y - 70,
      width: clienteDims.width * clienteScale,
      height: clienteDims.height * clienteScale,
    })
  } catch (e) {
    console.error("Error embedding client signature:", e)
  }

  page.drawLine({ start: { x: firmaClienteX + 20, y: y - 80 }, end: { x: firmaClienteX + halfWidth - 20, y: y - 80 }, thickness: 1, color: grayColor })
  page.drawText(clienteNombre.substring(0, 25), { x: firmaClienteX + 30, y: y - 92, size: 8, font: helvetica, color: textColor })

  // Card Firma Encargado
  page.drawRectangle({ x: firmaEncargadoX, y: y - 100, width: halfWidth, height: 105, color: bgGray })
  page.drawText("ENCARGADO (quien entrega)", { x: firmaEncargadoX + 12, y: y - 12, size: 8, font: helveticaBold, color: grayColor })

  // Incrustar imagen de firma del encargado
  try {
    const firmaEncargadoBytes = Uint8Array.from(atob(data.firmaEncargadoEntrega), c => c.charCodeAt(0))
    const firmaEncargadoImage = await pdfDoc.embedPng(firmaEncargadoBytes)
    const encargadoDims = firmaEncargadoImage.scale(1)
    const encargadoScale = Math.min(100 / encargadoDims.width, 50 / encargadoDims.height)
    page.drawImage(firmaEncargadoImage, {
      x: firmaEncargadoX + (halfWidth - encargadoDims.width * encargadoScale) / 2,
      y: y - 70,
      width: encargadoDims.width * encargadoScale,
      height: encargadoDims.height * encargadoScale,
    })
  } catch (e) {
    console.error("Error embedding staff signature:", e)
  }

  page.drawLine({ start: { x: firmaEncargadoX + 20, y: y - 80 }, end: { x: firmaEncargadoX + halfWidth - 20, y: y - 80 }, thickness: 1, color: grayColor })
  page.drawText(entregadoPor.substring(0, 25), { x: firmaEncargadoX + 30, y: y - 92, size: 8, font: helvetica, color: textColor })

  // === FOOTER ===
  const footerTop = 80
  page.drawRectangle({ x: margin, y: 25, width: contentWidth, height: footerTop - 20, color: bgGray })

  const terminosTitle = esRetiro ? "TÉRMINOS DE RETIRO" : "TÉRMINOS DE ENTREGA"
  page.drawText(terminosTitle, { x: margin + 10, y: footerTop - 5, size: 7, font: helveticaBold, color: grayColor })
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
  let termY = footerTop - 18
  terminos.forEach(t => {
    page.drawText(t, { x: margin + 10, y: termY, size: 6, font: helvetica, color: grayColor })
    termY -= 10
  })

  page.drawText(`Orden ${ordenDisplay}`, { x: margin + 10, y: 30, size: 7, font: helveticaBold, color: accentColor })

  const fechaImpresion2 = formatDateTimeValue(new Date(), data.zonaHoraria || DEFAULT_TIMEZONE)
  page.drawText(`Impreso: ${fechaImpresion2}`, { x: width - margin - 90, y: 30, size: 6, font: helvetica, color: grayColor })

  // === BARRA INFERIOR ===
  page.drawRectangle({ x: 0, y: 0, width, height: 8, color: accentColor })

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
  orden: {
    numeroOrden: number
    codigoOrden?: string | null
    dispositivo: string
  }
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
  const ordenDisplay = data.orden.codigoOrden || `#${String(data.orden.numeroOrden).padStart(4, "0")}`
  const dispositivo = safe(data.orden.dispositivo)
  const pendiente = data.total - (data.montoAbonado || 0)

  // Crear documento PDF
  const pdfDoc = await PDFLib.create()
  const page = pdfDoc.addPage([595, 842]) // A4
  const { width, height } = page.getSize()

  const { regular: helvetica, bold: helveticaBold } = await embedCustomFonts(pdfDoc)

  // Colores (mismo theme indigo)
  const primaryColor = rgb(0.388, 0.400, 0.945) // #6366f1
  const primaryDark = rgb(0.118, 0.106, 0.294) // #1e1b4b
  const textColor = rgb(0.118, 0.161, 0.231) // #1e293b
  const grayColor = rgb(0.392, 0.455, 0.545) // #64748b
  const lightGray = rgb(0.886, 0.910, 0.941) // #e2e8f0
  const bgGray = rgb(0.973, 0.980, 0.988) // #f8fafc
  const white = rgb(1, 1, 1)
  const greenColor = rgb(0.134, 0.545, 0.373)
  const redColor = rgb(0.8, 0.2, 0.2)
  const orangeColor = rgb(0.85, 0.55, 0.1)

  const margin = 40
  const contentWidth = width - (margin * 2)

  // === BARRA DE ACENTO SUPERIOR ===
  page.drawRectangle({ x: 0, y: height - 10, width, height: 10, color: primaryColor })

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
  page.drawText(empresaNombre, { x: margin + logoWidth, y, size: 20, font: helveticaBold, color: textColor })
  y -= 16
  if (telefonoEmpresa) {
    page.drawText(`Tel: ${telefonoEmpresa}`, { x: margin + logoWidth, y, size: 9, font: helvetica, color: grayColor })
    y -= 12
  }
  if (direccionEmpresa) {
    page.drawText(direccionEmpresa, { x: margin + logoWidth, y, size: 9, font: helvetica, color: grayColor })
    y -= 12
  }

  // Badge de factura (lado derecho)
  const facturaText = `FACTURA ${numeroFactura}`
  const facturaTextWidth = helveticaBold.widthOfTextAtSize(facturaText, 14)
  page.drawRectangle({
    x: width - margin - facturaTextWidth - 24,
    y: height - margin - 35,
    width: facturaTextWidth + 20,
    height: 26,
    color: primaryColor,
  })
  page.drawText(facturaText, {
    x: width - margin - facturaTextWidth - 14,
    y: height - margin - 27,
    size: 14,
    font: helveticaBold,
    color: white,
  })
  page.drawText(`Fecha: ${fecha}`, {
    x: width - margin - 100,
    y: height - margin - 55,
    size: 9,
    font: helvetica,
    color: grayColor,
  })

  y = height - margin - 90

  // Linea separadora
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 2, color: primaryColor })
  y -= 20

  // === TITULO ===
  const titleText = "FACTURA"
  const titleWidth = helveticaBold.widthOfTextAtSize(titleText, 14)
  page.drawText(titleText, { x: (width - titleWidth) / 2, y, size: 14, font: helveticaBold, color: primaryColor })
  y -= 30

  // === DATOS DEL CLIENTE ===
  const clientBoxHeight = 60
  page.drawRectangle({ x: margin, y: y - clientBoxHeight + 10, width: contentWidth / 2 - 10, height: clientBoxHeight, color: bgGray })
  page.drawText("CLIENTE", { x: margin + 10, y: y - 5, size: 9, font: helveticaBold, color: primaryColor })
  page.drawText(clienteNombre, { x: margin + 10, y: y - 20, size: 10, font: helvetica, color: textColor })
  let clientY = y - 33
  if (clienteTelefono) {
    page.drawText(`Tel: ${clienteTelefono}`, { x: margin + 10, y: clientY, size: 9, font: helvetica, color: grayColor })
    clientY -= 12
  }
  if (clienteEmail) {
    page.drawText(clienteEmail, { x: margin + 10, y: clientY, size: 9, font: helvetica, color: grayColor })
  }

  // === DATOS DE LA ORDEN ===
  page.drawRectangle({ x: margin + contentWidth / 2 + 10, y: y - clientBoxHeight + 10, width: contentWidth / 2 - 10, height: clientBoxHeight, color: bgGray })
  page.drawText("ORDEN DE SERVICIO", { x: margin + contentWidth / 2 + 20, y: y - 5, size: 9, font: helveticaBold, color: primaryColor })
  page.drawText(`Orden: ${ordenDisplay}`, { x: margin + contentWidth / 2 + 20, y: y - 20, size: 10, font: helvetica, color: textColor })
  page.drawText(`Dispositivo: ${dispositivo}`, { x: margin + contentWidth / 2 + 20, y: y - 33, size: 9, font: helvetica, color: grayColor })

  y -= clientBoxHeight + 15

  // === DETALLE DE MONTOS ===
  page.drawText("DETALLE", { x: margin, y, size: 10, font: helveticaBold, color: primaryColor })
  y -= 5
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1, color: lightGray })
  y -= 20

  // Header de tabla
  page.drawRectangle({ x: margin, y: y - 5, width: contentWidth, height: 22, color: primaryColor })
  page.drawText("Concepto", { x: margin + 10, y, size: 9, font: helveticaBold, color: white })
  page.drawText("Monto", { x: width - margin - 100, y, size: 9, font: helveticaBold, color: white })
  y -= 25

  // Subtotal
  page.drawText("Subtotal", { x: margin + 10, y, size: 10, font: helvetica, color: textColor })
  page.drawText(formatCurrencyPDF(data.subtotal), { x: width - margin - 100, y, size: 10, font: helvetica, color: textColor })
  y -= 18
  page.drawLine({ start: { x: margin, y: y + 5 }, end: { x: width - margin, y: y + 5 }, thickness: 0.5, color: lightGray })

  // IVA
  if (data.iva > 0) {
    page.drawText("IVA", { x: margin + 10, y, size: 10, font: helvetica, color: textColor })
    page.drawText(formatCurrencyPDF(data.iva), { x: width - margin - 100, y, size: 10, font: helvetica, color: textColor })
    y -= 18
    page.drawLine({ start: { x: margin, y: y + 5 }, end: { x: width - margin, y: y + 5 }, thickness: 0.5, color: lightGray })
  }

  // Linea antes del total
  y -= 5
  page.drawLine({ start: { x: margin, y: y + 5 }, end: { x: width - margin, y: y + 5 }, thickness: 1.5, color: primaryColor })
  y -= 5

  // Total
  page.drawRectangle({ x: margin, y: y - 8, width: contentWidth, height: 28, color: bgGray })
  page.drawText("TOTAL", { x: margin + 10, y, size: 12, font: helveticaBold, color: textColor })
  page.drawText(formatCurrencyPDF(data.total), { x: width - margin - 100, y, size: 12, font: helveticaBold, color: primaryColor })
  y -= 35

  // === ESTADO DE PAGO ===
  const estadoLabel = estadoPagoLabels[data.estadoPago] || data.estadoPago
  let estadoColor = grayColor
  if (data.estadoPago === "PAGADO") estadoColor = greenColor
  else if (data.estadoPago === "PENDIENTE") estadoColor = redColor
  else if (data.estadoPago === "PAGADO_PARCIAL") estadoColor = orangeColor
  else if (data.estadoPago === "ANULADA") estadoColor = redColor

  page.drawText("ESTADO DE PAGO", { x: margin, y, size: 10, font: helveticaBold, color: primaryColor })
  y -= 5
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1, color: lightGray })
  y -= 20

  // Badge del estado
  const estadoBadgeWidth = helveticaBold.widthOfTextAtSize(estadoLabel, 11) + 20
  page.drawRectangle({ x: margin, y: y - 6, width: estadoBadgeWidth, height: 22, color: estadoColor })
  page.drawText(estadoLabel, { x: margin + 10, y: y, size: 11, font: helveticaBold, color: white })

  // Montos abonado y pendiente al lado
  const montoX = margin + estadoBadgeWidth + 30
  page.drawText(`Abonado: ${formatCurrencyPDF(data.montoAbonado)}`, { x: montoX, y: y + 2, size: 10, font: helvetica, color: greenColor })
  if (pendiente > 0 && data.estadoPago !== "ANULADA") {
    page.drawText(`Pendiente: ${formatCurrencyPDF(pendiente)}`, { x: montoX + 160, y: y + 2, size: 10, font: helveticaBold, color: redColor })
  }

  y -= 35

  // === HISTORIAL DE PAGOS ===
  if (data.pagos && data.pagos.length > 0) {
    page.drawText("HISTORIAL DE PAGOS", { x: margin, y, size: 10, font: helveticaBold, color: primaryColor })
    y -= 5
    page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1, color: lightGray })
    y -= 20

    // Header
    page.drawRectangle({ x: margin, y: y - 5, width: contentWidth, height: 22, color: primaryColor })
    page.drawText("Fecha", { x: margin + 10, y, size: 9, font: helveticaBold, color: white })
    page.drawText("Método", { x: margin + 140, y, size: 9, font: helveticaBold, color: white })
    page.drawText("Referencia", { x: margin + 280, y, size: 9, font: helveticaBold, color: white })
    page.drawText("Monto", { x: width - margin - 90, y, size: 9, font: helveticaBold, color: white })
    y -= 25

    for (const pago of data.pagos) {
      const pagoFecha = formatDatePDF(pago.fecha)
      const pagoMetodo = metodoPagoFacturaLabels[pago.metodoPago] || pago.metodoPago
      const pagoRef = safe(pago.referencia)

      page.drawText(pagoFecha, { x: margin + 10, y, size: 9, font: helvetica, color: textColor })
      page.drawText(pagoMetodo, { x: margin + 140, y, size: 9, font: helvetica, color: textColor })
      if (pagoRef) {
        page.drawText(pagoRef.substring(0, 25), { x: margin + 280, y, size: 9, font: helvetica, color: grayColor })
      }
      page.drawText(formatCurrencyPDF(pago.monto), { x: width - margin - 90, y, size: 9, font: helveticaBold, color: greenColor })
      y -= 18
      page.drawLine({ start: { x: margin, y: y + 5 }, end: { x: width - margin, y: y + 5 }, thickness: 0.5, color: lightGray })

      // Check if we need a new page
      if (y < margin + 80) {
        break
      }
    }
  }

  // === FOOTER ===
  const footerY = margin + 50

  page.drawLine({ start: { x: margin, y: footerY }, end: { x: width - margin, y: footerY }, thickness: 1, color: lightGray })

  page.drawText("Este documento es un comprobante interno de facturacion.", { x: margin, y: footerY - 15, size: 8, font: helvetica, color: grayColor })
  page.drawText("Conserve este comprobante para su registro.", { x: margin, y: footerY - 27, size: 8, font: helvetica, color: grayColor })

  const fechaImpresion = formatDateTimeValue(new Date(), data.zonaHoraria || DEFAULT_TIMEZONE)
  page.drawText(`Impreso: ${fechaImpresion}`, { x: width - margin - 110, y: footerY - 27, size: 7, font: helvetica, color: grayColor })

  // Barra inferior
  page.drawRectangle({ x: 0, y: 0, width, height: 8, color: primaryColor })

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

  const { regular: helvetica, bold: helveticaBold } = await embedCustomFonts(pdfDoc)

  const primaryColor = rgb(0.388, 0.400, 0.945)
  const primaryDark = rgb(0.118, 0.106, 0.294)
  const textColor = rgb(0.118, 0.161, 0.231)
  const grayColor = rgb(0.396, 0.455, 0.525)
  const redColor = rgb(0.863, 0.196, 0.184)
  const lightBg = rgb(0.969, 0.973, 0.984)

  let y = height - 8

  // Accent bar
  page.drawRectangle({ x: 0, y: height - 8, width, height: 8, color: primaryColor })
  y -= 40

  // Header
  const empresaNombre = safe(data.nombreEmpresa) || "Servicio Técnico"
  page.drawText(empresaNombre, { x: margin, y, size: 18, font: helveticaBold, color: primaryDark })

  const telefonoEmpresa = safe(data.telefonoEmpresa)
  const direccionEmpresa = safe(data.direccionEmpresa)
  if (telefonoEmpresa) {
    y -= 14
    page.drawText(telefonoEmpresa, { x: margin, y, size: 9, font: helvetica, color: grayColor })
  }
  if (direccionEmpresa) {
    y -= 12
    page.drawText(direccionEmpresa, { x: margin, y, size: 9, font: helvetica, color: grayColor })
  }

  // Badge
  const badgeW = 160
  const badgeH = 28
  const badgeX = width - margin - badgeW
  const badgeY = height - 48
  page.drawRectangle({ x: badgeX, y: badgeY, width: badgeW, height: badgeH, color: redColor })
  page.drawText("NOTA DE CRÉDITO", { x: badgeX + 20, y: badgeY + 9, size: 11, font: helveticaBold, color: rgb(1, 1, 1) })

  page.drawText(data.numeroDevolucion, { x: badgeX, y: badgeY - 16, size: 10, font: helveticaBold, color: textColor })
  page.drawText(`Fecha: ${formatDatePDF(data.fecha)}`, { x: badgeX, y: badgeY - 30, size: 9, font: helvetica, color: grayColor })

  y -= 30

  // Separator
  page.drawRectangle({ x: margin, y, width: width - margin * 2, height: 1, color: lightBg })
  y -= 25

  // Info section
  const col1X = margin
  const col2X = width / 2 + 20

  page.drawText("CLIENTE", { x: col1X, y, size: 8, font: helveticaBold, color: grayColor })
  page.drawText("REFERENCIA", { x: col2X, y, size: 8, font: helveticaBold, color: grayColor })
  y -= 14

  const clienteNombre = safe(data.cliente?.nombre) || "Consumidor Final"
  page.drawText(clienteNombre, { x: col1X, y, size: 10, font: helveticaBold, color: textColor })
  page.drawText(`Venta V${String(data.ventaNumero).padStart(4, "0")}`, { x: col2X, y, size: 10, font: helveticaBold, color: textColor })
  y -= 13

  if (data.cliente?.telefono) {
    page.drawText(safe(data.cliente.telefono), { x: col1X, y, size: 9, font: helvetica, color: grayColor })
  }
  page.drawText(`Tipo: ${safe(data.tipo)}`, { x: col2X, y, size: 9, font: helvetica, color: grayColor })
  y -= 13
  page.drawText(`Motivo: ${safe(data.motivo)}`, { x: col2X, y, size: 9, font: helvetica, color: grayColor })

  y -= 25

  // Items table header
  const tableW = width - margin * 2
  page.drawRectangle({ x: margin, y: y - 2, width: tableW, height: 22, color: primaryColor })

  const colWidths = [tableW * 0.5, tableW * 0.15, tableW * 0.15, tableW * 0.2]
  const colX = [margin + 8, margin + colWidths[0], margin + colWidths[0] + colWidths[1], margin + colWidths[0] + colWidths[1] + colWidths[2]]

  page.drawText("Producto", { x: colX[0], y: y + 4, size: 9, font: helveticaBold, color: rgb(1, 1, 1) })
  page.drawText("Cant.", { x: colX[1] + 10, y: y + 4, size: 9, font: helveticaBold, color: rgb(1, 1, 1) })
  page.drawText("Precio", { x: colX[2] + 5, y: y + 4, size: 9, font: helveticaBold, color: rgb(1, 1, 1) })
  page.drawText("Subtotal", { x: colX[3] + 5, y: y + 4, size: 9, font: helveticaBold, color: rgb(1, 1, 1) })

  y -= 24

  // Items rows
  for (let i = 0; i < data.items.length; i++) {
    const item = data.items[i]
    if (i % 2 === 0) {
      page.drawRectangle({ x: margin, y: y - 4, width: tableW, height: 20, color: lightBg })
    }

    const desc = safe(item.descripcion).substring(0, 45)
    page.drawText(desc, { x: colX[0], y: y + 2, size: 9, font: helvetica, color: textColor })
    page.drawText(String(item.cantidad), { x: colX[1] + 15, y: y + 2, size: 9, font: helvetica, color: textColor })
    page.drawText(formatCurrencyPDF(item.precioUnitario), { x: colX[2] + 5, y: y + 2, size: 9, font: helvetica, color: textColor })
    page.drawText(formatCurrencyPDF(item.subtotal), { x: colX[3] + 5, y: y + 2, size: 9, font: helveticaBold, color: textColor })

    y -= 20
  }

  y -= 10

  // Total
  const totalBoxW = 200
  const totalBoxX = width - margin - totalBoxW
  page.drawRectangle({ x: totalBoxX, y: y - 5, width: totalBoxW, height: 30, color: rgb(0.95, 0.92, 0.92) })
  page.drawText("TOTAL DEVOLUCIÓN:", { x: totalBoxX + 10, y: y + 5, size: 10, font: helveticaBold, color: redColor })
  const totalText = formatCurrencyPDF(data.montoDevolucion)
  const totalTextW = helveticaBold.widthOfTextAtSize(totalText, 12)
  page.drawText(totalText, { x: totalBoxX + totalBoxW - totalTextW - 10, y: y + 3, size: 12, font: helveticaBold, color: redColor })

  y -= 30

  // Observaciones
  if (data.observaciones) {
    y -= 15
    page.drawText("Observaciones:", { x: margin, y, size: 9, font: helveticaBold, color: grayColor })
    y -= 13
    page.drawText(safe(data.observaciones).substring(0, 120), { x: margin, y, size: 9, font: helvetica, color: textColor })
  }

  // Footer
  const footerY = 40
  page.drawRectangle({ x: margin, y: footerY + 10, width: width - margin * 2, height: 1, color: lightBg })
  page.drawText("Este documento es una nota de crédito válida.", { x: margin, y: footerY - 5, size: 8, font: helvetica, color: grayColor })

  const fechaImpresion = formatDateTimeValue(new Date(), data.zonaHoraria || DEFAULT_TIMEZONE)
  page.drawText(`Impreso: ${fechaImpresion}`, { x: width - margin - 110, y: footerY - 5, size: 7, font: helvetica, color: grayColor })

  // Bottom bar
  page.drawRectangle({ x: 0, y: 0, width, height: 8, color: redColor })

  const pdfBytes = await pdfDoc.save()
  return Buffer.from(pdfBytes)
}

export type { CotizacionPDFData, CotizacionItem, OrdenPDFData, VentaPDFData, VentaItem, GarantiaVentaPDFData, ComprobanteEntregaPDFData, FacturaPDFData, FacturaPago, DevolucionPDFData }
