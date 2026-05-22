/**
 * Renderizador de plantillas WhatsApp para comprobantes de venta.
 * Reemplaza variables {nombre} en plantilla custom de la organizacion.
 * Fallback a texto por defecto si no hay plantilla configurada.
 */

export interface VentaTemplateContext {
  cliente: string
  numero: string | number
  total: string
  items: string
  metodoPago: string
  garantias: string
  empresa: string
  fecha: string
}

const METODO_LABELS: Record<string, string> = {
  EFECTIVO: "Efectivo",
  TRANSFERENCIA: "Transferencia",
  TARJETA: "Tarjeta",
  TARJETA_DEBITO: "T. Débito",
  TARJETA_CREDITO: "T. Crédito",
  MERCADOPAGO: "MercadoPago",
  CUENTA_CORRIENTE: "Cta. Cte.",
  OTRO: "Otro",
}

export interface VentaForTemplate {
  numeroVenta: number | string
  clienteNombre: string
  items: Array<{ descripcion: string; cantidad: number; precioUnitario: number }>
  descuento?: number
  total: number
  metodoPago: string
  garantias?: Array<{ numeroGarantia: string | number; diasValidez: number }>
  organizationName?: string
}

export function buildVentaContext(
  venta: VentaForTemplate,
  formatPrice: (amount: number) => string,
): VentaTemplateContext {
  const itemsTxt = venta.items
    .map((i) => `- ${i.descripcion} x${i.cantidad}: ${formatPrice(i.cantidad * i.precioUnitario)}`)
    .join("\n")

  let totalTxt = formatPrice(venta.total)
  if (venta.descuento && venta.descuento > 0) {
    totalTxt = `${formatPrice(venta.total)} (Descuento: -${formatPrice(venta.descuento)})`
  }

  const garantiasTxt = (venta.garantias && venta.garantias.length > 0)
    ? venta.garantias.map((g) => `- Garantía #${g.numeroGarantia} (${g.diasValidez} días)`).join("\n")
    : ""

  return {
    cliente: venta.clienteNombre || "",
    numero: venta.numeroVenta,
    total: totalTxt,
    items: itemsTxt,
    metodoPago: METODO_LABELS[venta.metodoPago] || venta.metodoPago,
    garantias: garantiasTxt,
    empresa: venta.organizationName || "Servicio Técnico",
    fecha: new Date().toLocaleDateString("es-AR"),
  }
}

export function renderPlantilla(template: string, ctx: VentaTemplateContext): string {
  return template
    .replace(/\{cliente\}/g, ctx.cliente)
    .replace(/\{numero\}/g, String(ctx.numero))
    .replace(/\{total\}/g, ctx.total)
    .replace(/\{items\}/g, ctx.items)
    .replace(/\{metodo_pago\}/g, ctx.metodoPago)
    .replace(/\{garantias\}/g, ctx.garantias)
    .replace(/\{empresa\}/g, ctx.empresa)
    .replace(/\{fecha\}/g, ctx.fecha)
}

export const DEFAULT_PLANTILLA_VENTA = `Hola {cliente}, gracias por tu compra!

*COMPROBANTE DE VENTA #{numero}*

{items}

*Total: {total}*
Método de pago: {metodo_pago}

{garantias}

Gracias por tu preferencia!
{empresa}`

export const DEFAULT_PLANTILLA_VENTA_CORTO =
  `Hola {cliente}, gracias por tu compra!\nVenta #{numero} por {total}.\nTe enviamos el comprobante como imagen.`

export function renderVentaMessage(
  plantilla: string | undefined | null,
  ctx: VentaTemplateContext,
): string {
  const tpl = (plantilla && plantilla.trim()) ? plantilla : DEFAULT_PLANTILLA_VENTA
  return renderPlantilla(tpl, ctx)
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export function renderVentaMessageCorto(
  plantilla: string | undefined | null,
  ctx: VentaTemplateContext,
): string {
  const tpl = (plantilla && plantilla.trim()) ? plantilla : DEFAULT_PLANTILLA_VENTA_CORTO
  return renderPlantilla(tpl, ctx).trim()
}
