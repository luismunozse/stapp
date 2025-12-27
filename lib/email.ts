import { Resend } from "resend"

const resend = new Resend(process.env.RESEND_API_KEY)

interface SendPasswordResetEmailParams {
  email: string
  token: string
  nombre: string
}

export async function sendPasswordResetEmail({
  email,
  token,
  nombre,
}: SendPasswordResetEmailParams) {
  const resetUrl = `${process.env.NEXTAUTH_URL}/reset-password/${token}`

  const { data, error } = await resend.emails.send({
    from: process.env.EMAIL_FROM || "STApp <onboarding@resend.dev>",
    to: email,
    subject: "Restablecer contraseña - STApp",
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Restablecer contraseña</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 24px;">STApp</h1>
          </div>

          <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
            <h2 style="color: #1f2937; margin-top: 0;">Hola ${nombre},</h2>

            <p style="color: #4b5563;">
              Recibimos una solicitud para restablecer la contraseña de tu cuenta.
              Si no realizaste esta solicitud, puedes ignorar este correo.
            </p>

            <div style="text-align: center; margin: 30px 0;">
              <a href="${resetUrl}"
                 style="background: #3b82f6; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
                Restablecer Contraseña
              </a>
            </div>

            <p style="color: #6b7280; font-size: 14px;">
              Este enlace expirará en <strong>1 hora</strong>.
            </p>

            <p style="color: #6b7280; font-size: 14px;">
              Si el botón no funciona, copia y pega este enlace en tu navegador:
            </p>
            <p style="color: #3b82f6; font-size: 12px; word-break: break-all;">
              ${resetUrl}
            </p>

            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">

            <p style="color: #9ca3af; font-size: 12px; text-align: center; margin: 0;">
              Este correo fue enviado automáticamente. Por favor no respondas a este mensaje.
            </p>
          </div>
        </body>
      </html>
    `,
  })

  if (error) {
    console.error("Error sending email:", error)
    throw new Error("Error al enviar el correo")
  }

  return data
}

interface SendCotizacionEmailParams {
  email: string
  nombreCliente: string
  numeroCotizacion: string
  numeroOrden: number
  total: number
  fechaVencimiento?: Date | null
  pdfBuffer: Buffer
}

export async function sendCotizacionEmail({
  email,
  nombreCliente,
  numeroCotizacion,
  numeroOrden,
  total,
  fechaVencimiento,
  pdfBuffer,
}: SendCotizacionEmailParams) {
  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(amount)

  const vencimientoText = fechaVencimiento
    ? `Esta cotización es válida hasta el ${new Date(fechaVencimiento).toLocaleDateString("es-AR")}.`
    : "Esta cotización no tiene fecha de vencimiento especificada."

  const { data, error } = await resend.emails.send({
    from: process.env.EMAIL_FROM || "STApp <onboarding@resend.dev>",
    to: email,
    subject: `Cotización ${numeroCotizacion} - Orden #${numeroOrden}`,
    attachments: [
      {
        filename: `${numeroCotizacion}.pdf`,
        content: pdfBuffer,
      },
    ],
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Cotización ${numeroCotizacion}</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 24px;">STApp</h1>
          </div>

          <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
            <h2 style="color: #1f2937; margin-top: 0;">Hola ${nombreCliente},</h2>

            <p style="color: #4b5563;">
              Le enviamos la cotización <strong>${numeroCotizacion}</strong> correspondiente a la orden de servicio <strong>#${numeroOrden}</strong>.
            </p>

            <div style="background: white; padding: 20px; border-radius: 8px; border: 1px solid #e5e7eb; margin: 20px 0;">
              <div style="text-align: center;">
                <p style="color: #6b7280; margin: 0 0 5px 0; font-size: 14px;">Total de la cotización</p>
                <p style="color: #1f2937; margin: 0; font-size: 28px; font-weight: bold;">${formatCurrency(total)}</p>
              </div>
            </div>

            <p style="color: #4b5563;">
              ${vencimientoText}
            </p>

            <p style="color: #4b5563;">
              Adjuntamos el documento PDF con el detalle completo. Si tiene alguna consulta o desea aceptar esta cotización, por favor contáctenos.
            </p>

            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">

            <p style="color: #9ca3af; font-size: 12px; text-align: center; margin: 0;">
              Este correo fue enviado automáticamente. Por favor responda si desea confirmar o tiene consultas.
            </p>
          </div>
        </body>
      </html>
    `,
  })

  if (error) {
    console.error("Error sending cotizacion email:", error)
    throw new Error("Error al enviar el correo de cotización")
  }

  return data
}
