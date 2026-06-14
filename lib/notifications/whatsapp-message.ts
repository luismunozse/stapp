/**
 * Generación del TEXTO de los WhatsApp automáticos (path de envío real).
 * Copy específico y accionable por estado, con link de seguimiento (que ya
 * permite aprobar/rechazar el presupuesto y ver el comprobante).
 *
 * Aislado de send-direct.ts (que arrastra imports server-only como push/email)
 * para que sea testeable como unidad pura.
 */

import { formatCurrencyValue, type CurrencyCode, DEFAULT_CURRENCY } from "@/lib/currency"
import { formatDateValue } from "@/lib/timezone"
import { renderTemplate, getPlantilla } from "@/lib/whatsapp/plantillas-catalog"

export interface WaMessageContext {
  cliente: { nombre: string }
  organizationName: string
  organizationSlug?: string | null
  moneda?: string
  orden?: {
    numeroOrden?: number | string
    dispositivo?: string | null
    estado?: string | null
    presupuesto?: number | null
    publicToken?: string | null
  }
  garantia?: { diasValidez?: number | string | null }
}

export function getBaseUrl(organizationSlug?: string | null): string {
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "stapp.com.ar"
  if (organizationSlug) {
    return `https://${organizationSlug}.${rootDomain}`
  }
  return `https://${rootDomain}`
}

const estadoLabels: Record<string, string> = {
  RECIBIDO: "Recibido",
  EN_DIAGNOSTICO: "En Diagnóstico",
  PRESUPUESTADO: "Presupuestado",
  APROBADO: "Aprobado",
  EN_REPARACION: "En Reparación",
  ESPERANDO_REPUESTO: "Esperando Repuesto",
  REPARADO: "Reparado",
  ENTREGADO: "Entregado",
  CANCELADO: "Cancelado",
  SIN_REPARACION: "Sin Reparación",
}

export function formatEstado(estado: string): string {
  return estadoLabels[estado] || estado
}

/**
 * Mapeo de NotificationType (legacy) a la key del catálogo de plantillas.
 * Si el override existe se renderiza con las variables del context.
 */
const TIPO_TO_CATALOG_KEY: Record<string, string> = {
  CAMBIO_ESTADO: "orden_estado_actual",
  PRESUPUESTO_DEFINIDO: "orden_presupuesto",
  GARANTIA_CREADA: "garantia_creada",
  RECORDATORIO_RETIRO: "orden_listo_retirar",
  BIENVENIDA_CLIENTE: "bienvenida_cliente",
  RESPUESTA_CONSULTA: "respuesta_consulta",
  RECORDATORIO_PAGO: "cobranza_recordatorio_pago",
  CONFIRMACION_PAGO: "cobranza_confirmacion_pago",
  LINK_PAGO: "cobranza_link_pago",
  MANTENIMIENTO_PREVENTIVO: "mantenimiento_preventivo",
  PROMOCION: "promocion",
  ENCUESTA_SATISFACCION: "encuesta_satisfaccion",
  FELICITACION: "felicitacion",
  SOLICITUD_INFO: "orden_solicitud_info",
  REPUESTO_DISPONIBLE: "orden_repuesto_disponible",
  REPUESTO_NO_DISPONIBLE: "orden_repuesto_no_disponible",
  AVISO_DEMORA: "orden_aviso_demora",
  REINGRESO_GARANTIA: "garantia_reingreso",
  CLIENTE_INACTIVO: "cliente_inactivo",
  SEGUIMIENTO_PRESUPUESTO_RECHAZADO: "orden_seguimiento_rechazado",
}

function buildVarsForContext(context: any): Record<string, string | number> {
  const currency: CurrencyCode = (context.moneda as CurrencyCode) || DEFAULT_CURRENCY
  const formatCurrency = (amount: number | null | undefined) =>
    formatCurrencyValue(amount ?? 0, currency)

  const baseUrl = getBaseUrl(context.organizationSlug)
  const publicToken: string | null | undefined = context.orden?.publicToken

  const vars: Record<string, string | number> = {
    cliente: context.cliente?.nombre || "",
    empresa: context.organizationName || "",
    fecha: new Date().toLocaleDateString("es-AR"),
  }

  if (context.orden) {
    vars.numero_orden = context.orden.numeroOrden ?? ""
    vars.dispositivo = context.orden.dispositivo || ""
    vars.estado = formatEstado(context.orden.estado || "")
    vars.presupuesto = context.orden.presupuesto != null
      ? formatCurrency(context.orden.presupuesto)
      : ""
    vars.link_seguimiento = publicToken ? `${baseUrl}/seguimiento/${publicToken}` : ""
    vars.link_pdf = publicToken ? `${baseUrl}/api/public/ordenes/${publicToken}/pdf` : ""
  }

  if (context.garantia) {
    vars.garantia_dias = context.garantia.diasValidez ?? ""
    vars.garantia_fecha = context.garantia.fechaVencimiento
      ? formatDateValue(context.garantia.fechaVencimiento, context.zonaHoraria)
      : ""
  }

  if (context.pago) {
    vars.monto_pago = context.pago.monto ? formatCurrency(context.pago.monto) : ""
    vars.saldo = context.pago.saldoPendiente
      ? formatCurrency(context.pago.saldoPendiente)
      : "Al día"
    vars.link_pago = context.pago.linkPago || ""
  }

  if (context.repuesto) {
    vars.repuesto = context.repuesto.nombre || "necesario"
  }

  if (context.demora) {
    vars.motivo_demora = context.demora.motivo || ""
  }

  if (context.promocion) {
    vars.promo_titulo = context.promocion.titulo || ""
    vars.promo_descripcion = context.promocion.descripcion || ""
  }

  return vars
}

/**
 * Resuelve el texto de una plantilla para un tipo de notificación.
 * Orden de prioridad: override per-estado → override genérico → default catálogo per-estado → default catálogo genérico → null.
 * El catálogo es la única fuente de verdad cuando no hay override de la org.
 */
export function resolvePlantillaForTipo(
  tipo: string,
  context: any,
  plantillasOverride: Record<string, string> | null | undefined,
): string | null {
  const keys: string[] =
    tipo === "CAMBIO_ESTADO" && context.orden?.estado
      ? [`orden_estado_${String(context.orden.estado).toLowerCase()}`, "orden_estado_actual"]
      : [TIPO_TO_CATALOG_KEY[tipo]].filter(Boolean) as string[]

  if (keys.length === 0) return null
  const vars = buildVarsForContext(context)

  // 1) Override de la org (en orden de prioridad de keys)
  if (plantillasOverride) {
    for (const key of keys) {
      const tpl = plantillasOverride[key]
      if (tpl && tpl.trim()) return renderTemplate(tpl, vars)
    }
  }
  // 2) Default del catálogo (única fuente de verdad)
  for (const key of keys) {
    const def = getPlantilla(key)?.defaultText
    if (def && def.trim()) return renderTemplate(def, vars)
  }
  return null
}

/**
 * Fallback genérico de WhatsApp. Se usa solo cuando `resolvePlantillaForTipo`
 * devuelve null (tipo sin entrada en el catálogo). El copy por estado vive en
 * el catálogo. Exportado para test.
 */
export function generateWhatsAppMessage(tipo: string, context: WaMessageContext): string {
  const nombre = context.cliente.nombre
  const empresa = context.organizationName
  const o = context.orden
  const baseUrl = getBaseUrl(context.organizationSlug)
  const link = o?.publicToken ? `\n\nSeguimiento: ${baseUrl}/seguimiento/${o.publicToken}` : ""
  const ref = o?.numeroOrden ? ` (Orden #${o.numeroOrden})` : ""
  return `Hola ${nombre}, tiene una actualización${ref} de ${empresa}.${link}\n\n${empresa}`
}
