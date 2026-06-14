/**
 * Generación del TEXTO de los WhatsApp automáticos (path de envío real).
 * Copy específico y accionable por estado, con link de seguimiento (que ya
 * permite aprobar/rechazar el presupuesto y ver el comprobante).
 *
 * Aislado de send-direct.ts (que arrastra imports server-only como push/email)
 * para que sea testeable como unidad pura.
 */

import { formatCurrencyValue, type CurrencyCode, DEFAULT_CURRENCY } from "@/lib/currency"

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
 * Texto del WhatsApp automático por tipo de notificación. Copy por estado +
 * link de seguimiento. Exportado para test.
 */
export function generateWhatsAppMessage(tipo: string, context: WaMessageContext): string {
  const nombre = context.cliente.nombre
  const empresa = context.organizationName
  const o = context.orden
  const moneda = (context.moneda as CurrencyCode) || DEFAULT_CURRENCY
  const baseUrl = getBaseUrl(context.organizationSlug)
  const link = o?.publicToken ? `${baseUrl}/seguimiento/${o.publicToken}` : ""
  const linkLine = link ? `\n\nSeguimiento: ${link}` : ""
  const footer = `${linkLine}\n\n${empresa}`

  switch (tipo) {
    case "CAMBIO_ESTADO": {
      const base = `Hola ${nombre}, su ${o?.dispositivo} (Orden #${o?.numeroOrden})`
      let cuerpo: string
      switch (o?.estado || "") {
        case "RECIBIDO":
          cuerpo = "lo recibimos y ya está en cola de diagnóstico. Le avisaremos apenas tengamos novedades."
          break
        case "EN_DIAGNOSTICO":
          cuerpo = "está en revisión para detectar la falla. En breve le enviamos el presupuesto."
          break
        case "PRESUPUESTADO":
          cuerpo = `${
            o?.presupuesto != null
              ? `ya tiene presupuesto: *${formatCurrencyValue(o.presupuesto, moneda)}*. `
              : "ya tiene presupuesto. "
          }Para avanzar, *apruebe o rechace el presupuesto* desde el link de abajo.`
          break
        case "APROBADO":
          cuerpo = "fue aprobado. Entra en cola de reparación y le avisamos cuando esté listo. ¡Gracias!"
          break
        case "EN_REPARACION":
          cuerpo = "ya está en reparación. Le avisamos en cuanto esté terminado."
          break
        case "ESPERANDO_REPUESTO":
          cuerpo = "está en pausa esperando un repuesto. Apenas llegue, retomamos la reparación."
          break
        case "REPARADO":
          cuerpo = "está reparado y *listo para retirar*. Lo esperamos en horario de atención."
          break
        case "ENTREGADO":
          cuerpo = "fue entregado. ¡Gracias por confiar en nosotros! Si necesita algo más, escríbanos."
          break
        case "ENTREGADO_SIN_REPARACION":
          cuerpo = "fue retirado sin reparación. Gracias por consultarnos; quedamos a disposición."
          break
        case "CANCELADO":
          cuerpo = "fue cancelada. Si desea retomar o ingresar un nuevo servicio, escríbanos."
          break
        case "SIN_REPARACION":
          cuerpo = "no pudo repararse. Puede pasar a retirarlo en horario de atención. Quedamos a disposición."
          break
        default:
          cuerpo = `cambió a *${formatEstado(o?.estado || "")}*.`
      }
      return `${base} ${cuerpo}${footer}`
    }
    case "PRESUPUESTO_DEFINIDO":
      return `Hola ${nombre}, ya tenemos el presupuesto para su ${o?.dispositivo} (Orden #${o?.numeroOrden}):\n\n*${
        o?.presupuesto != null ? formatCurrencyValue(o.presupuesto, moneda) : "Sin definir"
      }*\n\nPara avanzar, *apruebe o rechace el presupuesto* desde el link de abajo.${footer}`
    case "GARANTIA_CREADA":
      return `Hola ${nombre}, su reparación cuenta con *${context.garantia?.diasValidez} días de garantía*.\n\nOrden #${o?.numeroOrden} — ${o?.dispositivo}\n\nGuarde este mensaje como comprobante.${footer}`
    case "RECORDATORIO_RETIRO":
      return `Hola ${nombre}, le recordamos que su ${o?.dispositivo} (Orden #${o?.numeroOrden}) está *listo para retirar*. Lo esperamos en horario de atención.${footer}`
    default:
      return `Hola ${nombre}, tiene una nueva notificación de ${empresa}.${footer}`
  }
}
