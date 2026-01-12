const ENVIALOSIMPLE_API_URL = "https://backend.envialosimple.email/api/v1/mail/send"
const EMAIL_FROM = process.env.EMAIL_FROM || "noreply@stapp.com.ar"

interface SendEmailParams {
  to: string
  subject: string
  html: string
  substitutions?: Record<string, string>
  attachments?: Array<{
    filename: string
    content: string // base64
    type: string
  }>
}

async function sendEmail({ to, subject, html, substitutions, attachments }: SendEmailParams) {
  const apiKey = process.env.ENVIALOSIMPLE_API_KEY

  if (!apiKey) {
    throw new Error("ENVIALOSIMPLE_API_KEY no está configurada")
  }

  const payload: Record<string, unknown> = {
    from: EMAIL_FROM,
    to,
    subject,
    html,
  }

  if (substitutions) {
    payload.substitutions = substitutions
  }

  if (attachments && attachments.length > 0) {
    payload.attachments = attachments.map((att) => ({
      filename: att.filename,
      content: att.content,
      type: att.type,
    }))
  }

  const response = await fetch(ENVIALOSIMPLE_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const errorData = await response.text()
    console.error("EnvialoSimple error:", errorData)
    throw new Error("Error al enviar el correo")
  }

  return await response.json()
}

interface SendVerificationEmailParams {
  email: string
  token: string
  nombre: string
  slug: string
}

export async function sendVerificationEmail({
  email,
  token,
  nombre,
  slug,
}: SendVerificationEmailParams) {
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "stapp.com.ar"
  const verifyUrl = `https://${slug}.${rootDomain}/verificar-email?token=${token}`

  return sendEmail({
    to: email,
    subject: "Verifica tu cuenta - STApp",
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Verificar cuenta</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 24px;">STApp</h1>
          </div>

          <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
            <h2 style="color: #1f2937; margin-top: 0;">¡Bienvenido ${nombre}!</h2>

            <p style="color: #4b5563;">
              Gracias por registrarte en STApp. Para completar tu registro y acceder a tu cuenta,
              necesitas verificar tu dirección de correo electrónico.
            </p>

            <div style="text-align: center; margin: 30px 0;">
              <a href="${verifyUrl}"
                 style="background: #3b82f6; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
                Verificar mi cuenta
              </a>
            </div>

            <p style="color: #6b7280; font-size: 14px;">
              Este enlace expirará en <strong>24 horas</strong>.
            </p>

            <p style="color: #6b7280; font-size: 14px;">
              Si el botón no funciona, copia y pega este enlace en tu navegador:
            </p>
            <p style="color: #3b82f6; font-size: 12px; word-break: break-all;">
              ${verifyUrl}
            </p>

            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">

            <p style="color: #9ca3af; font-size: 12px; text-align: center; margin: 0;">
              Si no creaste esta cuenta, puedes ignorar este correo.
            </p>
          </div>
        </body>
      </html>
    `,
  })
}

interface SendPasswordResetEmailParams {
  email: string
  token: string
  nombre: string
  slug: string
}

export async function sendPasswordResetEmail({
  email,
  token,
  nombre,
  slug,
}: SendPasswordResetEmailParams) {
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "stapp.com.ar"
  const resetUrl = `https://${slug}.${rootDomain}/reset-password/${token}`

  return sendEmail({
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

  return sendEmail({
    to: email,
    subject: `Cotización ${numeroCotizacion} - Orden #${numeroOrden}`,
    attachments: [
      {
        content: pdfBuffer.toString("base64"),
        filename: `${numeroCotizacion}.pdf`,
        type: "application/pdf",
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
}
