import { formatCurrencyValue, type CurrencyCode, DEFAULT_CURRENCY } from "@/lib/currency"
import { formatDateValue } from "@/lib/timezone"
import { EstadoOrden, NotificationContext } from "./types"

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

const estadoLabels: Record<EstadoOrden, string> = {
  RECIBIDO: "Recibido",
  EN_DIAGNOSTICO: "En diagnóstico",
  PRESUPUESTADO: "Presupuesto enviado",
  APROBADO: "Aprobado - En cola de reparación",
  EN_REPARACION: "En reparación",
  ESPERANDO_REPUESTO: "Esperando repuesto",
  REPARADO: "Reparado - Listo para retirar",
  ENTREGADO: "Entregado",
  CANCELADO: "Cancelado",
  SIN_REPARACION: "Sin reparación posible",
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
  CANCELADO: "#6b7280",
  SIN_REPARACION: "#ef4444",
}

export function generateCambioEstadoEmail(ctx: NotificationContext): {
  subject: string
  html: string
} {
  const estado = ctx.orden!.estado
  const estadoLabel = estadoLabels[estado]
  const estadoColor = estadoColors[estado]

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
          <div style="${headerStyle}">
            <h1 style="color: white; margin: 0;">${ctx.organizationName}</h1>
          </div>
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
                  <strong>Su dispositivo esta listo!</strong><br>
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
          <div style="${headerStyle}">
            <h1 style="color: white; margin: 0;">${ctx.organizationName}</h1>
          </div>
          <div style="${contentStyle}">
            <h2 style="color: #1f2937; margin-top: 0;">
              Hola ${ctx.cliente.nombre},
            </h2>

            <p>Hemos definido el presupuesto para la reparacion de su dispositivo:</p>

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
          <div style="${headerStyle}">
            <h1 style="color: white; margin: 0;">${ctx.organizationName}</h1>
          </div>
          <div style="${contentStyle}">
            <h2 style="color: #1f2937; margin-top: 0;">
              Hola ${ctx.cliente.nombre},
            </h2>

            <p>Su reparacion cuenta ahora con garantia:</p>

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
  return {
    subject: `Recordatorio: Su dispositivo esta listo - Orden #${ctx.orden!.numeroOrden}`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="${baseStyles}">
          <div style="${headerStyle}">
            <h1 style="color: white; margin: 0;">${ctx.organizationName}</h1>
          </div>
          <div style="${contentStyle}">
            <h2 style="color: #1f2937; margin-top: 0;">
              Hola ${ctx.cliente.nombre},
            </h2>

            <div style="background: #fef3c7; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <p style="color: #92400e; margin: 0; font-weight: bold;">
                Le recordamos que su dispositivo esta listo para retirar
              </p>
              <p style="color: #92400e; margin: 8px 0 0 0;">
                Han pasado ${diasCompletado} dia${diasCompletado > 1 ? "s" : ""} desde que fue completada la reparacion.
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
