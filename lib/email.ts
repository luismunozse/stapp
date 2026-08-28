import { formatCurrencyValue, type CurrencyCode, DEFAULT_CURRENCY } from "@/lib/currency"
import { formatDateValue } from "@/lib/timezone"
import { CONTACT_EMAIL } from "@/lib/contact"

const ENVIALOSIMPLE_API_URL = "https://backend.envialosimple.email/api/v1/mail/send"
const EMAIL_FROM = process.env.EMAIL_FROM || "noreply@stapp.com.ar"

// ============================================
// ESTILOS BASE
// ============================================
const getEmailStyles = () => `
  <style>
    @media (prefers-color-scheme: dark) {
      .email-body { background-color: #1a1a1a !important; }
      .email-container { background-color: #1a1a1a !important; }
      .email-content { background-color: #262626 !important; border-color: #404040 !important; }
      .email-card { background-color: #333333 !important; border-color: #404040 !important; }
      .text-heading { color: #f5f5f5 !important; }
      .text-body { color: #e5e5e5 !important; }
      .text-muted { color: #a3a3a3 !important; }
      .text-link { color: #60a5fa !important; }
      .divider { border-color: #404040 !important; }
      .footer-section { background-color: #1f1f1f !important; border-color: #404040 !important; }
    }
  </style>
`

const getBaseTemplate = (options: {
  preheader: string
  headerGradient?: string
  content: string
  footerText?: string
  rootDomain: string
}) => {
  const {
    preheader,
    headerGradient = "linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)",
    content,
    footerText = "Este correo fue enviado automáticamente. Por favor no respondas a este mensaje.",
    rootDomain,
  } = options

  return `
    <!DOCTYPE html>
    <html lang="es">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta name="color-scheme" content="light dark">
        <meta name="supported-color-schemes" content="light dark">
        <title>STApp</title>
        ${getEmailStyles()}
      </head>
      <body class="email-body" style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; background-color: #f3f4f6;">

        <!-- Preheader (texto de preview en inbox) -->
        <div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">
          ${preheader}
          ${"&nbsp;".repeat(100)}
        </div>

        <!-- Contenedor principal -->
        <table class="email-container" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f3f4f6;">
          <tr>
            <td align="center" style="padding: 40px 20px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px;">

                <!-- Header con logo -->
                <tr>
                  <td style="background: ${headerGradient}; padding: 32px 40px; text-align: center; border-radius: 16px 16px 0 0;">
                    <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 0 auto;">
                      <tr>
                        <td style="vertical-align: middle; padding-right: 10px;">
                          <img src="https://${rootDomain}/icon-192.png" alt="" style="height: 36px; width: 36px; border-radius: 8px;" />
                        </td>
                        <td style="vertical-align: middle;">
                          <span style="color: #ffffff; font-size: 24px; font-weight: 700; letter-spacing: -0.5px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">STApp</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Contenido -->
                <tr>
                  <td class="email-content" style="background-color: #ffffff; padding: 40px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 16px 16px;">
                    ${content}
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td class="footer-section" style="padding: 24px 40px; text-align: center;">
                    <p class="text-muted" style="color: #9ca3af; font-size: 13px; margin: 0 0 12px 0;">
                      ${footerText}
                    </p>
                    <p class="text-muted" style="color: #9ca3af; font-size: 12px; margin: 0;">
                      <a href="https://${rootDomain}" class="text-link" style="color: #3b82f6; text-decoration: none;">STApp</a>
                      &nbsp;•&nbsp;
                      <a href="https://${rootDomain}/ayuda" class="text-link" style="color: #3b82f6; text-decoration: none;">Centro de ayuda</a>
                    </p>
                  </td>
                </tr>

              </table>
            </td>
          </tr>
        </table>

      </body>
    </html>
  `
}

// ============================================
// COMPONENTES REUTILIZABLES
// ============================================
const getButton = (href: string, text: string, color = "#3b82f6") => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td align="center" style="padding: 32px 0;">
        <a href="${href}"
           style="background: ${color}; color: #ffffff; padding: 16px 32px; text-decoration: none; border-radius: 10px; font-weight: 600; font-size: 16px; display: inline-block; box-shadow: 0 4px 14px 0 rgba(59, 130, 246, 0.3);">
          ${text}
        </a>
      </td>
    </tr>
  </table>
`

const getInfoCard = (content: string, bgColor = "#f9fafb") => `
  <table class="email-card" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 24px 0;">
    <tr>
      <td style="background-color: ${bgColor}; padding: 24px; border-radius: 12px; border: 1px solid #e5e7eb;">
        ${content}
      </td>
    </tr>
  </table>
`

const getDivider = () => `
  <hr class="divider" style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0;">
`

// ============================================
// ENVÍO DE EMAIL
// ============================================
interface SendEmailParams {
  to: string
  subject: string
  html: string
  /** Nombre a mostrar como remitente (ej. el nombre del taller). La dirección
   *  sigue siendo la verificada en EMAIL_FROM. */
  fromName?: string
  substitutions?: Record<string, string>
  attachments?: Array<{
    filename: string
    content: string // base64
    type: string
  }>
}

/** Extrae la dirección de un from con formato "Nombre <addr>" o "addr". */
function addressOf(from: string): string {
  const match = from.match(/<([^>]+)>/)
  return match ? match[1].trim() : from.trim()
}

export async function sendEmail({ to, subject, html, fromName, substitutions, attachments }: SendEmailParams) {
  const apiKey = process.env.ENVIALOSIMPLE_API_KEY

  if (!apiKey) {
    throw new Error("ENVIALOSIMPLE_API_KEY no está configurada")
  }

  const from = fromName ? `${fromName} <${addressOf(EMAIL_FROM)}>` : EMAIL_FROM

  const payload: Record<string, unknown> = {
    from,
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
      disposition: "attachment",
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
    console.error("EnvialoSimple status:", response.status)
    console.error("EnvialoSimple payload keys:", Object.keys(payload))
    if (attachments && attachments.length > 0) {
      console.error("EnvialoSimple attachment info:", attachments.map(a => ({ filename: a.filename, type: a.type, contentLength: a.content.length })))
    }
    throw new Error(`Error al enviar el correo: ${errorData}`)
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

  const content = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center" style="padding-bottom: 24px;">
          <img src="https://${rootDomain}/icon-192.png" alt="STApp" style="width: 80px; height: 80px;" />
        </td>
      </tr>
      <tr>
        <td align="center">
          <h1 class="text-heading" style="color: #1f2937; font-size: 24px; font-weight: 700; margin: 0 0 8px 0;">
            ¡Bienvenido a STApp!
          </h1>
        </td>
      </tr>
    </table>

    <p class="text-body" style="color: #4b5563; font-size: 16px; text-align: center; margin: 16px 0 0 0;">
      Hola <strong>${nombre}</strong>, gracias por registrarte.
    </p>

    <p class="text-body" style="color: #4b5563; font-size: 16px; text-align: center; margin: 8px 0 0 0;">
      Para completar tu registro y acceder a tu cuenta, verifica tu correo electrónico.
    </p>

    ${getButton(verifyUrl, "Verificar mi cuenta")}

    ${getInfoCard(`
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td align="center">
            <p class="text-muted" style="color: #6b7280; font-size: 14px; margin: 0;">
              ⏱️ Este enlace expirará en <strong>24 horas</strong>
            </p>
          </td>
        </tr>
      </table>
    `)}

    ${getDivider()}

    <p class="text-muted" style="color: #9ca3af; font-size: 13px; text-align: center; margin: 0 0 8px 0;">
      ¿El botón no funciona? Copia y pega este enlace en tu navegador:
    </p>
    <p class="text-link" style="color: #3b82f6; font-size: 12px; word-break: break-all; text-align: center; margin: 0;">
      ${verifyUrl}
    </p>

    ${getDivider()}

    <p class="text-muted" style="color: #9ca3af; font-size: 12px; text-align: center; margin: 0;">
      Si no creaste esta cuenta, puedes ignorar este correo de forma segura.
    </p>
  `

  return sendEmail({
    to: email,
    subject: "Verifica tu cuenta - STApp",
    html: getBaseTemplate({
      preheader: `${nombre}, verifica tu email para activar tu cuenta de STApp`,
      content,
      rootDomain,
      footerText: "Este correo fue enviado porque alguien se registró con esta dirección de email.",
    }),
  })
}

interface SendAccountActivatedEmailParams {
  email: string
  nombre: string
  slug: string
}

/**
 * Confirmación post-verificación: se envía justo después de que el usuario
 * verifica su email. Confirma que la cuenta quedó activa e incluye el enlace
 * directo de ingreso a su subdominio.
 */
export async function sendAccountActivatedEmail({
  email,
  nombre,
  slug,
}: SendAccountActivatedEmailParams) {
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "stapp.com.ar"
  const loginUrl = `https://${slug}.${rootDomain}/login`

  const content = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center" style="padding-bottom: 24px;">
          <table role="presentation" cellpadding="0" cellspacing="0">
            <tr>
              <td style="background: linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%); width: 80px; height: 80px; border-radius: 50%; text-align: center; vertical-align: middle; font-size: 36px;">
                &#9989;
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td align="center">
          <h1 class="text-heading" style="color: #1f2937; font-size: 24px; font-weight: 700; margin: 0 0 8px 0;">
            ¡Tu cuenta está activa!
          </h1>
        </td>
      </tr>
    </table>

    <p class="text-body" style="color: #4b5563; font-size: 16px; text-align: center; margin: 16px 0 0 0;">
      Hola <strong>${nombre}</strong>, tu correo fue verificado correctamente.
    </p>

    <p class="text-body" style="color: #4b5563; font-size: 16px; text-align: center; margin: 8px 0 0 0;">
      Ya podés ingresar a tu cuenta y empezar a usar STApp.
    </p>

    ${getButton(loginUrl, "Iniciar sesión", "#22c55e")}

    ${getDivider()}

    <p class="text-muted" style="color: #9ca3af; font-size: 13px; text-align: center; margin: 0 0 8px 0;">
      ¿El botón no funciona? Copia y pega este enlace en tu navegador:
    </p>
    <p class="text-link" style="color: #3b82f6; font-size: 12px; word-break: break-all; text-align: center; margin: 0;">
      ${loginUrl}
    </p>
  `

  return sendEmail({
    to: email,
    subject: "Tu cuenta está activa - STApp",
    html: getBaseTemplate({
      preheader: `${nombre}, tu cuenta de STApp ya está activa. Iniciá sesión.`,
      headerGradient: "linear-gradient(135deg, #22c55e 0%, #16a34a 100%)",
      content,
      rootDomain,
      footerText: "Recibiste este correo porque acabás de verificar tu cuenta en STApp.",
    }),
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

  const content = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center" style="padding-bottom: 24px;">
          <table role="presentation" cellpadding="0" cellspacing="0">
            <tr>
              <td style="background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); width: 80px; height: 80px; border-radius: 50%; text-align: center; vertical-align: middle; font-size: 36px;">
                &#128274;
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td align="center">
          <h1 class="text-heading" style="color: #1f2937; font-size: 24px; font-weight: 700; margin: 0 0 8px 0;">
            Restablecer contraseña
          </h1>
        </td>
      </tr>
    </table>

    <p class="text-body" style="color: #4b5563; font-size: 16px; text-align: center; margin: 16px 0 0 0;">
      Hola <strong>${nombre}</strong>,
    </p>

    <p class="text-body" style="color: #4b5563; font-size: 16px; text-align: center; margin: 8px 0 0 0;">
      Recibimos una solicitud para restablecer la contraseña de tu cuenta.
    </p>

    ${getButton(resetUrl, "Restablecer contraseña", "#f59e0b")}

    ${getInfoCard(`
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td align="center">
            <p class="text-muted" style="color: #6b7280; font-size: 14px; margin: 0;">
              ⏱️ Por seguridad, este enlace expirará en <strong>1 hora</strong>
            </p>
          </td>
        </tr>
      </table>
    `, "#fef3c7")}

    ${getDivider()}

    <p class="text-muted" style="color: #9ca3af; font-size: 13px; text-align: center; margin: 0 0 8px 0;">
      ¿El botón no funciona? Copia y pega este enlace en tu navegador:
    </p>
    <p class="text-link" style="color: #3b82f6; font-size: 12px; word-break: break-all; text-align: center; margin: 0;">
      ${resetUrl}
    </p>

    ${getDivider()}

    ${getInfoCard(`
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td align="center">
            <p class="text-muted" style="color: #92400e; font-size: 13px; margin: 0;">
              🔒 <strong>Consejo de seguridad:</strong> Si no solicitaste este cambio, ignora este correo. Tu contraseña actual seguirá siendo válida.
            </p>
          </td>
        </tr>
      </table>
    `, "#fef3c7")}
  `

  return sendEmail({
    to: email,
    subject: "Restablecer contraseña - STApp",
    html: getBaseTemplate({
      preheader: `${nombre}, usa este enlace para restablecer tu contraseña`,
      headerGradient: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
      content,
      rootDomain,
      footerText: "Recibiste este correo porque alguien solicitó restablecer la contraseña de esta cuenta.",
    }),
  })
}

// ============================================
// RESPUESTA DE SOPORTE
// ============================================
interface SendSupportReplyEmailParams {
  email: string
  nombreUsuario: string
  asuntoTicket: string
  contenidoRespuesta: string
  ticketId: string
  slug: string
}

export async function sendSupportReplyEmail({
  email,
  nombreUsuario,
  asuntoTicket,
  contenidoRespuesta,
  ticketId,
  slug,
}: SendSupportReplyEmailParams) {
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "stapp.com.ar"
  const ticketUrl = `https://${slug}.${rootDomain}/soporte/${ticketId}`

  const escapedContent = contenidoRespuesta
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>")

  const content = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center" style="padding-bottom: 24px;">
          <table role="presentation" cellpadding="0" cellspacing="0">
            <tr>
              <td style="background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); width: 80px; height: 80px; border-radius: 50%; text-align: center; vertical-align: middle; font-size: 36px;">
                &#128172;
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td align="center">
          <h1 class="text-heading" style="color: #1f2937; font-size: 24px; font-weight: 700; margin: 0 0 8px 0;">
            Nueva respuesta en tu ticket
          </h1>
        </td>
      </tr>
    </table>

    <p class="text-body" style="color: #4b5563; font-size: 16px; text-align: center; margin: 16px 0 0 0;">
      Hola <strong>${nombreUsuario}</strong>,
    </p>

    <p class="text-body" style="color: #4b5563; font-size: 16px; text-align: center; margin: 8px 0 0 0;">
      El equipo de soporte respondió a tu ticket: <strong>${asuntoTicket}</strong>
    </p>

    ${getInfoCard(`
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td>
            <p class="text-muted" style="color: #6b7280; font-size: 12px; margin: 0 0 8px 0; text-transform: uppercase; letter-spacing: 1px;">
              Respuesta del soporte
            </p>
            <p class="text-body" style="color: #374151; font-size: 15px; margin: 0; line-height: 1.6;">
              ${escapedContent}
            </p>
          </td>
        </tr>
      </table>
    `)}

    ${getButton(ticketUrl, "Ver ticket completo")}

    ${getDivider()}

    <p class="text-muted" style="color: #9ca3af; font-size: 13px; text-align: center; margin: 0;">
      Puedes responder directamente desde la plataforma haciendo clic en el botón de arriba.
    </p>
  `

  return sendEmail({
    to: email,
    subject: `Respuesta a tu ticket: ${asuntoTicket} - STApp`,
    html: getBaseTemplate({
      preheader: `${nombreUsuario}, el equipo de soporte respondió a tu ticket`,
      headerGradient: "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
      content,
      rootDomain,
      footerText: "Recibiste este correo porque tienes un ticket de soporte abierto en STApp.",
    }),
  })
}

interface SendCotizacionEmailParams {
  email: string
  nombreCliente: string
  numeroCotizacion: string
  numeroOrden: number
  total: number
  // Llega como el string ISO de Postgres, no como Date; `formatDateValue`
  // acepta las dos formas desde siempre y el tipo se quedó atrás.
  fechaVencimiento?: Date | string | null
  pdfBuffer: Buffer
  moneda?: string
  zonaHoraria?: string
}

export async function sendCotizacionEmail({
  email,
  nombreCliente,
  numeroCotizacion,
  numeroOrden,
  total,
  fechaVencimiento,
  pdfBuffer,
  moneda,
  zonaHoraria,
}: SendCotizacionEmailParams) {
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "stapp.com.ar"
  const formatCurrency = (amount: number) =>
    formatCurrencyValue(amount, (moneda as CurrencyCode) || DEFAULT_CURRENCY)

  const vencimientoText = fechaVencimiento
    ? `📅 Válida hasta el <strong>${formatDateValue(fechaVencimiento, zonaHoraria)}</strong>`
    : "Sin fecha de vencimiento especificada"

  const content = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center" style="padding-bottom: 24px;">
          <table role="presentation" cellpadding="0" cellspacing="0">
            <tr>
              <td style="background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); width: 80px; height: 80px; border-radius: 50%; text-align: center; vertical-align: middle; font-size: 36px;">
                &#128196;
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td align="center">
          <h1 class="text-heading" style="color: #1f2937; font-size: 24px; font-weight: 700; margin: 0 0 8px 0;">
            Nueva Cotización
          </h1>
        </td>
      </tr>
    </table>

    <p class="text-body" style="color: #4b5563; font-size: 16px; text-align: center; margin: 16px 0 0 0;">
      Hola <strong>${nombreCliente}</strong>,
    </p>

    <p class="text-body" style="color: #4b5563; font-size: 16px; text-align: center; margin: 8px 0 0 0;">
      Le enviamos la cotización correspondiente a su orden de servicio.
    </p>

    ${getInfoCard(`
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td align="center" style="padding-bottom: 16px;">
            <p class="text-muted" style="color: #6b7280; font-size: 13px; margin: 0; text-transform: uppercase; letter-spacing: 1px;">
              Total de la cotización
            </p>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding-bottom: 16px;">
            <p class="text-heading" style="color: #1f2937; font-size: 36px; font-weight: 700; margin: 0;">
              ${formatCurrency(total)}
            </p>
          </td>
        </tr>
        <tr>
          <td align="center">
            <table role="presentation" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding: 8px 16px; background: #eff6ff; border-radius: 6px; margin-right: 8px;">
                  <p class="text-body" style="color: #1d4ed8; font-size: 13px; margin: 0;">
                    <strong>Cotización:</strong> ${numeroCotizacion}
                  </p>
                </td>
                <td style="width: 8px;"></td>
                <td style="padding: 8px 16px; background: #f3f4f6; border-radius: 6px;">
                  <p class="text-body" style="color: #4b5563; font-size: 13px; margin: 0;">
                    <strong>Orden:</strong> #${numeroOrden}
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    `, "#ffffff")}

    ${getInfoCard(`
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td align="center">
            <p class="text-muted" style="color: #6b7280; font-size: 14px; margin: 0;">
              ${vencimientoText}
            </p>
          </td>
        </tr>
      </table>
    `)}

    ${getDivider()}

    <p class="text-body" style="color: #4b5563; font-size: 15px; text-align: center; margin: 0;">
      📎 <strong>Adjuntamos el PDF</strong> con el detalle completo de la cotización.
    </p>

    <p class="text-body" style="color: #4b5563; font-size: 15px; text-align: center; margin: 12px 0 0 0;">
      Si desea aceptar esta cotización o tiene alguna consulta, por favor responda a este correo o contáctenos.
    </p>
  `

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
    html: getBaseTemplate({
      preheader: `${nombreCliente}, tu cotización ${numeroCotizacion} por ${formatCurrency(total)} está lista`,
      content,
      rootDomain,
      footerText: "Responde a este correo si deseas confirmar la cotización o tienes consultas.",
    }),
  })
}

// ============================================
// NOTIFICACIÓN DE NUEVO LEAD (Chatbot)
// ============================================
// ============================================
// EMAIL INDIVIDUAL DESDE ADMIN
// ============================================
interface SendAdminEmailParams {
  to: string
  nombreDestinatario: string
  asunto: string
  contenido: string
  nombreOrganizacion: string
}

export async function sendAdminEmail({
  to,
  nombreDestinatario,
  asunto,
  contenido,
  nombreOrganizacion,
}: SendAdminEmailParams) {
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "stapp.com.ar"

  const escapedContent = contenido
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>")

  const content = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center">
          <h1 class="text-heading" style="color: #1f2937; font-size: 24px; font-weight: 700; margin: 0 0 8px 0;">
            ${asunto}
          </h1>
        </td>
      </tr>
    </table>

    <p class="text-body" style="color: #4b5563; font-size: 16px; margin: 24px 0 0 0;">
      Hola <strong>${nombreDestinatario}</strong>,
    </p>

    <div class="text-body" style="color: #4b5563; font-size: 15px; line-height: 1.7; margin: 16px 0 0 0;">
      ${escapedContent}
    </div>

    ${getDivider()}

    <p class="text-muted" style="color: #9ca3af; font-size: 13px; text-align: center; margin: 0;">
      Este mensaje fue enviado por <strong>${nombreOrganizacion}</strong> a través de STApp.
    </p>
  `

  return sendEmail({
    to,
    subject: `${asunto} - ${nombreOrganizacion}`,
    html: getBaseTemplate({
      preheader: `${nombreDestinatario}, tienes un mensaje de ${nombreOrganizacion}`,
      content,
      rootDomain,
      footerText: `Este correo fue enviado por ${nombreOrganizacion} a través de STApp.`,
    }),
  })
}

// ============================================
// NOTIFICACIÓN DE NUEVO LEAD (Chatbot)
// ============================================
interface SendNewLeadNotificationParams {
  nombre?: string | null
  email?: string | null
  telefono?: string | null
  empresa?: string | null
  interes?: string | null
  origen: string
}

export async function sendNewLeadNotification({
  nombre,
  email,
  telefono,
  empresa,
  interes,
  origen,
}: SendNewLeadNotificationParams) {
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "stapp.com.ar"
  // Cae a la casilla real, no a EMAIL_FROM: esa es la direccion desde la
  // que se envia (noreply@), nadie lee lo que llega ahi.
  const adminEmail = process.env.LEAD_NOTIFICATION_EMAIL || CONTACT_EMAIL
  const leadsUrl = `https://${rootDomain}/leads`

  const contactDetails = [
    nombre ? `<strong>Nombre:</strong> ${nombre}` : null,
    email ? `<strong>Email:</strong> <a href="mailto:${email}" style="color: #3b82f6;">${email}</a>` : null,
    telefono ? `<strong>Teléfono:</strong> <a href="https://wa.me/${telefono.replace(/\D/g, "")}" style="color: #25D366;">${telefono}</a>` : null,
    empresa ? `<strong>Empresa:</strong> ${empresa}` : null,
    interes ? `<strong>Interés:</strong> ${interes}` : null,
  ]
    .filter(Boolean)
    .map((line) => `<p class="text-body" style="color: #4b5563; font-size: 15px; margin: 4px 0;">${line}</p>`)
    .join("")

  const content = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center" style="padding-bottom: 24px;">
          <table role="presentation" cellpadding="0" cellspacing="0">
            <tr>
              <td style="background: linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%); width: 80px; height: 80px; border-radius: 50%; text-align: center; vertical-align: middle; font-size: 36px;">
                &#127775;
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td align="center">
          <h1 class="text-heading" style="color: #1f2937; font-size: 24px; font-weight: 700; margin: 0 0 8px 0;">
            Nuevo lead desde ${origen}
          </h1>
        </td>
      </tr>
    </table>

    <p class="text-body" style="color: #4b5563; font-size: 16px; text-align: center; margin: 16px 0 0 0;">
      Un potencial cliente dejó sus datos de contacto.
    </p>

    ${getInfoCard(`
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td>
            <p class="text-muted" style="color: #6b7280; font-size: 12px; margin: 0 0 12px 0; text-transform: uppercase; letter-spacing: 1px;">
              Datos del lead
            </p>
            ${contactDetails}
          </td>
        </tr>
      </table>
    `)}

    ${getButton(leadsUrl, "Ver lead en el dashboard", "#22c55e")}

    ${getDivider()}

    <p class="text-muted" style="color: #9ca3af; font-size: 13px; text-align: center; margin: 0;">
      Respondé lo antes posible para no perder este potencial cliente.
    </p>
  `

  return sendEmail({
    to: adminEmail,
    subject: `Nuevo lead: ${nombre || email || telefono || "Sin identificar"} - STApp`,
    html: getBaseTemplate({
      preheader: `Nuevo lead desde ${origen}: ${nombre || email || telefono || "contacto pendiente"}`,
      headerGradient: "linear-gradient(135deg, #22c55e 0%, #16a34a 100%)",
      content,
      rootDomain,
      footerText: "Recibiste este correo porque un potencial cliente dejó sus datos en STApp.",
    }),
  })
}

// ============================================
// ALERTA DIARIA - DIGEST
// ============================================
interface AlertDigestParams {
  to: string
  nombre: string
  organizationName: string
  slug: string
  alertas: Array<{
    tipo: string
    titulo: string
    detalle: string
    cantidad: number
    icono: string
  }>
  moneda: string
}

export async function sendAlertDigestEmail({
  to,
  nombre,
  organizationName,
  slug,
  alertas,
  moneda,
}: AlertDigestParams) {
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "stapp.com.ar"
  const dashboardUrl = `https://${slug}.${rootDomain}/dashboard`

  const iconColors: Record<string, string> = {
    INVENTARIO_BAJO: "#ef4444",
    FECHA_VENCIDA: "#f59e0b",
    DEUDA_PENDIENTE: "#f97316",
  }

  const iconEmojis: Record<string, string> = {
    INVENTARIO_BAJO: "📦",
    FECHA_VENCIDA: "⏰",
    DEUDA_PENDIENTE: "💰",
  }

  const alertCards = alertas.map((alerta) => {
    const color = iconColors[alerta.tipo] || "#6b7280"
    const emoji = iconEmojis[alerta.tipo] || "🔔"
    return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 12px;">
        <tr>
          <td style="background-color: ${color}10; padding: 16px 20px; border-radius: 10px; border-left: 4px solid ${color};">
            <p style="margin: 0 0 4px 0; font-size: 15px; font-weight: 600; color: #1f2937;">
              ${emoji} ${alerta.titulo}
            </p>
            <p class="text-muted" style="margin: 0; font-size: 13px; color: #6b7280;">
              ${alerta.detalle}
            </p>
          </td>
        </tr>
      </table>
    `
  }).join("")

  const content = `
    <h1 class="text-heading" style="color: #1f2937; font-size: 22px; font-weight: 700; margin: 0 0 8px 0;">
      Resumen de alertas
    </h1>
    <p class="text-body" style="color: #4b5563; font-size: 15px; margin: 0 0 24px 0;">
      Hola ${nombre}, estas son las alertas pendientes en <strong>${organizationName}</strong>:
    </p>

    ${alertCards}

    ${getButton(dashboardUrl, "Ver dashboard", "#3b82f6")}

    ${getDivider()}

    <p class="text-muted" style="color: #9ca3af; font-size: 13px; text-align: center; margin: 0;">
      Revisá estas alertas para mantener tu taller al día.
    </p>
  `

  return sendEmail({
    to,
    subject: `${alertas.length} alerta${alertas.length > 1 ? "s" : ""} en ${organizationName} - STApp`,
    html: getBaseTemplate({
      preheader: alertas.map((a) => a.titulo).join(" | "),
      headerGradient: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
      content,
      rootDomain,
      footerText: "Recibís este resumen diario porque sos administrador del taller.",
    }),
  })
}
