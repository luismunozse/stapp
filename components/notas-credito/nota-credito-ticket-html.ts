import { escapeHtml } from "@/lib/escape-html"
import { formatMontoTicket, type NotaCreditoTicketData } from "@/lib/escpos"

/**
 * HTML del ticket de una NC para imprimir con el diálogo del navegador cuando
 * no hay impresora USB. Mismo contenido que generateNotaCreditoTicketCommands.
 * Se escribe con document.write en una ventana del mismo origen que la app:
 * Todo dato que venga de un usuario va escapado (ver components/pos/ticket-html.ts).
 */
export function buildNotaCreditoTicketHTML(data: NotaCreditoTicketData, opts: { ancho: 58 | 80 }): string {
  const ancho = opts.ancho === 80 ? 80 : 58
  const e = (s: string | null | undefined) => escapeHtml(s ?? "")
  const plata = (n: number) => e(formatMontoTicket(n, data.moneda))
  const operacion = data.origen === "VENTA" ? "venta" : "orden"

  const items = data.items
    .map(
      (i) => `
    <div style="margin-bottom:4px">
      <div class="bold">${e(i.descripcion)}</div>
      <div class="row"><span>&nbsp;${Number(i.cantidad)} u.</span><span>${plata(i.subtotal)}</span></div>
    </div>`
    )
    .join("")

  const pendiente =
    data.pendienteActual === null
      ? ""
      : `<div class="small">${
          data.pendienteActual > 0
            ? `Saldo pendiente de la ${operacion} al ${e(data.hoy)}: ${plata(data.pendienteActual)}`
            : `Al ${e(data.hoy)} la ${operacion} no tiene saldo pendiente.`
        }</div>`

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Nota de crédito ${e(data.numero)}</title>
<style>
  @page { size: ${ancho}mm auto; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Courier New', Courier, monospace; font-size: ${ancho === 80 ? 13 : 12}px; width: ${ancho}mm; padding: ${ancho === 80 ? 10 : 8}px; color: #000; }
  .center { text-align: center; }
  .bold { font-weight: bold; }
  .big { font-size: 16px; }
  .small { font-size: 10px; }
  .sep { border-top: 1px dashed #999; margin: 6px 0; }
  .sep-bold { border-top: 2px solid #000; margin: 6px 0; }
  .row { display: flex; justify-content: space-between; gap: 4px; }
  .sello { border: 2px solid #000; text-align: center; font-weight: bold; font-size: 16px; margin: 6px 0; padding: 2px; }
</style></head><body>
  <div class="center bold big">${e(data.nombreEmpresa || "Servicio Técnico")}</div>
  ${data.telefonoEmpresa ? `<div class="center small">Tel: ${e(data.telefonoEmpresa)}</div>` : ""}
  ${data.direccionEmpresa ? `<div class="center small">${e(data.direccionEmpresa)}</div>` : ""}
  <div class="sep-bold"></div>
  <div class="center bold big">NOTA DE CRÉDITO</div>
  <div class="center bold">${e(data.numero)}</div>
  <div class="center small">${e(data.fecha)}</div>
  ${data.anulada ? `<div class="sello">ANULADA</div>` : ""}
  <div class="sep"></div>
  <div>${e(data.operacion)}</div>
  <div>Cliente: <span class="bold">${e(data.cliente)}</span></div>
  <div>Motivo: ${e(data.motivo)}</div>
  <div class="sep"></div>
  ${items ? `${items}<div class="sep"></div>` : ""}
  ${data.montoAplicadoDeuda > 0 ? `<div class="row"><span>Descontado de tu saldo:</span><span>${plata(data.montoAplicadoDeuda)}</span></div>` : ""}
  ${data.montoReembolso > 0 ? `<div class="row"><span>${e(data.etiquetaReintegro)}</span><span>${plata(data.montoReembolso)}</span></div>` : ""}
  <div class="row bold big"><span>TOTAL:</span><span>${plata(data.monto)}</span></div>
  ${pendiente}
  <div class="sep-bold"></div>
  <div class="center small">Nota de crédito interna</div>
  <div class="center small">No válido como comprobante fiscal</div>
  ${data.telefonoEmpresa ? `<div class="center small">Consultas: ${e(data.telefonoEmpresa)}</div>` : ""}
  <br><br>
</body></html>`
}
