import { EstadoOrden, NotificationContext } from "./types"

export interface WhatsAppTemplate {
  id: string
  nombre: string
  mensaje: string
}

const estadoLabels: Record<EstadoOrden, string> = {
  RECIBIDO: "recibido",
  EN_DIAGNOSTICO: "en diagnostico",
  PRESUPUESTADO: "presupuestado - esperando su respuesta",
  APROBADO: "aprobado - en cola de reparacion",
  EN_REPARACION: "en reparacion",
  ESPERANDO_REPUESTO: "esperando repuesto",
  REPARADO: "listo para retirar",
  ENTREGADO: "entregado",
  CANCELADO: "cancelado",
  SIN_REPARACION: "sin posibilidad de reparacion",
}

export function getWhatsAppTemplates(ctx: NotificationContext): WhatsAppTemplate[] {
  const templates: WhatsAppTemplate[] = []

  if (ctx.orden) {
    // Plantilla de estado actual
    templates.push({
      id: "estado_actual",
      nombre: `Estado: ${estadoLabels[ctx.orden.estado]}`,
      mensaje: generateEstadoMessage(ctx),
    })

    // Plantilla de presupuesto (si existe)
    if (ctx.orden.presupuesto) {
      templates.push({
        id: "presupuesto",
        nombre: "Informar presupuesto",
        mensaje: generatePresupuestoMessage(ctx),
      })
    }

    // Plantilla de listo para retirar
    if (ctx.orden.estado === "REPARADO") {
      templates.push({
        id: "listo_retirar",
        nombre: "Recordatorio de retiro",
        mensaje: generateRecordatorioMessage(ctx),
      })
    }

    // Plantilla generica de seguimiento
    templates.push({
      id: "seguimiento",
      nombre: "Mensaje de seguimiento",
      mensaje: generateSeguimientoMessage(ctx),
    })
  }

  if (ctx.garantia) {
    templates.push({
      id: "garantia",
      nombre: "Informar garantia",
      mensaje: generateGarantiaMessage(ctx),
    })
  }

  return templates
}

function generateEstadoMessage(ctx: NotificationContext): string {
  const estado = ctx.orden!.estado
  const label = estadoLabels[estado]

  let mensaje = `Hola ${ctx.cliente.nombre}, le informamos que su ${ctx.orden!.dispositivo} (Orden #${ctx.orden!.numeroOrden}) se encuentra ${label}.`

  if (estado === "REPARADO") {
    mensaje +=
      "\n\nPuede pasar a retirarlo en nuestro local en horario de atencion. Lo esperamos!"
  } else if (estado === "PRESUPUESTADO") {
    mensaje +=
      "\n\nPor favor confirme si desea continuar con la reparacion."
  } else if (estado === "ESPERANDO_REPUESTO") {
    mensaje +=
      "\n\nLe avisaremos cuando llegue el repuesto para continuar con la reparacion."
  }

  mensaje += `\n\n${ctx.organizationName}`

  return mensaje
}

function generatePresupuestoMessage(ctx: NotificationContext): string {
  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: "ARS",
    }).format(amount)

  return `Hola ${ctx.cliente.nombre}, le informamos el presupuesto para la reparacion de su ${ctx.orden!.dispositivo}:

*Presupuesto: ${formatCurrency(ctx.orden!.presupuesto || 0)}*

Orden #${ctx.orden!.numeroOrden}

Por favor confirmenos si desea proceder con la reparacion.

${ctx.organizationName}`
}

function generateGarantiaMessage(ctx: NotificationContext): string {
  const formatDate = (date: Date) => new Date(date).toLocaleDateString("es-AR")

  return `Hola ${ctx.cliente.nombre}, su reparacion ahora cuenta con garantia:

*${ctx.garantia!.diasValidez} dias de garantia*
Valida hasta: ${formatDate(ctx.garantia!.fechaVencimiento)}

Orden #${ctx.orden!.numeroOrden}
Dispositivo: ${ctx.orden!.dispositivo}

Conserve este mensaje como comprobante.

${ctx.organizationName}`
}

function generateRecordatorioMessage(ctx: NotificationContext): string {
  return `Hola ${ctx.cliente.nombre}, le recordamos que su ${ctx.orden!.dispositivo} esta listo para retirar.

Orden #${ctx.orden!.numeroOrden}

Puede pasar por nuestro local en horario de atencion. Lo esperamos!

${ctx.organizationName}`
}

function generateSeguimientoMessage(ctx: NotificationContext): string {
  return `Hola ${ctx.cliente.nombre}, nos comunicamos por su ${ctx.orden!.dispositivo} (Orden #${ctx.orden!.numeroOrden}).

[Escriba su mensaje aqui]

${ctx.organizationName}`
}

export function formatPhoneForWhatsApp(phone: string): string {
  // Remover todo excepto numeros
  let cleaned = phone.replace(/\D/g, "")

  // Si empieza con 0, removemos y agregamos 54 (Argentina)
  if (cleaned.startsWith("0")) {
    cleaned = "54" + cleaned.substring(1)
  }

  // Si no tiene codigo de pais, agregar 54
  if (!cleaned.startsWith("54") && cleaned.length <= 10) {
    cleaned = "54" + cleaned
  }

  return cleaned
}

export function generateWhatsAppUrl(phone: string, message: string): string {
  const formattedPhone = formatPhoneForWhatsApp(phone)
  const encodedMessage = encodeURIComponent(message)
  return `https://wa.me/${formattedPhone}?text=${encodedMessage}`
}
