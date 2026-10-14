import { escapeHtml } from "@/lib/escape-html"

/**
 * HTML del ticket que se imprime con el diálogo del navegador cuando no hay
 * impresora USB. Se escribe con document.write en una ventana del mismo origen
 * que la app, así que todo dato que venga del usuario va escapado: el nombre del
 * cliente puede cargarlo un visitante anónimo desde el catálogo público
 * (cotizar), y un `<img onerror>` ahí correría con la sesión del cajero.
 */

export interface TicketHtmlItem {
  descripcion: string
  cantidad: number
  precioUnitario: number
}

export interface TicketHtmlVenta {
  numeroVenta: number | string
  clienteNombre?: string | null
  clienteTelefono?: string | null
  organizationName?: string | null
  /** Fecha de la venta; al reimprimir tiene que salir la original, no la de hoy. */
  createdAt?: string | null
  items?: TicketHtmlItem[]
  subtotal?: number | null
  descuento?: number | null
  total: number
  ivaRegimen?: string | null
  ivaTasa?: number | null
  ivaMonto?: number | null
  redondeoMonto?: number | null
  /** Lo que queda a pagar (venta fiada o pago parcial). */
  saldoPendiente?: number | null
}

export interface TicketHtmlOptions {
  timezone: string
  printerWidth: number
  formatPrice?: (n: number) => string
  /** Solo para tests: fecha a usar cuando la venta no trae createdAt. */
  now?: Date
  /** Logo ya binarizado (data URL); nunca la URL remota. */
  logoDataUrl?: string | null
}

const defaultFormatPrice = (n: number) =>
  "$ " + n.toLocaleString("es-AR", { minimumFractionDigits: 2 })

export function buildTicketHTML(venta: TicketHtmlVenta, opts: TicketHtmlOptions): string {
  const fmt = opts.formatPrice ?? defaultFormatPrice
  const { printerWidth } = opts
  const items = venta.items || []
  const subtotal =
    venta.subtotal ?? items.reduce((s, i) => s + i.cantidad * i.precioUnitario, 0)
  const descuento = venta.descuento || 0
  const empresa = escapeHtml(venta.organizationName || "Servicio Técnico")
  const cliente = escapeHtml(venta.clienteNombre || "Consumidor Final")
  const telefono = venta.clienteTelefono ? escapeHtml(venta.clienteTelefono) : ""
  const numero = escapeHtml(String(venta.numeroVenta).padStart(4, "0"))
  const fechaBase = venta.createdAt ? new Date(venta.createdAt) : opts.now ?? new Date()
  const fecha = escapeHtml(
    fechaBase.toLocaleString("es-AR", {
      timeZone: opts.timezone,
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    })
  )

  const itemsHTML = items.map((item) => `
      <div style="margin-bottom:6px">
        <div style="font-weight:bold">${escapeHtml(item.descripcion)}</div>
        <div style="display:flex;justify-content:space-between;color:#555">
          <span>&nbsp;&nbsp;${Number(item.cantidad)} x ${escapeHtml(fmt(item.precioUnitario))}</span>
          <span style="font-weight:bold;color:#000">${escapeHtml(fmt(item.cantidad * item.precioUnitario))}</span>
        </div>
      </div>
    `).join("")

  // Lineas fiscales: sin ellas el ticket de una org con IVA aditivo decia
  // "Subtotal $1.000 / TOTAL $1.210" y no cuadraba.
  const tasa = venta.ivaTasa != null ? Number(venta.ivaTasa) : null
  const ivaMonto = Number(venta.ivaMonto || 0)
  const tasaTxt = tasa ? ` (${escapeHtml(String(tasa))}%)` : ""
  let fiscalHTML = ""
  if (venta.ivaRegimen === "ADITIVO" && ivaMonto > 0) {
    fiscalHTML += `<div class="row"><span>IVA${tasaTxt}:</span><span>${escapeHtml(fmt(ivaMonto))}</span></div>`
  }
  const redondeo = Number(venta.redondeoMonto || 0)
  if (redondeo !== 0) {
    const signo = redondeo > 0 ? "+" : "-"
    fiscalHTML += `<div class="row"><span>Redondeo:</span><span>${signo}${escapeHtml(fmt(Math.abs(redondeo)))}</span></div>`
  }
  const ivaIncluidoHTML =
    venta.ivaRegimen === "INCLUIDO" && ivaMonto > 0
      ? `<div class="center small">IVA incluido${tasaTxt}: ${escapeHtml(fmt(ivaMonto))}</div>`
      : ""

  const logoHTML = opts.logoDataUrl
    ? `<div class="center" style="margin-bottom:6px"><img src="${escapeHtml(opts.logoDataUrl)}" alt="" style="max-width:140px;max-height:90px;image-rendering:pixelated" /></div>`
    : ""

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Ticket Venta #${numero}</title>
<style>
  @page { size: ${Number(printerWidth)}mm auto; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Courier New', Courier, monospace; font-size: ${printerWidth === 80 ? 13 : 12}px; width: ${Number(printerWidth)}mm; padding: ${printerWidth === 80 ? 10 : 8}px; color: #000; }
  .center { text-align: center; }
  .bold { font-weight: bold; }
  .sep { border-top: 1px dashed #999; margin: 6px 0; }
  .sep-bold { border-top: 2px solid #000; margin: 6px 0; }
  .row { display: flex; justify-content: space-between; }
  .total-box { background: #f5f5f5; padding: 6px; margin: 4px 0; }
  .big { font-size: 16px; }
  .small { font-size: 10px; color: #888; }
</style></head><body>
  ${logoHTML}
  <div class="center bold big">${empresa}</div>
  <div class="sep-bold"></div>
  <div class="center bold big">VENTA #${numero}</div>
  <div class="center small">${fecha}</div>
  <div class="sep"></div>
  <div class="row"><span style="color:#666">Cliente:</span><span class="bold">${cliente}</span></div>
  ${telefono ? `<div class="row"><span style="color:#666">Tel:</span><span>${telefono}</span></div>` : ""}
  <div class="sep"></div>
  ${itemsHTML}
  <div class="sep-bold"></div>
  <div class="row"><span>Subtotal:</span><span>${escapeHtml(fmt(subtotal))}</span></div>
  ${descuento > 0 ? `<div class="row" style="color:#c00"><span>Descuento:</span><span>-${escapeHtml(fmt(descuento))}</span></div>` : ""}
  ${fiscalHTML}
  <div class="total-box row bold big"><span>TOTAL:</span><span>${escapeHtml(fmt(venta.total))}</span></div>
  ${ivaIncluidoHTML}
  ${Number(venta.saldoPendiente || 0) > 0 ? `<div class="row bold"><span>Saldo pendiente:</span><span>${escapeHtml(fmt(Number(venta.saldoPendiente)))}</span></div>` : ""}
  <div class="sep-bold"></div>
  <div class="center bold">¡Gracias por su compra!</div>
  <div class="center small">Conserve este ticket como comprobante</div>
  <br><br>
</body></html>`
}
