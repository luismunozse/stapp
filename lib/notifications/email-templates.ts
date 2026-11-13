import { formatCurrencyValue, type CurrencyCode, DEFAULT_CURRENCY } from "@/lib/currency"
import { formatDateValue } from "@/lib/timezone"
import { EstadoOrden, NotificationContext, NotificationType } from "./types"
import { resolveTerminologia, t } from "@/lib/terminologia"
import { escapeHtml } from "@/lib/escape-html"
import { getEstadoOrdenUi } from "@/lib/estado-orden-ui"
import { STATUS_TONE_HEX } from "@/lib/status-tone"
import { detalleGarantiaCliente, venceTextoCliente } from "@/lib/garantias/aviso-texto"

const baseStyles = `
  font-family: Arial, sans-serif;
  line-height: 1.6;
  color: #333;
  max-width: 600px;
  margin: 0 auto;
  padding: 20px;
`

const headerStyle = `
  background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
  padding: 30px;
  text-align: center;
  border-radius: 10px 10px 0 0;
`

const contentStyle = `
  background: #f9fafb;
  padding: 30px;
  border: 1px solid #e5e7eb;
  border-top: none;
  border-radius: 0 0 10px 10px;
`

const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "stapp.com.ar"

const getHeader = (orgName: string) => `
  <div style="${headerStyle}">
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 0 auto;">
      <tr>
        <td style="vertical-align: middle; padding-right: 10px;">
          <img src="https://${ROOT_DOMAIN}/icon-192.png" alt="" style="height: 36px; width: 36px; border-radius: 8px;" />
        </td>
        <td style="vertical-align: middle;">
          <h1 style="color: white; margin: 0; font-size: 22px; font-weight: 700;">${orgName}</h1>
        </td>
      </tr>
    </table>
  </div>
`

const estadoLabels: Record<EstadoOrden, string> = {
  RECIBIDO: "Recibido",
  EN_DIAGNOSTICO: "En diagnóstico",
  PRESUPUESTADO: "Presupuesto enviado",
  APROBADO: "Aprobado - en cola de reparación",
  EN_REPARACION: "En reparación",
  ESPERANDO_REPUESTO: "Esperando repuesto",
  REPARADO: "Reparado - listo para retirar",
  ENTREGADO: "Entregado",
  ENTREGADO_SIN_REPARACION: "Retirado sin reparación",
  ENTREGADO_SIN_COBRO: "Entregado sin cobro",
  CANCELADO: "Cancelado",
  SIN_REPARACION: "Sin reparación posible",
  SIN_FALLA_DETECTADA: "Sin falla detectada",
}

// Mismo tono que la píldora de la app (lib/estado-orden-ui.ts), en el par
// fondo 50 / texto 700 que da ≥4,5:1.
const estadoColors = (estado: EstadoOrden) => STATUS_TONE_HEX[getEstadoOrdenUi(estado).tone]

export function generateCambioEstadoEmail(ctx: NotificationContext): {
  subject: string
  html: string
} {
  const estado = ctx.orden!.estado
  const estadoLabel = estadoLabels[estado]
  const estadoColor = estadoColors(estado)
  const term = resolveTerminologia(ctx.terminologia ?? null)
  const tEquipo = t(term, "equipo")

  return {
    subject: `Orden #${ctx.orden!.numeroOrden} - ${estadoLabel}`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="${baseStyles}">
          ${getHeader(ctx.organizationName)}
          <div style="${contentStyle}">
            <h2 style="color: #1f2937; margin-top: 0;">
              Hola ${ctx.cliente.nombre},
            </h2>

            <p>Te informamos que tu orden de servicio fue actualizada:</p>

            <div style="background: white; padding: 20px; border-radius: 8px; border: 1px solid #e5e7eb; margin: 20px 0;">
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; color: #6b7280;">Orden:</td>
                  <td style="padding: 8px 0; font-weight: bold;">#${ctx.orden!.numeroOrden}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #6b7280;">Dispositivo:</td>
                  <td style="padding: 8px 0;">${ctx.orden!.dispositivo}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #6b7280;">Estado:</td>
                  <td style="padding: 8px 0;">
                    <span style="background: ${estadoColor.bg}; color: ${estadoColor.fg}; padding: 4px 12px; border-radius: 4px; font-weight: bold;">
                      ${estadoLabel}
                    </span>
                  </td>
                </tr>
              </table>
            </div>

            ${
              estado === "REPARADO"
                ? `
              <div style="background: #dbeafe; padding: 15px; border-radius: 8px; margin: 20px 0;">
                <p style="margin: 0; color: #1e40af;">
                  <strong>¡Tu ${tEquipo} está listo!</strong><br>
                  Podés pasar a retirarlo por nuestro local en horario de atención.
                </p>
              </div>
            `
                : ""
            }

            <p style="color: #6b7280; font-size: 14px;">
              Si tenés alguna consulta, no dudes en contactarnos.
            </p>

            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">

            <p style="color: #9ca3af; font-size: 12px; text-align: center;">
              Este correo fue enviado automáticamente desde ${ctx.organizationName}.
            </p>
          </div>
        </body>
      </html>
    `,
  }
}

export function generatePresupuestoEmail(ctx: NotificationContext): {
  subject: string
  html: string
} {
  const formatCurrency = (amount: number) =>
    formatCurrencyValue(amount, (ctx.moneda as CurrencyCode) || DEFAULT_CURRENCY)
  const term = resolveTerminologia(ctx.terminologia ?? null)
  const tReparacion = t(term, "reparacion")

  return {
    subject: `Presupuesto definido - Orden #${ctx.orden!.numeroOrden}`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="${baseStyles}">
          ${getHeader(ctx.organizationName)}
          <div style="${contentStyle}">
            <h2 style="color: #1f2937; margin-top: 0;">
              Hola ${ctx.cliente.nombre},
            </h2>

            <p>Definimos el presupuesto para la ${tReparacion.toLowerCase()} de tu ${t(term, "equipo")}:</p>

            <div style="background: white; padding: 20px; border-radius: 8px; border: 1px solid #e5e7eb; margin: 20px 0; text-align: center;">
              <p style="color: #6b7280; margin: 0 0 5px 0; font-size: 14px;">Presupuesto estimado</p>
              <p style="color: #1f2937; margin: 0; font-size: 32px; font-weight: bold;">
                ${formatCurrency(ctx.orden!.presupuesto || 0)}
              </p>
            </div>

            <div style="background: white; padding: 15px; border-radius: 8px; border: 1px solid #e5e7eb;">
              <p style="margin: 0;"><strong>Orden:</strong> #${ctx.orden!.numeroOrden}</p>
              <p style="margin: 8px 0 0 0;"><strong>Dispositivo:</strong> ${ctx.orden!.dispositivo}</p>
            </div>

            <p style="margin-top: 20px;">
              Por favor, contactanos para confirmar si querés seguir con la reparación.
            </p>

            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">

            <p style="color: #9ca3af; font-size: 12px; text-align: center;">
              Este correo fue enviado automáticamente desde ${ctx.organizationName}.
            </p>
          </div>
        </body>
      </html>
    `,
  }
}

export function generateGarantiaEmail(ctx: NotificationContext): {
  subject: string
  html: string
} {
  const formatDate = (date: Date) => formatDateValue(date, ctx.zonaHoraria)
  const term = resolveTerminologia(ctx.terminologia ?? null)
  const tReparacion = t(term, "reparacion")

  return {
    subject: `Garantía activada - Orden #${ctx.orden!.numeroOrden}`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="${baseStyles}">
          ${getHeader(ctx.organizationName)}
          <div style="${contentStyle}">
            <h2 style="color: #1f2937; margin-top: 0;">
              Hola ${ctx.cliente.nombre},
            </h2>

            <p>Tu ${tReparacion.toLowerCase()} ahora cuenta con garantía:</p>

            <div style="background: #dcfce7; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <div style="text-align: center;">
                <p style="color: #166534; margin: 0; font-size: 24px; font-weight: bold;">
                  ${ctx.garantia!.diasValidez} días de garantía
                </p>
                <p style="color: #166534; margin: 8px 0 0 0;">
                  Válida hasta: ${formatDate(ctx.garantia!.fechaVencimiento)}
                </p>
              </div>
            </div>

            <div style="background: white; padding: 15px; border-radius: 8px; border: 1px solid #e5e7eb;">
              <p style="margin: 0;"><strong>Orden:</strong> #${ctx.orden!.numeroOrden}</p>
              <p style="margin: 8px 0 0 0;"><strong>Dispositivo:</strong> ${ctx.orden!.dispositivo}</p>
            </div>

            <p style="margin-top: 20px; color: #6b7280; font-size: 14px;">
              Conservá este correo como comprobante de garantía. Ante cualquier inconveniente
              dentro del período de garantía, contactanos.
            </p>

            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">

            <p style="color: #9ca3af; font-size: 12px; text-align: center;">
              Este correo fue enviado automáticamente desde ${ctx.organizationName}.
            </p>
          </div>
        </body>
      </html>
    `,
  }
}

export function generateRecordatorioEmail(
  ctx: NotificationContext,
  diasCompletado: number
): {
  subject: string
  html: string
} {
  const term = resolveTerminologia(ctx.terminologia ?? null)
  const tEquipo = t(term, "equipo")

  return {
    subject: `Recordatorio: tu ${tEquipo.toLowerCase()} está listo para retirar - Orden #${ctx.orden!.numeroOrden}`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="${baseStyles}">
          ${getHeader(ctx.organizationName)}
          <div style="${contentStyle}">
            <h2 style="color: #1f2937; margin-top: 0;">
              Hola ${ctx.cliente.nombre},
            </h2>

            <div style="background: #fef3c7; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <p style="color: #92400e; margin: 0; font-weight: bold;">
                Te recordamos que tu ${tEquipo.toLowerCase()} está listo para retirar
              </p>
              <p style="color: #92400e; margin: 8px 0 0 0;">
                Pasaron ${diasCompletado} ${diasCompletado > 1 ? "días" : "día"} desde que se completó la ${t(term, "reparacion").toLowerCase()}.
              </p>
            </div>

            <div style="background: white; padding: 15px; border-radius: 8px; border: 1px solid #e5e7eb;">
              <p style="margin: 0;"><strong>Orden:</strong> #${ctx.orden!.numeroOrden}</p>
              <p style="margin: 8px 0 0 0;"><strong>Dispositivo:</strong> ${ctx.orden!.dispositivo}</p>
            </div>

            <p style="margin-top: 20px;">
              Podés pasar a retirarlo por nuestro local en horario de atención.
            </p>

            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">

            <p style="color: #9ca3af; font-size: 12px; text-align: center;">
              Este correo fue enviado automáticamente desde ${ctx.organizationName}.
            </p>
          </div>
        </body>
      </html>
    `,
  }
}

// === Plantilla genérica reutilizable para los nuevos tipos ===

function generateGenericEmail(
  ctx: NotificationContext,
  subject: string,
  title: string,
  body: string,
  highlight?: { text: string; color: string; bgColor: string }
): { subject: string; html: string } {
  return {
    subject,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="${baseStyles}">
          ${getHeader(ctx.organizationName)}
          <div style="${contentStyle}">
            <h2 style="color: #1f2937; margin-top: 0;">
              Hola ${ctx.cliente.nombre},
            </h2>

            <p>${title}</p>

            ${highlight ? `
            <div style="background: ${highlight.bgColor}; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <p style="color: ${highlight.color}; margin: 0; font-weight: bold; text-align: center;">
                ${highlight.text}
              </p>
            </div>
            ` : ""}

            ${body}

            <p style="color: #6b7280; font-size: 14px; margin-top: 20px;">
              Si tenés alguna consulta, no dudes en contactarnos.
            </p>

            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">

            <p style="color: #9ca3af; font-size: 12px; text-align: center;">
              Este correo fue enviado automáticamente desde ${ctx.organizationName}.
            </p>
          </div>
        </body>
      </html>
    `,
  }
}

// --- Pre-venta y captación ---

export function generateBienvenidaEmail(ctx: NotificationContext) {
  return generateGenericEmail(
    ctx,
    `Bienvenido/a a ${ctx.organizationName}`,
    "Gracias por confiar en nosotros. Somos especialistas en reparación y servicio técnico.",
    `<p>Podés contactarnos para cualquier consulta sobre nuestros servicios. Estamos a tu disposición.</p>`
  )
}

export function generateRespuestaConsultaEmail(ctx: NotificationContext) {
  return generateGenericEmail(
    ctx,
    `Respuesta a tu consulta - ${ctx.organizationName}`,
    "Gracias por tu consulta.",
    `<p>Si querés traer tu equipo para una revisión sin cargo, estamos a tu disposición.</p>`
  )
}

// --- Cobranza y pagos ---

export function generateRecordatorioPagoEmail(ctx: NotificationContext) {
  const formatCurrency = (amount: number) =>
    formatCurrencyValue(amount, (ctx.moneda as CurrencyCode) || DEFAULT_CURRENCY)

  const saldo = ctx.pago?.saldoPendiente || 0

  return generateGenericEmail(
    ctx,
    `Recordatorio de pago pendiente - ${ctx.organizationName}`,
    "Te recordamos que tenés un saldo pendiente.",
    `${ctx.orden ? `
    <div style="background: white; padding: 15px; border-radius: 8px; border: 1px solid #e5e7eb; margin: 20px 0;">
      <p style="margin: 0;"><strong>Orden:</strong> #${ctx.orden.numeroOrden}</p>
      <p style="margin: 8px 0 0 0;"><strong>Dispositivo:</strong> ${ctx.orden.dispositivo}</p>
    </div>
    ` : ""}
    <p>Podés acercarte a nuestro local o consultarnos por medios de pago disponibles.</p>`,
    { text: `Saldo pendiente: ${formatCurrency(saldo)}`, color: "#92400e", bgColor: "#fef3c7" }
  )
}

export function generateConfirmacionPagoEmail(ctx: NotificationContext) {
  const formatCurrency = (amount: number) =>
    formatCurrencyValue(amount, (ctx.moneda as CurrencyCode) || DEFAULT_CURRENCY)

  const monto = ctx.pago?.monto || 0
  const saldoRestante = ctx.pago?.saldoPendiente || 0

  return generateGenericEmail(
    ctx,
    `Confirmación de pago - ${ctx.organizationName}`,
    "Confirmamos la recepción de tu pago.",
    `${ctx.orden ? `
    <div style="background: white; padding: 15px; border-radius: 8px; border: 1px solid #e5e7eb; margin: 20px 0;">
      <p style="margin: 0;"><strong>Orden:</strong> #${ctx.orden.numeroOrden}</p>
      <p style="margin: 8px 0 0 0;"><strong>Dispositivo:</strong> ${ctx.orden.dispositivo}</p>
    </div>
    ` : ""}
    ${saldoRestante > 0 ? `<p>Saldo restante: <strong>${formatCurrency(saldoRestante)}</strong></p>` : "<p>Tu cuenta se encuentra al día. ¡Gracias!</p>"}`,
    { text: `Pago recibido: ${formatCurrency(monto)}`, color: "#166534", bgColor: "#dcfce7" }
  )
}

export function generateLinkPagoEmail(ctx: NotificationContext) {
  const formatCurrency = (amount: number) =>
    formatCurrencyValue(amount, (ctx.moneda as CurrencyCode) || DEFAULT_CURRENCY)

  return generateGenericEmail(
    ctx,
    `Link de pago - ${ctx.organizationName}`,
    "Te enviamos el link para realizar el pago.",
    `${ctx.pago?.linkPago ? `
    <div style="text-align: center; margin: 20px 0;">
      <a href="${ctx.pago.linkPago}" style="background: #3b82f6; color: white; padding: 12px 30px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block;">
        Realizar pago
      </a>
    </div>
    ` : ""}
    ${ctx.orden ? `<p style="color: #6b7280; font-size: 14px;">Orden #${ctx.orden.numeroOrden}</p>` : ""}`,
    ctx.pago?.monto ? { text: `Monto: ${formatCurrency(ctx.pago.monto)}`, color: "#1e40af", bgColor: "#dbeafe" } : undefined
  )
}

// --- Retención y fidelización ---

export function generateMantenimientoEmail(ctx: NotificationContext) {
  const formatDate = (date: Date) => formatDateValue(date, ctx.zonaHoraria)

  return generateGenericEmail(
    ctx,
    `Recordatorio de mantenimiento - ${ctx.organizationName}`,
    "Te recordamos que es buen momento para un chequeo preventivo de tu equipo.",
    `${ctx.mantenimiento?.ultimoServicio ? `<p>Tu último servicio fue el <strong>${formatDate(ctx.mantenimiento.ultimoServicio)}</strong>.${ctx.mantenimiento.tipoServicio ? ` Servicio realizado: ${ctx.mantenimiento.tipoServicio}.` : ""}</p>` : ""}
    <p>El mantenimiento preventivo ayuda a evitar fallas y prolongar la vida útil de tu equipo. Consultanos por un turno disponible.</p>`
  )
}

export function generatePromocionEmail(ctx: NotificationContext) {
  const formatDate = (date: Date) => formatDateValue(date, ctx.zonaHoraria)

  return generateGenericEmail(
    ctx,
    `${ctx.promocion?.titulo || "Promoción"} - ${ctx.organizationName}`,
    ctx.promocion?.descripcion || "",
    `${ctx.promocion?.validoHasta ? `<p style="color: #6b7280;">Válido hasta: ${formatDate(ctx.promocion.validoHasta)}</p>` : ""}`,
    ctx.promocion?.descuento ? { text: ctx.promocion.descuento, color: "#166534", bgColor: "#dcfce7" } : undefined
  )
}

export function generateEncuestaEmail(ctx: NotificationContext) {
  return generateGenericEmail(
    ctx,
    `Nos importa tu opinión - ${ctx.organizationName}`,
    ctx.orden
      ? `Queremos saber cómo fue tu experiencia con la reparación de tu ${ctx.orden.dispositivo} (Orden #${ctx.orden.numeroOrden}).`
      : "Queremos saber cómo fue tu experiencia con nuestro servicio.",
    `<p>Del 1 al 5, ¿qué tan satisfecho/a estás? (1 = Muy insatisfecho, 5 = Excelente)</p>
    ${ctx.encuestaUrl ? `
    <div style="text-align: center; margin: 20px 0;">
      <a href="${ctx.encuestaUrl}" style="background: #3b82f6; color: white; padding: 12px 30px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block;">
        Completar encuesta
      </a>
    </div>
    ` : ""}
    <p>Tu opinión nos ayuda a mejorar. ¡Gracias!</p>`
  )
}

export function generateFelicitacionEmail(ctx: NotificationContext) {
  return generateGenericEmail(
    ctx,
    `¡Feliz día! - ${ctx.organizationName}`,
    "¡Queremos desearte un muy feliz día!",
    `<p>Gracias por ser parte de nuestra comunidad de clientes. Como regalo, tenés un descuento especial en tu próximo servicio. ¡Consultanos por mensaje!</p>`,
    { text: "Descuento especial en tu próximo servicio", color: "#166534", bgColor: "#dcfce7" }
  )
}

// --- Operativo avanzado ---

export function generateSolicitudInfoEmail(ctx: NotificationContext) {
  return generateGenericEmail(
    ctx,
    `Necesitamos información - Orden #${ctx.orden!.numeroOrden}`,
    `Nos comunicamos por tu ${ctx.orden!.dispositivo} (Orden #${ctx.orden!.numeroOrden}).`,
    `<p>${ctx.solicitudInfo || "Necesitamos información adicional para continuar con el servicio."}</p>
    <p>Agradecemos tu pronta respuesta.</p>`
  )
}

export function generateRepuestoDisponibleEmail(ctx: NotificationContext) {
  return generateGenericEmail(
    ctx,
    `Repuesto disponible - Orden #${ctx.orden!.numeroOrden}`,
    "¡Buenas noticias!",
    `<div style="background: white; padding: 15px; border-radius: 8px; border: 1px solid #e5e7eb; margin: 20px 0;">
      <p style="margin: 0;"><strong>Orden:</strong> #${ctx.orden!.numeroOrden}</p>
      <p style="margin: 8px 0 0 0;"><strong>Dispositivo:</strong> ${ctx.orden!.dispositivo}</p>
    </div>
    <p>Retomamos la reparación de inmediato. Te avisaremos cuando esté listo.</p>`,
    { text: `El repuesto "${ctx.repuesto?.nombre || "necesario"}" ya está disponible`, color: "#166534", bgColor: "#dcfce7" }
  )
}

export function generateRepuestoNoDisponibleEmail(ctx: NotificationContext) {
  return generateGenericEmail(
    ctx,
    `Repuesto no disponible - Orden #${ctx.orden!.numeroOrden}`,
    `Te informamos sobre tu ${ctx.orden!.dispositivo} (Orden #${ctx.orden!.numeroOrden}).`,
    `<p>Podemos ofrecerte las siguientes opciones:</p>
    <ul>
      <li>Buscar un repuesto alternativo compatible</li>
      <li>Devolver el equipo sin cargo</li>
    </ul>
    <p>Por favor, indicanos cómo querés seguir.</p>`,
    { text: `El repuesto "${ctx.repuesto?.nombre || "necesario"}" no se encuentra disponible`, color: "#92400e", bgColor: "#fef3c7" }
  )
}

export function generateAvisoDemoraEmail(ctx: NotificationContext) {
  const formatDate = (date: Date) => formatDateValue(date, ctx.zonaHoraria)

  return generateGenericEmail(
    ctx,
    `Aviso de demora - Orden #${ctx.orden!.numeroOrden}`,
    `La reparación de tu ${ctx.orden!.dispositivo} (Orden #${ctx.orden!.numeroOrden}) está tomando más tiempo del estimado.`,
    `${ctx.demora?.motivo ? `<p><strong>Motivo:</strong> ${ctx.demora.motivo}</p>` : ""}
    ${ctx.demora?.nuevaFechaEstimada ? `<p><strong>Nueva fecha estimada:</strong> ${formatDate(ctx.demora.nuevaFechaEstimada)}</p>` : ""}
    <p>Pedimos disculpas por la demora. Estamos trabajando para resolverlo lo antes posible.</p>`,
    { text: "Demora en reparación", color: "#92400e", bgColor: "#fef3c7" }
  )
}

export function generateReingresoGarantiaEmail(ctx: NotificationContext) {
  const formatDate = (date: Date) => formatDateValue(date, ctx.zonaHoraria)

  return generateGenericEmail(
    ctx,
    `Re-ingreso por garantía - Orden #${ctx.orden!.numeroOrden}`,
    `Lamentamos que tengas inconvenientes con tu ${ctx.orden!.dispositivo}.`,
    `<div style="background: white; padding: 15px; border-radius: 8px; border: 1px solid #e5e7eb; margin: 20px 0;">
      <p style="margin: 0;"><strong>Orden:</strong> #${ctx.orden!.numeroOrden}</p>
      <p style="margin: 8px 0 0 0;"><strong>Garantía válida hasta:</strong> ${formatDate(ctx.garantia!.fechaVencimiento)}</p>
    </div>
    <p>Podés traer tu equipo para que lo revisemos sin costo adicional. No necesitás turno, solo acercate en horario de atención.</p>`,
    { text: "Tu reparación está cubierta por garantía", color: "#166534", bgColor: "#dcfce7" }
  )
}

export function generateGarantiaPorVencerEmail(ctx: NotificationContext) {
  const fecha = ctx.garantia ? formatDateValue(ctx.garantia.fechaVencimiento, ctx.zonaHoraria) : ""
  const detalle = escapeHtml(detalleGarantiaCliente(ctx.garantia, ctx.orden))
  return generateGenericEmail(
    ctx,
    `Tu garantía vence el ${fecha}`,
    `Te escribimos para avisarte que la garantía de ${detalle} ${escapeHtml(venceTextoCliente(ctx.garantia?.diasRestantes))}.`,
    `<p>Si notás alguna falla, acercate antes de esa fecha con el equipo y tu comprobante para que lo revisemos sin cargo.</p>`,
    { text: `Vigente hasta el ${escapeHtml(fecha)}`, color: "#92400e", bgColor: "#fef3c7" }
  )
}

// --- Recuperación ---

export function generateClienteInactivoEmail(ctx: NotificationContext) {
  return generateGenericEmail(
    ctx,
    `¡Te extrañamos! - ${ctx.organizationName}`,
    "¡Hace tiempo que no nos visitás!",
    `<p>En ${ctx.organizationName} seguimos a tu disposición para cualquier servicio técnico o consulta que necesites.</p>
    <p>Recordá que ofrecemos diagnóstico sin cargo. Traé tu equipo y lo revisamos sin compromiso.</p>
    <p>¡Te esperamos!</p>`
  )
}

export function generateSeguimientoPresupuestoRechazadoEmail(ctx: NotificationContext) {
  return generateGenericEmail(
    ctx,
    `Alternativas para tu ${ctx.orden!.dispositivo} - ${ctx.organizationName}`,
    `Nos comunicamos por tu ${ctx.orden!.dispositivo} (Orden #${ctx.orden!.numeroOrden}).`,
    `<p>Entendemos que el presupuesto anterior no se ajustaba a tus necesidades. Queremos contarte que podemos evaluar alternativas para resolver el problema de tu equipo.</p>
    <p>Podés responder este correo si querés que revisemos otras opciones.</p>`
  )
}

// === Mapa central para resolver email por tipo de notificación ===

export function generateEmailByType(
  type: NotificationType,
  ctx: NotificationContext,
  extra?: { diasCompletado?: number }
): { subject: string; html: string } | null {
  switch (type) {
    case "CAMBIO_ESTADO":
      return generateCambioEstadoEmail(ctx)
    case "PRESUPUESTO_DEFINIDO":
      return generatePresupuestoEmail(ctx)
    case "GARANTIA_CREADA":
      return generateGarantiaEmail(ctx)
    case "RECORDATORIO_RETIRO":
      return generateRecordatorioEmail(ctx, extra?.diasCompletado || 0)
    case "BIENVENIDA_CLIENTE":
      return generateBienvenidaEmail(ctx)
    case "RESPUESTA_CONSULTA":
      return generateRespuestaConsultaEmail(ctx)
    case "RECORDATORIO_PAGO":
      return generateRecordatorioPagoEmail(ctx)
    case "CONFIRMACION_PAGO":
      return generateConfirmacionPagoEmail(ctx)
    case "LINK_PAGO":
      return generateLinkPagoEmail(ctx)
    case "MANTENIMIENTO_PREVENTIVO":
      return generateMantenimientoEmail(ctx)
    case "PROMOCION":
      return generatePromocionEmail(ctx)
    case "ENCUESTA_SATISFACCION":
      return generateEncuestaEmail(ctx)
    case "FELICITACION":
      return generateFelicitacionEmail(ctx)
    case "SOLICITUD_INFO":
      return generateSolicitudInfoEmail(ctx)
    case "REPUESTO_DISPONIBLE":
      return generateRepuestoDisponibleEmail(ctx)
    case "REPUESTO_NO_DISPONIBLE":
      return generateRepuestoNoDisponibleEmail(ctx)
    case "AVISO_DEMORA":
      return generateAvisoDemoraEmail(ctx)
    case "REINGRESO_GARANTIA":
      return generateReingresoGarantiaEmail(ctx)
    case "GARANTIA_POR_VENCER":
      return generateGarantiaPorVencerEmail(ctx)
    case "CLIENTE_INACTIVO":
      return generateClienteInactivoEmail(ctx)
    case "SEGUIMIENTO_PRESUPUESTO_RECHAZADO":
      return generateSeguimientoPresupuestoRechazadoEmail(ctx)
    default:
      return null
  }
}
