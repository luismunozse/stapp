import { formatCurrencyValue, type CurrencyCode, DEFAULT_CURRENCY } from "@/lib/currency"
import { formatDateValue } from "@/lib/timezone"
import { EstadoOrden, NotificationContext, NotificationType } from "./types"
import { resolveTerminologia, t } from "@/lib/terminologia"

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
  APROBADO: "Aprobado - En cola de reparación",
  EN_REPARACION: "En reparación",
  ESPERANDO_REPUESTO: "Esperando repuesto",
  REPARADO: "Reparado - Listo para retirar",
  ENTREGADO: "Entregado",
  ENTREGADO_SIN_REPARACION: "Retirado sin reparación",
  ENTREGADO_SIN_COBRO: "Entregado sin cobro",
  CANCELADO: "Cancelado",
  SIN_REPARACION: "Sin reparación posible",
  SIN_FALLA_DETECTADA: "Sin falla detectada",
}

const estadoColors: Record<EstadoOrden, string> = {
  RECIBIDO: "#64748b",
  EN_DIAGNOSTICO: "#a855f7",
  PRESUPUESTADO: "#f59e0b",
  APROBADO: "#3b82f6",
  EN_REPARACION: "#eab308",
  ESPERANDO_REPUESTO: "#f97316",
  REPARADO: "#06b6d4",
  ENTREGADO: "#22c55e",
  ENTREGADO_SIN_REPARACION: "#d97706",
  ENTREGADO_SIN_COBRO: "#0ea5e9",
  CANCELADO: "#6b7280",
  SIN_REPARACION: "#ef4444",
  SIN_FALLA_DETECTADA: "#14b8a6",
}

export function generateCambioEstadoEmail(ctx: NotificationContext): {
  subject: string
  html: string
} {
  const estado = ctx.orden!.estado
  const estadoLabel = estadoLabels[estado]
  const estadoColor = estadoColors[estado]
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

            <p>Le informamos que su orden de servicio ha sido actualizada:</p>

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
                    <span style="background: ${estadoColor}20; color: ${estadoColor}; padding: 4px 12px; border-radius: 4px; font-weight: bold;">
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
                  <strong>Su ${tEquipo} esta listo!</strong><br>
                  Puede pasar a retirarlo en nuestro local en horario de atencion.
                </p>
              </div>
            `
                : ""
            }

            <p style="color: #6b7280; font-size: 14px;">
              Si tiene alguna consulta, no dude en contactarnos.
            </p>

            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">

            <p style="color: #9ca3af; font-size: 12px; text-align: center;">
              Este correo fue enviado automaticamente desde ${ctx.organizationName}.
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

            <p>Hemos definido el presupuesto para la ${tReparacion.toLowerCase()} de su ${t(term, "equipo")}:</p>

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
              Por favor confirme si desea proceder con la reparacion contactandonos.
            </p>

            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">

            <p style="color: #9ca3af; font-size: 12px; text-align: center;">
              Este correo fue enviado automaticamente desde ${ctx.organizationName}.
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
    subject: `Garantia activada - Orden #${ctx.orden!.numeroOrden}`,
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

            <p>Su ${tReparacion.toLowerCase()} cuenta ahora con garantia:</p>

            <div style="background: #dcfce7; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <div style="text-align: center;">
                <p style="color: #166534; margin: 0; font-size: 24px; font-weight: bold;">
                  ${ctx.garantia!.diasValidez} dias de garantia
                </p>
                <p style="color: #166534; margin: 8px 0 0 0;">
                  Valida hasta: ${formatDate(ctx.garantia!.fechaVencimiento)}
                </p>
              </div>
            </div>

            <div style="background: white; padding: 15px; border-radius: 8px; border: 1px solid #e5e7eb;">
              <p style="margin: 0;"><strong>Orden:</strong> #${ctx.orden!.numeroOrden}</p>
              <p style="margin: 8px 0 0 0;"><strong>Dispositivo:</strong> ${ctx.orden!.dispositivo}</p>
            </div>

            <p style="margin-top: 20px; color: #6b7280; font-size: 14px;">
              Conserve este correo como comprobante de garantia. Ante cualquier inconveniente
              dentro del periodo de garantia, contactenos.
            </p>

            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">

            <p style="color: #9ca3af; font-size: 12px; text-align: center;">
              Este correo fue enviado automaticamente desde ${ctx.organizationName}.
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
    subject: `Recordatorio: Tu ${tEquipo} esta listo para retirar - Orden #${ctx.orden!.numeroOrden}`,
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
                Le recordamos que su ${tEquipo.toLowerCase()} esta listo para retirar
              </p>
              <p style="color: #92400e; margin: 8px 0 0 0;">
                Han pasado ${diasCompletado} dia${diasCompletado > 1 ? "s" : ""} desde que fue completada la ${t(term, "reparacion").toLowerCase()}.
              </p>
            </div>

            <div style="background: white; padding: 15px; border-radius: 8px; border: 1px solid #e5e7eb;">
              <p style="margin: 0;"><strong>Orden:</strong> #${ctx.orden!.numeroOrden}</p>
              <p style="margin: 8px 0 0 0;"><strong>Dispositivo:</strong> ${ctx.orden!.dispositivo}</p>
            </div>

            <p style="margin-top: 20px;">
              Puede pasar a retirarlo en nuestro local en horario de atencion.
            </p>

            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">

            <p style="color: #9ca3af; font-size: 12px; text-align: center;">
              Este correo fue enviado automaticamente desde ${ctx.organizationName}.
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
              Si tiene alguna consulta, no dude en contactarnos.
            </p>

            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">

            <p style="color: #9ca3af; font-size: 12px; text-align: center;">
              Este correo fue enviado automaticamente desde ${ctx.organizationName}.
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
    "Gracias por confiar en nosotros. Somos especialistas en reparacion y servicio tecnico.",
    `<p>Puede contactarnos para cualquier consulta sobre nuestros servicios. Estamos a su disposicion.</p>`
  )
}

export function generateRespuestaConsultaEmail(ctx: NotificationContext) {
  return generateGenericEmail(
    ctx,
    `Respuesta a su consulta - ${ctx.organizationName}`,
    "Gracias por su consulta.",
    `<p>Si desea traer su equipo para una revision sin cargo, estamos a su disposicion.</p>`
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
    "Le recordamos que tiene un saldo pendiente.",
    `${ctx.orden ? `
    <div style="background: white; padding: 15px; border-radius: 8px; border: 1px solid #e5e7eb; margin: 20px 0;">
      <p style="margin: 0;"><strong>Orden:</strong> #${ctx.orden.numeroOrden}</p>
      <p style="margin: 8px 0 0 0;"><strong>Dispositivo:</strong> ${ctx.orden.dispositivo}</p>
    </div>
    ` : ""}
    <p>Puede acercarse a nuestro local o consultarnos por medios de pago disponibles.</p>`,
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
    `Confirmacion de pago - ${ctx.organizationName}`,
    "Confirmamos la recepcion de su pago.",
    `${ctx.orden ? `
    <div style="background: white; padding: 15px; border-radius: 8px; border: 1px solid #e5e7eb; margin: 20px 0;">
      <p style="margin: 0;"><strong>Orden:</strong> #${ctx.orden.numeroOrden}</p>
      <p style="margin: 8px 0 0 0;"><strong>Dispositivo:</strong> ${ctx.orden.dispositivo}</p>
    </div>
    ` : ""}
    ${saldoRestante > 0 ? `<p>Saldo restante: <strong>${formatCurrency(saldoRestante)}</strong></p>` : "<p>Su cuenta se encuentra al dia. Gracias!</p>"}`,
    { text: `Pago recibido: ${formatCurrency(monto)}`, color: "#166534", bgColor: "#dcfce7" }
  )
}

export function generateLinkPagoEmail(ctx: NotificationContext) {
  const formatCurrency = (amount: number) =>
    formatCurrencyValue(amount, (ctx.moneda as CurrencyCode) || DEFAULT_CURRENCY)

  return generateGenericEmail(
    ctx,
    `Link de pago - ${ctx.organizationName}`,
    "Le enviamos el link para realizar el pago.",
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
    "Le recordamos que es buen momento para un chequeo preventivo de su equipo.",
    `${ctx.mantenimiento?.ultimoServicio ? `<p>Su ultimo servicio fue el <strong>${formatDate(ctx.mantenimiento.ultimoServicio)}</strong>.${ctx.mantenimiento.tipoServicio ? ` Servicio realizado: ${ctx.mantenimiento.tipoServicio}.` : ""}</p>` : ""}
    <p>El mantenimiento preventivo ayuda a evitar fallas y prolongar la vida util de su equipo. Consulte por turno disponible.</p>`
  )
}

export function generatePromocionEmail(ctx: NotificationContext) {
  const formatDate = (date: Date) => formatDateValue(date, ctx.zonaHoraria)

  return generateGenericEmail(
    ctx,
    `${ctx.promocion?.titulo || "Promocion"} - ${ctx.organizationName}`,
    ctx.promocion?.descripcion || "",
    `${ctx.promocion?.validoHasta ? `<p style="color: #6b7280;">Valido hasta: ${formatDate(ctx.promocion.validoHasta)}</p>` : ""}`,
    ctx.promocion?.descuento ? { text: ctx.promocion.descuento, color: "#166534", bgColor: "#dcfce7" } : undefined
  )
}

export function generateEncuestaEmail(ctx: NotificationContext) {
  return generateGenericEmail(
    ctx,
    `Nos importa su opinion - ${ctx.organizationName}`,
    ctx.orden
      ? `Queremos saber como fue su experiencia con la reparacion de su ${ctx.orden.dispositivo} (Orden #${ctx.orden.numeroOrden}).`
      : "Queremos saber como fue su experiencia con nuestro servicio.",
    `<p>Del 1 al 5, que tan satisfecho esta? (1 = Muy insatisfecho, 5 = Excelente)</p>
    ${ctx.encuestaUrl ? `
    <div style="text-align: center; margin: 20px 0;">
      <a href="${ctx.encuestaUrl}" style="background: #3b82f6; color: white; padding: 12px 30px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block;">
        Completar encuesta
      </a>
    </div>
    ` : ""}
    <p>Su opinion nos ayuda a mejorar. Gracias!</p>`
  )
}

export function generateFelicitacionEmail(ctx: NotificationContext) {
  return generateGenericEmail(
    ctx,
    `Feliz dia! - ${ctx.organizationName}`,
    "Queremos desearle un muy feliz dia!",
    `<p>Gracias por ser parte de nuestra comunidad de clientes. Como regalo, tiene un descuento especial en su proximo servicio. Consulte por mensaje!</p>`,
    { text: "Descuento especial en su proximo servicio", color: "#166534", bgColor: "#dcfce7" }
  )
}

// --- Operativo avanzado ---

export function generateSolicitudInfoEmail(ctx: NotificationContext) {
  return generateGenericEmail(
    ctx,
    `Necesitamos informacion - Orden #${ctx.orden!.numeroOrden}`,
    `Nos comunicamos por su ${ctx.orden!.dispositivo} (Orden #${ctx.orden!.numeroOrden}).`,
    `<p>${ctx.solicitudInfo || "Necesitamos informacion adicional para continuar con el servicio."}</p>
    <p>Agradecemos su pronta respuesta.</p>`
  )
}

export function generateRepuestoDisponibleEmail(ctx: NotificationContext) {
  return generateGenericEmail(
    ctx,
    `Repuesto disponible - Orden #${ctx.orden!.numeroOrden}`,
    "Buenas noticias!",
    `<div style="background: white; padding: 15px; border-radius: 8px; border: 1px solid #e5e7eb; margin: 20px 0;">
      <p style="margin: 0;"><strong>Orden:</strong> #${ctx.orden!.numeroOrden}</p>
      <p style="margin: 8px 0 0 0;"><strong>Dispositivo:</strong> ${ctx.orden!.dispositivo}</p>
    </div>
    <p>Retomamos la reparacion de inmediato. Le avisaremos cuando este listo.</p>`,
    { text: `El repuesto "${ctx.repuesto?.nombre || "necesario"}" ya esta disponible`, color: "#166534", bgColor: "#dcfce7" }
  )
}

export function generateRepuestoNoDisponibleEmail(ctx: NotificationContext) {
  return generateGenericEmail(
    ctx,
    `Repuesto no disponible - Orden #${ctx.orden!.numeroOrden}`,
    `Le informamos sobre su ${ctx.orden!.dispositivo} (Orden #${ctx.orden!.numeroOrden}).`,
    `<p>Podemos ofrecerle las siguientes opciones:</p>
    <ul>
      <li>Buscar un repuesto alternativo compatible</li>
      <li>Devolver el equipo sin cargo</li>
    </ul>
    <p>Por favor indiquenos como desea proceder.</p>`,
    { text: `El repuesto "${ctx.repuesto?.nombre || "necesario"}" no se encuentra disponible`, color: "#92400e", bgColor: "#fef3c7" }
  )
}

export function generateAvisoDemoraEmail(ctx: NotificationContext) {
  const formatDate = (date: Date) => formatDateValue(date, ctx.zonaHoraria)

  return generateGenericEmail(
    ctx,
    `Aviso de demora - Orden #${ctx.orden!.numeroOrden}`,
    `La reparacion de su ${ctx.orden!.dispositivo} (Orden #${ctx.orden!.numeroOrden}) esta tomando mas tiempo del estimado.`,
    `${ctx.demora?.motivo ? `<p><strong>Motivo:</strong> ${ctx.demora.motivo}</p>` : ""}
    ${ctx.demora?.nuevaFechaEstimada ? `<p><strong>Nueva fecha estimada:</strong> ${formatDate(ctx.demora.nuevaFechaEstimada)}</p>` : ""}
    <p>Pedimos disculpas por la demora. Estamos trabajando para resolverlo lo antes posible.</p>`,
    { text: "Demora en reparacion", color: "#92400e", bgColor: "#fef3c7" }
  )
}

export function generateReingresoGarantiaEmail(ctx: NotificationContext) {
  const formatDate = (date: Date) => formatDateValue(date, ctx.zonaHoraria)

  return generateGenericEmail(
    ctx,
    `Re-ingreso por garantia - Orden #${ctx.orden!.numeroOrden}`,
    `Lamentamos que tenga inconvenientes con su ${ctx.orden!.dispositivo}.`,
    `<div style="background: white; padding: 15px; border-radius: 8px; border: 1px solid #e5e7eb; margin: 20px 0;">
      <p style="margin: 0;"><strong>Orden original:</strong> #${ctx.orden!.numeroOrden}</p>
      <p style="margin: 8px 0 0 0;"><strong>Garantia valida hasta:</strong> ${formatDate(ctx.garantia!.fechaVencimiento)}</p>
    </div>
    <p>Puede traer su equipo para que lo revisemos sin costo adicional. No necesita turno, solo acerquese en horario de atencion.</p>`,
    { text: "Su reparacion esta cubierta por garantia", color: "#166534", bgColor: "#dcfce7" }
  )
}

// --- Recuperación ---

export function generateClienteInactivoEmail(ctx: NotificationContext) {
  return generateGenericEmail(
    ctx,
    `Lo extranamos! - ${ctx.organizationName}`,
    "Hace tiempo que no nos visita!",
    `<p>En ${ctx.organizationName} seguimos a su disposicion para cualquier servicio tecnico o consulta que necesite.</p>
    <p>Recuerde que ofrecemos diagnostico sin cargo. Traiga su equipo y lo revisamos sin compromiso.</p>
    <p>Lo esperamos!</p>`
  )
}

export function generateSeguimientoPresupuestoRechazadoEmail(ctx: NotificationContext) {
  return generateGenericEmail(
    ctx,
    `Alternativas para su ${ctx.orden!.dispositivo} - ${ctx.organizationName}`,
    `Nos comunicamos por su ${ctx.orden!.dispositivo} (Orden #${ctx.orden!.numeroOrden}).`,
    `<p>Entendemos que el presupuesto anterior no se ajustaba a sus necesidades. Queremos informarle que podemos evaluar alternativas para resolver el problema de su equipo.</p>
    <p>Puede responder este correo si desea que revisemos otras opciones.</p>`
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
    case "CLIENTE_INACTIVO":
      return generateClienteInactivoEmail(ctx)
    case "SEGUIMIENTO_PRESUPUESTO_RECHAZADO":
      return generateSeguimientoPresupuestoRechazadoEmail(ctx)
    default:
      return null
  }
}
