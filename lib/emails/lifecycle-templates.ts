/**
 * Templates de emails de lifecycle para retención de usuarios de STApp
 */

const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "stapp.com.ar"

// ============================================
// ESTILOS BASE (reusar del sistema de emails existente)
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

const baseTemplate = (options: {
  preheader: string
  headerGradient?: string
  content: string
  footerText?: string
}) => {
  const {
    preheader,
    headerGradient = "linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)",
    content,
    footerText = "Este correo fue enviado automáticamente por STApp.",
  } = options

  return `
    <!DOCTYPE html>
    <html lang="es">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta name="color-scheme" content="light dark">
        <title>STApp</title>
        ${getEmailStyles()}
      </head>
      <body class="email-body" style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; background-color: #f3f4f6;">
        <div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">
          ${preheader}${"&nbsp;".repeat(100)}
        </div>
        <table class="email-container" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f3f4f6;">
          <tr>
            <td align="center" style="padding: 40px 20px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px;">
                <tr>
                  <td style="background: ${headerGradient}; padding: 32px 40px; text-align: center; border-radius: 16px 16px 0 0;">
                    <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 0 auto;">
                      <tr>
                        <td style="vertical-align: middle; padding-right: 10px;">
                          <img src="https://${ROOT_DOMAIN}/icon-192.png" alt="" style="height: 36px; width: 36px; border-radius: 8px;" />
                        </td>
                        <td style="vertical-align: middle;">
                          <span style="color: #ffffff; font-size: 24px; font-weight: 700; letter-spacing: -0.5px;">STApp</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td class="email-content" style="background-color: #ffffff; padding: 40px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 16px 16px;">
                    ${content}
                  </td>
                </tr>
                <tr>
                  <td class="footer-section" style="padding: 24px 40px; text-align: center;">
                    <p class="text-muted" style="color: #9ca3af; font-size: 13px; margin: 0 0 12px 0;">
                      ${footerText}
                    </p>
                    <p class="text-muted" style="color: #9ca3af; font-size: 12px; margin: 0;">
                      <a href="https://${ROOT_DOMAIN}" style="color: #3b82f6; text-decoration: none;">STApp</a>
                      &nbsp;&bull;&nbsp;
                      <a href="https://${ROOT_DOMAIN}/ayuda" style="color: #3b82f6; text-decoration: none;">Centro de ayuda</a>
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

const button = (href: string, text: string, color = "#3b82f6") => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td align="center" style="padding: 32px 0;">
        <a href="${href}" style="background: ${color}; color: #ffffff; padding: 16px 32px; text-decoration: none; border-radius: 10px; font-weight: 600; font-size: 16px; display: inline-block; box-shadow: 0 4px 14px 0 rgba(59, 130, 246, 0.3);">
          ${text}
        </a>
      </td>
    </tr>
  </table>
`

const tipCard = (emoji: string, title: string, description: string) => `
  <table class="email-card" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 16px 0;">
    <tr>
      <td style="background-color: #f9fafb; padding: 20px; border-radius: 12px; border: 1px solid #e5e7eb;">
        <table role="presentation" cellpadding="0" cellspacing="0">
          <tr>
            <td style="vertical-align: top; padding-right: 12px; font-size: 24px;">${emoji}</td>
            <td>
              <p class="text-heading" style="color: #1f2937; font-size: 15px; font-weight: 600; margin: 0 0 4px 0;">${title}</p>
              <p class="text-body" style="color: #6b7280; font-size: 14px; margin: 0;">${description}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
`

// ============================================
// TIPO DE EMAIL
// ============================================
export type LifecycleEmailType =
  | "WELCOME"
  | "TIP_DAY_3"
  | "TIP_DAY_7"
  | "TRIAL_EXPIRING_5"
  | "TRIAL_EXPIRING_1"
  | "TRIAL_EXPIRED"
  | "WIN_BACK_7"
  | "WIN_BACK_30"
  | "MILESTONE"

// ============================================
// TEMPLATES
// ============================================

interface LifecycleEmailData {
  nombre: string
  organizacion: string
  slug: string
  diasRestantes?: number
  milestone?: { tipo: string; valor: number }
}

export function getLifecycleEmail(type: LifecycleEmailType, data: LifecycleEmailData): { subject: string; html: string } {
  const appUrl = `https://${data.slug}.${ROOT_DOMAIN}`

  switch (type) {
    case "WELCOME":
      return {
        subject: "Bienvenido a STApp - Tu servicio tecnico en la nube",
        html: baseTemplate({
          preheader: `${data.nombre}, tu cuenta esta lista. Empeza a gestionar tu negocio.`,
          headerGradient: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
          content: `
            <h1 class="text-heading" style="color: #1f2937; font-size: 24px; font-weight: 700; text-align: center; margin: 0 0 16px 0;">
              Bienvenido a STApp
            </h1>
            <p class="text-body" style="color: #4b5563; font-size: 16px; text-align: center; margin: 0 0 8px 0;">
              Hola <strong>${data.nombre}</strong>,
            </p>
            <p class="text-body" style="color: #4b5563; font-size: 16px; text-align: center; margin: 0 0 24px 0;">
              Tu organizacion <strong>${data.organizacion}</strong> ya esta lista. Tenes <strong>30 dias gratis</strong> para probar todas las funcionalidades.
            </p>

            <p class="text-heading" style="color: #1f2937; font-size: 16px; font-weight: 600; margin: 0 0 12px 0;">
              Primeros pasos recomendados:
            </p>

            ${tipCard("👥", "Carga tus primeros clientes", "Agrega los datos de tus clientes para asociarlos a las ordenes de servicio.")}
            ${tipCard("📱", "Crea tu primera orden", "Registra un equipo y segui todo el proceso de reparacion.")}
            ${tipCard("📦", "Arma tu inventario", "Carga los repuestos que usas para tener control de stock.")}

            ${button(appUrl, "Ir a mi panel")}
          `,
        }),
      }

    case "TIP_DAY_3":
      return {
        subject: "Tip: Envia presupuestos por WhatsApp a tus clientes",
        html: baseTemplate({
          preheader: "Sabia que podes enviar presupuestos directamente por WhatsApp?",
          content: `
            <h1 class="text-heading" style="color: #1f2937; font-size: 24px; font-weight: 700; text-align: center; margin: 0 0 16px 0;">
              Tips para sacarle mas jugo a STApp
            </h1>
            <p class="text-body" style="color: #4b5563; font-size: 16px; text-align: center; margin: 0 0 24px 0;">
              Hola <strong>${data.nombre}</strong>, llevas unos dias usando STApp. Aca van algunos tips:
            </p>

            ${tipCard("💬", "Notificaciones por WhatsApp", "Tus clientes reciben actualizaciones automaticas del estado de su equipo. Activalas desde Configuracion.")}
            ${tipCard("📄", "Cotizaciones con firma digital", "Genera presupuestos profesionales que tu cliente puede aprobar con firma digital desde su celular.")}
            ${tipCard("📊", "Seguimiento publico", "Cada orden tiene un link publico que podes compartir para que tu cliente vea el estado en tiempo real.")}

            ${button(appUrl + "/configuracion", "Ir a Configuracion")}
          `,
        }),
      }

    case "TIP_DAY_7":
      return {
        subject: "Tip: Controla tu inventario y nunca te quedes sin repuestos",
        html: baseTemplate({
          preheader: "Gestion de inventario, ventas y mas en STApp",
          content: `
            <h1 class="text-heading" style="color: #1f2937; font-size: 24px; font-weight: 700; text-align: center; margin: 0 0 16px 0;">
              Ya llevas una semana con STApp
            </h1>
            <p class="text-body" style="color: #4b5563; font-size: 16px; text-align: center; margin: 0 0 24px 0;">
              Hola <strong>${data.nombre}</strong>, esperamos que estes aprovechando la plataforma. Estos features te van a encantar:
            </p>

            ${tipCard("📦", "Gestion de inventario", "Controla stock, precios y proveedores. Asocia repuestos a cada orden automaticamente.")}
            ${tipCard("🛒", "Modulo de ventas", "Vende accesorios y repuestos por mostrador con facturacion integrada.")}
            ${tipCard("🔧", "Garantias automaticas", "Cada reparacion genera una garantia con certificado digital para tu cliente.")}
            ${tipCard("📈", "Reportes y metricas", "Analiza tu negocio: ordenes por mes, ingresos, tecnicos mas productivos y mas.")}

            ${button(appUrl, "Explorar mas funciones")}
          `,
        }),
      }

    case "TRIAL_EXPIRING_5":
      return {
        subject: "Tu prueba gratuita vence en 5 dias",
        html: baseTemplate({
          preheader: `${data.nombre}, te quedan 5 dias de prueba. No pierdas tu progreso.`,
          headerGradient: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
          content: `
            <h1 class="text-heading" style="color: #1f2937; font-size: 24px; font-weight: 700; text-align: center; margin: 0 0 16px 0;">
              Tu prueba vence en 5 dias
            </h1>
            <p class="text-body" style="color: #4b5563; font-size: 16px; text-align: center; margin: 0 0 24px 0;">
              Hola <strong>${data.nombre}</strong>, tu periodo de prueba en <strong>${data.organizacion}</strong> esta por terminar.
            </p>

            <table class="email-card" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 24px 0;">
              <tr>
                <td style="background-color: #fef3c7; padding: 24px; border-radius: 12px; border: 1px solid #fde68a; text-align: center;">
                  <p style="color: #92400e; font-size: 14px; margin: 0 0 8px 0; font-weight: 600;">Dias restantes</p>
                  <p style="color: #92400e; font-size: 48px; font-weight: 700; margin: 0;">5</p>
                </td>
              </tr>
            </table>

            <p class="text-body" style="color: #4b5563; font-size: 15px; text-align: center; margin: 0 0 8px 0;">
              Suscribite al plan Premium para mantener acceso a:
            </p>

            ${tipCard("♾️", "Ordenes ilimitadas", "Sin limite mensual de ordenes de servicio.")}
            ${tipCard("👥", "Tecnicos y vendedores ilimitados", "Agrega todo tu equipo sin restricciones.")}
            ${tipCard("💬", "Notificaciones WhatsApp", "Comunicacion automatica con tus clientes.")}

            ${button(appUrl + "/suscripcion", "Ver planes y precios", "#f59e0b")}
          `,
        }),
      }

    case "TRIAL_EXPIRING_1":
      return {
        subject: "Ultimo dia de prueba gratuita - No pierdas tu progreso",
        html: baseTemplate({
          preheader: `${data.nombre}, manana vence tu prueba. Suscribite hoy.`,
          headerGradient: "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)",
          content: `
            <h1 class="text-heading" style="color: #1f2937; font-size: 24px; font-weight: 700; text-align: center; margin: 0 0 16px 0;">
              Tu prueba vence manana
            </h1>
            <p class="text-body" style="color: #4b5563; font-size: 16px; text-align: center; margin: 0 0 24px 0;">
              Hola <strong>${data.nombre}</strong>, este es tu ultimo dia de prueba gratuita.
            </p>

            <table class="email-card" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 24px 0;">
              <tr>
                <td style="background-color: #fef2f2; padding: 24px; border-radius: 12px; border: 1px solid #fecaca; text-align: center;">
                  <p style="color: #991b1b; font-size: 16px; margin: 0; font-weight: 600;">
                    Si no te suscribis, perderas acceso a tu cuenta manana.
                  </p>
                </td>
              </tr>
            </table>

            <p class="text-body" style="color: #4b5563; font-size: 15px; text-align: center; margin: 0 0 8px 0;">
              Todos tus datos se conservan. Solo necesitas activar tu plan para seguir usandolos.
            </p>

            ${button(appUrl + "/suscripcion", "Suscribirme ahora", "#ef4444")}

            <p class="text-muted" style="color: #9ca3af; font-size: 13px; text-align: center; margin: 24px 0 0 0;">
              Necesitas ayuda? Responde a este correo y te ayudamos.
            </p>
          `,
        }),
      }

    case "TRIAL_EXPIRED":
      return {
        subject: "Tu prueba expiro - Tus datos siguen esperandote",
        html: baseTemplate({
          preheader: `${data.nombre}, tu prueba termino pero tus datos estan seguros. Suscribite para volver.`,
          headerGradient: "linear-gradient(135deg, #6b7280 0%, #4b5563 100%)",
          content: `
            <h1 class="text-heading" style="color: #1f2937; font-size: 24px; font-weight: 700; text-align: center; margin: 0 0 16px 0;">
              Tu periodo de prueba termino
            </h1>
            <p class="text-body" style="color: #4b5563; font-size: 16px; text-align: center; margin: 0 0 24px 0;">
              Hola <strong>${data.nombre}</strong>, tu prueba gratuita en <strong>${data.organizacion}</strong> expiro.
            </p>

            <table class="email-card" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 24px 0;">
              <tr>
                <td style="background-color: #f0fdf4; padding: 24px; border-radius: 12px; border: 1px solid #bbf7d0; text-align: center;">
                  <p style="color: #166534; font-size: 15px; margin: 0;">
                    Tus datos estan seguros y te esperan. Suscribite cuando quieras para retomar donde dejaste.
                  </p>
                </td>
              </tr>
            </table>

            ${button(appUrl + "/suscripcion", "Activar mi cuenta")}
          `,
        }),
      }

    case "WIN_BACK_7":
      return {
        subject: "Te extranamos - Tu negocio te necesita organizado",
        html: baseTemplate({
          preheader: `${data.nombre}, hace una semana que no entras. Tu negocio te necesita.`,
          headerGradient: "linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)",
          content: `
            <h1 class="text-heading" style="color: #1f2937; font-size: 24px; font-weight: 700; text-align: center; margin: 0 0 16px 0;">
              Te extranamos en STApp
            </h1>
            <p class="text-body" style="color: #4b5563; font-size: 16px; text-align: center; margin: 0 0 24px 0;">
              Hola <strong>${data.nombre}</strong>, hace un tiempo que no te vemos por aca.
            </p>
            <p class="text-body" style="color: #4b5563; font-size: 15px; text-align: center; margin: 0 0 24px 0;">
              Mientras no estabas, seguimos mejorando STApp. Algunas novedades te pueden interesar.
            </p>

            ${button(appUrl, "Volver a STApp", "#8b5cf6")}

            <p class="text-muted" style="color: #9ca3af; font-size: 13px; text-align: center; margin: 24px 0 0 0;">
              Si ya no queres recibir estos emails, simplemente ignoralo.
            </p>
          `,
        }),
      }

    case "WIN_BACK_30":
      return {
        subject: "Hace un mes que no te vemos - Volvemos?",
        html: baseTemplate({
          preheader: `${data.nombre}, hace un mes sin STApp. Tu cuenta sigue activa.`,
          headerGradient: "linear-gradient(135deg, #ec4899 0%, #db2777 100%)",
          content: `
            <h1 class="text-heading" style="color: #1f2937; font-size: 24px; font-weight: 700; text-align: center; margin: 0 0 16px 0;">
              Tu cuenta sigue activa
            </h1>
            <p class="text-body" style="color: #4b5563; font-size: 16px; text-align: center; margin: 0 0 24px 0;">
              Hola <strong>${data.nombre}</strong>, hace un mes que no entras a <strong>${data.organizacion}</strong>.
            </p>
            <p class="text-body" style="color: #4b5563; font-size: 15px; text-align: center; margin: 0 0 8px 0;">
              Tus datos, clientes y ordenes siguen ahi, esperandote.
            </p>
            <p class="text-body" style="color: #4b5563; font-size: 15px; text-align: center; margin: 0 0 24px 0;">
              Si necesitas ayuda o tenes alguna sugerencia, estamos para escucharte.
            </p>

            ${button(appUrl, "Volver a mi cuenta", "#ec4899")}

            <p class="text-muted" style="color: #9ca3af; font-size: 13px; text-align: center; margin: 24px 0 0 0;">
              Responde a este correo si necesitas ayuda con algo.
            </p>
          `,
        }),
      }

    case "MILESTONE":
      return {
        subject: getMilestoneSubject(data.milestone!),
        html: baseTemplate({
          preheader: getMilestonePreheader(data.nombre, data.milestone!),
          headerGradient: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
          content: `
            <h1 class="text-heading" style="color: #1f2937; font-size: 24px; font-weight: 700; text-align: center; margin: 0 0 16px 0;">
              ${getMilestoneTitle(data.milestone!)}
            </h1>
            <p class="text-body" style="color: #4b5563; font-size: 16px; text-align: center; margin: 0 0 24px 0;">
              Hola <strong>${data.nombre}</strong>, felicitaciones!
            </p>

            <table class="email-card" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 24px 0;">
              <tr>
                <td style="background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%); padding: 32px; border-radius: 12px; border: 1px solid #a7f3d0; text-align: center;">
                  <p style="font-size: 48px; margin: 0 0 8px 0;">🎉</p>
                  <p style="color: #065f46; font-size: 18px; font-weight: 700; margin: 0;">
                    ${getMilestoneMessage(data.organizacion, data.milestone!)}
                  </p>
                </td>
              </tr>
            </table>

            <p class="text-body" style="color: #4b5563; font-size: 15px; text-align: center; margin: 0 0 24px 0;">
              Segui asi! STApp te acompana en el crecimiento de tu negocio.
            </p>

            ${button(appUrl, "Seguir trabajando")}
          `,
        }),
      }
  }
}

function getMilestoneSubject(milestone: { tipo: string; valor: number }): string {
  switch (milestone.tipo) {
    case "ordenes": return `Felicitaciones! Llegaste a ${milestone.valor} ordenes`
    case "clientes": return `Felicitaciones! Ya tenes ${milestone.valor} clientes`
    case "ventas": return `Felicitaciones! ${milestone.valor} ventas realizadas`
    default: return "Un nuevo hito en tu negocio!"
  }
}

function getMilestonePreheader(nombre: string, milestone: { tipo: string; valor: number }): string {
  return `${nombre}, alcanzaste un nuevo hito: ${milestone.valor} ${milestone.tipo}!`
}

function getMilestoneTitle(milestone: { tipo: string; valor: number }): string {
  return `Nuevo hito: ${milestone.valor} ${milestone.tipo}!`
}

function getMilestoneMessage(org: string, milestone: { tipo: string; valor: number }): string {
  switch (milestone.tipo) {
    case "ordenes": return `${org} ya proceso ${milestone.valor} ordenes de servicio`
    case "clientes": return `${org} ya tiene ${milestone.valor} clientes registrados`
    case "ventas": return `${org} ya realizo ${milestone.valor} ventas`
    default: return `${org} alcanzo un nuevo hito!`
  }
}
