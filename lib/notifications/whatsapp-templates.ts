import { formatCurrencyValue, type CurrencyCode, DEFAULT_CURRENCY } from "@/lib/currency"
import { formatDateValue } from "@/lib/timezone"
import { EstadoOrden, NotificationContext, MetodoPagoVenta } from "./types"

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

    // Plantilla de entrega completada con comprobante
    if (ctx.orden.estado === "ENTREGADO") {
      templates.push({
        id: "entrega_completada",
        nombre: "Comprobante de entrega",
        mensaje: generateEntregaCompletadaMessage(ctx),
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

  // Plantillas para ventas
  if (ctx.venta) {
    templates.push({
      id: "venta_confirmacion",
      nombre: "Confirmacion de compra",
      mensaje: generateVentaConfirmacionMessage(ctx),
    })

    // Si tiene garantías
    if (ctx.venta.garantias.length > 0) {
      templates.push({
        id: "venta_garantia",
        nombre: "Informar garantias",
        mensaje: generateVentaGarantiaMessage(ctx),
      })
    }

    templates.push({
      id: "venta_agradecimiento",
      nombre: "Agradecimiento",
      mensaje: generateVentaAgradecimientoMessage(ctx),
    })
  }

  return templates
}

function generateEstadoMessage(ctx: NotificationContext): string {
  const estado = ctx.orden!.estado
  const label = estadoLabels[estado]

  let mensaje = `Hola ${ctx.cliente.nombre}, le informamos que su ${ctx.orden!.dispositivo} (Orden #${ctx.orden!.numeroOrden}) se encuentra ${label}.`

  switch (estado) {
    case "RECIBIDO":
      mensaje +=
        "\n\nHemos recibido su equipo correctamente. Pronto comenzaremos con el diagnostico y le informaremos novedades."
      break
    case "EN_DIAGNOSTICO":
      mensaje +=
        "\n\nNuestro tecnico esta evaluando el equipo. Le enviaremos el presupuesto a la brevedad."
      break
    case "PRESUPUESTADO":
      mensaje +=
        "\n\nPor favor confirme si desea continuar con la reparacion."
      break
    case "APROBADO":
      mensaje +=
        "\n\nGracias por aprobar el presupuesto. Su equipo entrara en cola de reparacion y le avisaremos cuando este listo."
      break
    case "EN_REPARACION":
      mensaje +=
        "\n\nNuestro tecnico esta trabajando en su equipo. Le avisaremos cuando la reparacion este completa."
      break
    case "ESPERANDO_REPUESTO":
      mensaje +=
        "\n\nLe avisaremos cuando llegue el repuesto para continuar con la reparacion."
      break
    case "REPARADO":
      mensaje +=
        "\n\nPuede pasar a retirarlo en nuestro local en horario de atencion. Lo esperamos!"
      break
    case "ENTREGADO":
      mensaje +=
        "\n\nGracias por confiar en nosotros. Esperamos que su equipo funcione correctamente!"
      break
    case "CANCELADO":
      mensaje +=
        "\n\nSi tiene alguna consulta o desea ingresar un nuevo servicio, no dude en contactarnos."
      break
    case "SIN_REPARACION":
      mensaje +=
        "\n\nLamentablemente no fue posible realizar la reparacion. Puede pasar a retirar su equipo en horario de atencion."
      break
  }

  mensaje += `\n\n${ctx.organizationName}`

  return mensaje
}

function generatePresupuestoMessage(ctx: NotificationContext): string {
  const formatCurrency = (amount: number) =>
    formatCurrencyValue(amount, (ctx.moneda as CurrencyCode) || DEFAULT_CURRENCY)

  return `Hola ${ctx.cliente.nombre}, le informamos el presupuesto para la reparacion de su ${ctx.orden!.dispositivo}:

*Presupuesto: ${formatCurrency(ctx.orden!.presupuesto || 0)}*

Orden #${ctx.orden!.numeroOrden}

Por favor confirmenos si desea proceder con la reparacion.

${ctx.organizationName}`
}

function generateGarantiaMessage(ctx: NotificationContext): string {
  const formatDate = (date: Date) => formatDateValue(date, ctx.zonaHoraria)

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

function generateEntregaCompletadaMessage(ctx: NotificationContext): string {
  const baseUrl = getBaseUrl(ctx)
  const pdfUrl = `${baseUrl}/api/ordenes/${ctx.orden!.id}/comprobante-entrega`

  return `Hola ${ctx.cliente.nombre}, confirmamos la entrega de su ${ctx.orden!.dispositivo}.

*Orden #${ctx.orden!.numeroOrden} - ENTREGADO*

Puede descargar su comprobante de entrega aqui:
${pdfUrl}

Gracias por confiar en nosotros!

${ctx.organizationName}`
}

// Funciones para plantillas de ventas
const metodoPagoLabels: Record<MetodoPagoVenta, string> = {
  EFECTIVO: "efectivo",
  TRANSFERENCIA: "transferencia",
  TARJETA: "tarjeta",
}

function getBaseUrl(ctx: NotificationContext): string {
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "stapp.com.ar"
  if (ctx.organizationSlug) {
    return `https://${ctx.organizationSlug}.${rootDomain}`
  }
  return `https://${rootDomain}`
}

function generateVentaConfirmacionMessage(ctx: NotificationContext): string {
  const formatCurrency = (amount: number) =>
    formatCurrencyValue(amount, (ctx.moneda as CurrencyCode) || DEFAULT_CURRENCY)

  const venta = ctx.venta!
  const numeroVenta = `V${String(venta.numeroVenta).padStart(4, "0")}`
  const baseUrl = getBaseUrl(ctx)

  let productosTexto = venta.items
    .map((item) => `- ${item.descripcion} x${item.cantidad}`)
    .join("\n")

  const pdfUrl = `${baseUrl}/api/ventas/${venta.id}/pdf`

  return `Hola ${ctx.cliente.nombre}, gracias por su compra!

*Comprobante de Venta ${numeroVenta}*

Productos:
${productosTexto}

*Total: ${formatCurrency(venta.total)}*
Pago: ${metodoPagoLabels[venta.metodoPago]}

Descargar comprobante:
${pdfUrl}

${ctx.organizationName}`
}

function generateVentaGarantiaMessage(ctx: NotificationContext): string {
  const formatDate = (date: Date) => formatDateValue(date, ctx.zonaHoraria)
  const venta = ctx.venta!
  const numeroVenta = `V${String(venta.numeroVenta).padStart(4, "0")}`
  const baseUrl = getBaseUrl(ctx)

  let garantiasTexto = venta.garantias
    .map((g) => {
      const pdfUrl = `${baseUrl}/api/ventas/${venta.id}/garantia/${g.id}/pdf`
      return `*${g.numeroGarantia}*
${g.diasValidez} dias (hasta ${formatDate(g.fechaVencimiento)})
Descargar: ${pdfUrl}`
    })
    .join("\n\n")

  return `Hola ${ctx.cliente.nombre}, su compra (${numeroVenta}) incluye garantia:

${garantiasTexto}

Conserve estos certificados como comprobante.

${ctx.organizationName}`
}

function generateVentaAgradecimientoMessage(ctx: NotificationContext): string {
  return `Hola ${ctx.cliente.nombre}, gracias por elegirnos!

Esperamos que disfrute su compra. Si tiene alguna consulta, no dude en contactarnos.

Lo esperamos pronto!

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
