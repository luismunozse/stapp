import { NextResponse } from "next/server"
import { requireAdminOrVendedor } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { PDFDocument, rgb, StandardFonts } from "pdf-lib"
import { formatCurrencyValue, type CurrencyCode, DEFAULT_CURRENCY } from "@/lib/currency"
import { formatDateValue, formatDateTimeValue, DEFAULT_TIMEZONE } from "@/lib/timezone"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; devolucionId: string }> }
) {
  try {
    const { error, organizationId, userId, role } = await requireAdminOrVendedor()
    if (error) return error

    const { id, devolucionId } = await params

    // Verify the sale belongs to the organization
    const { data: venta, error: ventaError } = await supabaseAdmin
      .from("ventas")
      .select(`
        *,
        organizations!inner (
          nombre,
          nombre_mostrar,
          telefono,
          direccion,
          logo_url,
          moneda,
          zona_horaria
        )
      `)
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (ventaError || !venta) {
      return NextResponse.json(
        { error: "Venta no encontrada" },
        { status: 404 }
      )
    }

    // Fetch devolucion with items
    const { data: devolucion, error: devError } = await supabaseAdmin
      .from("devoluciones_venta")
      .select(`
        *,
        items_devolucion (
          *,
          items_venta (
            descripcion,
            inventario (nombre, codigo)
          )
        )
      `)
      .eq("id", devolucionId)
      .eq("venta_id", id)
      .single()

    if (devError || !devolucion) {
      return NextResponse.json(
        { error: "Devolución no encontrada" },
        { status: 404 }
      )
    }

    const org = venta.organizations
    const moneda = (org?.moneda || "ARS") as CurrencyCode
    const zonaHoraria = org?.zona_horaria || DEFAULT_TIMEZONE

    // Helper functions
    const safe = (val: unknown): string => {
      if (val === null || val === undefined) return ""
      if (typeof val === "string") return val
      if (typeof val === "number") return String(val)
      return ""
    }

    const formatDatePDF = (date: Date | string | null | undefined): string => {
      return formatDateValue(date, zonaHoraria)
    }

    const formatCurrencyPDF = (amount: number | null | undefined): string => {
      return formatCurrencyValue(amount, moneda)
    }

    // Extract data
    const empresaNombre = safe(org?.nombre_mostrar || org?.nombre) || "Servicio Tecnico"
    const telefonoEmpresa = safe(org?.telefono)
    const direccionEmpresa = safe(org?.direccion)
    const numeroDevolucion = safe(devolucion.numero_devolucion)
    const fecha = formatDatePDF(devolucion.created_at)
    const clienteNombre = safe(venta.cliente_nombre) || "Consumidor Final"
    const clienteTelefono = safe(venta.cliente_telefono)
    const numeroVenta = venta.numero_venta
    const motivo = safe(devolucion.motivo)
    const observaciones = safe(devolucion.observaciones)
    const montoDevolucion = parseFloat(devolucion.monto_devolucion)

    // Create PDF document
    const pdfDoc = await PDFDocument.create()
    const page = pdfDoc.addPage([595, 842]) // A4
    const { width, height } = page.getSize()

    // Load fonts
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica)
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

    // Colors (Indigo theme, matching existing PDFs)
    const primaryColor = rgb(0.388, 0.400, 0.945) // #6366f1
    const textColor = rgb(0.118, 0.161, 0.231) // #1e293b
    const grayColor = rgb(0.392, 0.455, 0.545) // #64748b
    const lightGray = rgb(0.886, 0.910, 0.941) // #e2e8f0
    const bgGray = rgb(0.973, 0.980, 0.988) // #f8fafc
    const white = rgb(1, 1, 1)
    const redColor = rgb(0.8, 0.2, 0.2)

    const margin = 40
    const contentWidth = width - (margin * 2)

    // === ACCENT BAR TOP ===
    page.drawRectangle({
      x: 0,
      y: height - 10,
      width: width,
      height: 10,
      color: primaryColor,
    })

    let y = height - margin - 20

    // === LOGO (if exists) ===
    let logoWidth = 0
    if (org?.logo_url) {
      try {
        const logoResponse = await fetch(org.logo_url)
        if (logoResponse.ok) {
          const logoArrayBuffer = await logoResponse.arrayBuffer()
          const logoBytes = new Uint8Array(logoArrayBuffer)

          let logoImage
          const contentType = logoResponse.headers.get("content-type") || ""

          if (contentType.includes("png") || org.logo_url.toLowerCase().includes(".png")) {
            logoImage = await pdfDoc.embedPng(logoBytes)
          } else if (contentType.includes("jpeg") || contentType.includes("jpg") || org.logo_url.toLowerCase().includes(".jpg") || org.logo_url.toLowerCase().includes(".jpeg")) {
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

    // Devolucion number badge (right side)
    const devText = `${numeroDevolucion}`
    const devTextWidth = helveticaBold.widthOfTextAtSize(devText, 14)
    page.drawRectangle({
      x: width - margin - devTextWidth - 20,
      y: height - margin - 35,
      width: devTextWidth + 16,
      height: 26,
      color: redColor,
    })
    page.drawText(devText, {
      x: width - margin - devTextWidth - 12,
      y: height - margin - 27,
      size: 14,
      font: helveticaBold,
      color: white,
    })
    page.drawText(`Fecha: ${fecha}`, {
      x: width - margin - 90,
      y: height - margin - 55,
      size: 9,
      font: helvetica,
      color: grayColor,
    })

    y = height - margin - 90

    // Separator line
    page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 2, color: primaryColor })
    y -= 20

    // === TITLE ===
    const titleText = "NOTA DE CREDITO / DEVOLUCION"
    const titleWidth = helveticaBold.widthOfTextAtSize(titleText, 14)
    page.drawText(titleText, { x: (width - titleWidth) / 2, y, size: 14, font: helveticaBold, color: primaryColor })
    y -= 30

    // === CLIENT AND SALE INFO (two columns) ===
    // Left column: Client
    page.drawRectangle({ x: margin, y: y - 50, width: contentWidth / 2 - 10, height: 60, color: bgGray })
    page.drawText("CLIENTE", { x: margin + 10, y: y - 5, size: 9, font: helveticaBold, color: primaryColor })
    page.drawText(clienteNombre, { x: margin + 10, y: y - 20, size: 10, font: helvetica, color: textColor })
    if (clienteTelefono) {
      page.drawText(`Tel: ${clienteTelefono}`, { x: margin + 10, y: y - 33, size: 9, font: helvetica, color: grayColor })
    }
    page.drawText(`Venta: #${String(numeroVenta).padStart(4, "0")}`, { x: margin + 10, y: y - 46, size: 9, font: helvetica, color: grayColor })

    // Right column: Return info
    page.drawRectangle({ x: margin + contentWidth / 2 + 10, y: y - 50, width: contentWidth / 2 - 10, height: 60, color: bgGray })
    page.drawText("DEVOLUCION", { x: margin + contentWidth / 2 + 20, y: y - 5, size: 9, font: helveticaBold, color: primaryColor })
    page.drawText(`Tipo: ${devolucion.tipo}`, { x: margin + contentWidth / 2 + 20, y: y - 20, size: 10, font: helvetica, color: textColor })
    page.drawText(`Estado: ${devolucion.estado}`, { x: margin + contentWidth / 2 + 20, y: y - 33, size: 9, font: helvetica, color: grayColor })

    y -= 70

    // === MOTIVO ===
    page.drawText("MOTIVO", { x: margin, y, size: 10, font: helveticaBold, color: primaryColor })
    y -= 15
    // Wrap motivo text if needed
    const maxMotivoWidth = contentWidth
    const motivoLines = wrapText(motivo, helvetica, 9, maxMotivoWidth)
    for (const line of motivoLines) {
      page.drawText(line, { x: margin, y, size: 9, font: helvetica, color: textColor })
      y -= 14
    }

    if (observaciones) {
      y -= 5
      page.drawText("OBSERVACIONES", { x: margin, y, size: 10, font: helveticaBold, color: primaryColor })
      y -= 15
      const obsLines = wrapText(observaciones, helvetica, 9, maxMotivoWidth)
      for (const line of obsLines) {
        page.drawText(line, { x: margin, y, size: 9, font: helvetica, color: textColor })
        y -= 14
      }
    }

    y -= 10

    // === ITEMS TABLE ===
    page.drawText("DETALLE DE ITEMS DEVUELTOS", { x: margin, y, size: 10, font: helveticaBold, color: primaryColor })
    y -= 5
    page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1, color: lightGray })
    y -= 20

    // Table header
    page.drawRectangle({ x: margin, y: y - 5, width: contentWidth, height: 22, color: primaryColor })
    page.drawText("Descripcion", { x: margin + 10, y: y, size: 9, font: helveticaBold, color: white })
    page.drawText("Cant.", { x: margin + 300, y: y, size: 9, font: helveticaBold, color: white })
    page.drawText("P. Unit.", { x: margin + 350, y: y, size: 9, font: helveticaBold, color: white })
    page.drawText("Subtotal", { x: margin + 430, y: y, size: 9, font: helveticaBold, color: white })
    y -= 25

    // Table rows
    for (const item of devolucion.items_devolucion || []) {
      const descripcion = item.items_venta?.descripcion || "Sin descripcion"
      const cantidad = item.cantidad
      const precioUnitario = parseFloat(item.precio_unitario)
      const subtotal = parseFloat(item.subtotal)

      page.drawText(descripcion.substring(0, 45), { x: margin + 10, y, size: 9, font: helvetica, color: textColor })
      page.drawText(String(cantidad), { x: margin + 305, y, size: 9, font: helvetica, color: textColor })
      page.drawText(formatCurrencyPDF(precioUnitario), { x: margin + 350, y, size: 9, font: helvetica, color: textColor })
      page.drawText(formatCurrencyPDF(subtotal), { x: margin + 430, y, size: 9, font: helvetica, color: textColor })
      y -= 18
      page.drawLine({ start: { x: margin, y: y + 5 }, end: { x: width - margin, y: y + 5 }, thickness: 0.5, color: lightGray })
    }

    y -= 20

    // === TOTAL ===
    const totalsX = width - margin - 180

    page.drawLine({ start: { x: totalsX, y: y + 5 }, end: { x: width - margin, y: y + 5 }, thickness: 1, color: primaryColor })
    y -= 5

    page.drawText("TOTAL DEVOLUCION:", { x: totalsX, y, size: 12, font: helveticaBold, color: textColor })
    page.drawText(formatCurrencyPDF(montoDevolucion), { x: totalsX + 130, y, size: 12, font: helveticaBold, color: redColor })

    // === FOOTER ===
    const footerY = margin + 60

    page.drawLine({ start: { x: margin, y: footerY }, end: { x: width - margin, y: footerY }, thickness: 1, color: lightGray })

    page.drawText("Este documento es una Nota de Credito/Devolucion.", { x: margin, y: footerY - 15, size: 8, font: helvetica, color: grayColor })
    page.drawText("Conserve este comprobante como constancia de la devolucion realizada.", { x: margin, y: footerY - 27, size: 8, font: helvetica, color: grayColor })

    const fechaImpresion = formatDateTimeValue(new Date(), zonaHoraria)
    page.drawText(`Impreso: ${fechaImpresion}`, { x: width - margin - 110, y: footerY - 27, size: 7, font: helvetica, color: grayColor })

    // Bottom accent bar
    page.drawRectangle({
      x: 0,
      y: 0,
      width: width,
      height: 8,
      color: primaryColor,
    })

    const pdfBytes = await pdfDoc.save()
    const pdfBuffer = Buffer.from(pdfBytes)

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="devolucion-${numeroDevolucion}.pdf"`,
        "Cache-Control": "private, max-age=3600",
      },
    })
  } catch (error) {
    console.error("Error generating devolucion PDF:", error)
    return NextResponse.json(
      { error: "Error al generar PDF de devolución" },
      { status: 500 }
    )
  }
}

// Helper: wrap text to fit within maxWidth
function wrapText(
  text: string,
  font: any,
  fontSize: number,
  maxWidth: number
): string[] {
  const words = text.split(" ")
  const lines: string[] = []
  let currentLine = ""

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word
    const testWidth = font.widthOfTextAtSize(testLine, fontSize)

    if (testWidth > maxWidth && currentLine) {
      lines.push(currentLine)
      currentLine = word
    } else {
      currentLine = testLine
    }
  }

  if (currentLine) {
    lines.push(currentLine)
  }

  return lines
}
