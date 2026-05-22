/**
 * Renderizador de plantillas WhatsApp para comprobantes de venta.
 * Usa el catálogo central de plantillas (lib/whatsapp/plantillas-catalog.ts).
 *
 * Keys del catálogo:
 *  - venta_comprobante: texto completo (modal venta creada)
 *  - venta_comprobante_corto: texto corto que acompaña la imagen
 */

import { resolvePlantilla, getPlantilla } from "./plantillas-catalog"

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

export interface VentaTemplateContext {
  cliente: string
  numero_venta: string
  total: string
  items: string
  metodo_pago: string
  garantias: string
  empresa: string
  fecha: string
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

  const garantiasTxt = venta.garantias && venta.garantias.length > 0
    ? venta.garantias.map((g) => `- Garantía #${g.numeroGarantia} (${g.diasValidez} días)`).join("\n")
    : ""

  return {
    cliente: venta.clienteNombre || "",
    numero_venta: String(venta.numeroVenta),
    total: totalTxt,
    items: itemsTxt,
    metodo_pago: METODO_LABELS[venta.metodoPago] || venta.metodoPago,
    garantias: garantiasTxt,
    empresa: venta.organizationName || "Servicio Técnico",
    fecha: new Date().toLocaleDateString("es-AR"),
  }
}

export function renderVentaMessage(
  plantillaOverride: string | undefined | null,
  ctx: VentaTemplateContext,
): string {
  return resolvePlantilla(
    "venta_comprobante",
    ctx as unknown as Record<string, string>,
    plantillaOverride && plantillaOverride.trim()
      ? { venta_comprobante: plantillaOverride }
      : null,
  )
}

export function renderVentaMessageCorto(
  plantillaOverride: string | undefined | null,
  ctx: VentaTemplateContext,
): string {
  return resolvePlantilla(
    "venta_comprobante_corto",
    ctx as unknown as Record<string, string>,
    plantillaOverride && plantillaOverride.trim()
      ? { venta_comprobante_corto: plantillaOverride }
      : null,
  )
}

// Exports legacy para placeholder UI (deprecados, ahora se obtienen del catálogo).
export const DEFAULT_PLANTILLA_VENTA = getPlantilla("venta_comprobante")?.defaultText ?? ""
export const DEFAULT_PLANTILLA_VENTA_CORTO = getPlantilla("venta_comprobante_corto")?.defaultText ?? ""
