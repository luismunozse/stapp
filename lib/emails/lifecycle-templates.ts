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
  | "TIP_DAY_14"
  | "TRIAL_EXPIRING_5"
  | "TRIAL_EXPIRING_1"
  | "TRIAL_EXPIRED"
  | "TRIAL_AUTO_EXTENDED"
  | "TRIAL_LAST_CHANCE"
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
        subject: "Bienvenido a STApp - Tu servicio técnico en la nube",
        html: baseTemplate({
          preheader: `${data.nombre}, tu cuenta está lista. Empezá a gestionar tu taller.`,
          headerGradient: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
          content: `
            <h1 class="text-heading" style="color: #1f2937; font-size: 24px; font-weight: 700; text-align: center; margin: 0 0 16px 0;">
              Bienvenido a STApp
            </h1>
            <p class="text-body" style="color: #4b5563; font-size: 16px; text-align: center; margin: 0 0 8px 0;">
              Hola <strong>${data.nombre}</strong>,
            </p>
            <p class="text-body" style="color: #4b5563; font-size: 16px; text-align: center; margin: 0 0 24px 0;">
              Tu taller <strong>${data.organizacion}</strong> ya está listo. Tenés <strong>30 días gratis</strong> para probar todas las funcionalidades.
            </p>

            <p class="text-heading" style="color: #1f2937; font-size: 16px; font-weight: 600; margin: 0 0 12px 0;">
              Primeros pasos recomendados:
            </p>

            ${tipCard("👥", "Cargá tus primeros clientes", "Agregá los datos de tus clientes para asociarlos a las órdenes de servicio.")}
            ${tipCard("📱", "Creá tu primera orden", "Registrá un equipo y seguí todo el proceso de reparación.")}
            ${tipCard("📦", "Armá tu inventario", "Cargá los repuestos que usás para tener control de stock.")}

            ${button(appUrl, "Ir a mi panel")}
          `,
        }),
      }

    case "TIP_DAY_3":
      return {
        subject: "Tip: Enviá presupuestos por WhatsApp a tus clientes",
        html: baseTemplate({
          preheader: "¿Sabías que podés enviar presupuestos directamente por WhatsApp?",
          content: `
            <h1 class="text-heading" style="color: #1f2937; font-size: 24px; font-weight: 700; text-align: center; margin: 0 0 16px 0;">
              Tips para sacarle más jugo a STApp
            </h1>
            <p class="text-body" style="color: #4b5563; font-size: 16px; text-align: center; margin: 0 0 24px 0;">
              Hola <strong>${data.nombre}</strong>, llevás unos días usando STApp. Acá van algunos tips:
            </p>

            ${tipCard("💬", "Notificaciones por WhatsApp", "Tus clientes reciben actualizaciones automáticas del estado de su equipo. Activalas desde Configuración.")}
            ${tipCard("📄", "Cotizaciones con firma digital", "Generá presupuestos profesionales que tu cliente puede aprobar con firma digital desde su celular.")}
            ${tipCard("📊", "Seguimiento público", "Cada orden tiene un link público que podés compartir para que tu cliente vea el estado en tiempo real.")}

            ${button(appUrl + "/configuracion", "Ir a Configuración")}
          `,
        }),
      }

    case "TIP_DAY_7":
      return {
        subject: "Tip: Controlá tu inventario y nunca te quedes sin repuestos",
        html: baseTemplate({
          preheader: "Gestión de inventario, ventas y más en STApp",
          content: `
            <h1 class="text-heading" style="color: #1f2937; font-size: 24px; font-weight: 700; text-align: center; margin: 0 0 16px 0;">
              Ya llevás una semana con STApp
            </h1>
            <p class="text-body" style="color: #4b5563; font-size: 16px; text-align: center; margin: 0 0 24px 0;">
              Hola <strong>${data.nombre}</strong>, esperamos que estés aprovechando la plataforma. Estas funciones te van a encantar:
            </p>

            ${tipCard("📦", "Gestión de inventario", "Controlá stock, precios y proveedores. Asociá repuestos a cada orden automáticamente.")}
            ${tipCard("🛒", "Módulo de ventas", "Vendé accesorios y repuestos por mostrador con facturación integrada.")}
            ${tipCard("🔧", "Garantías automáticas", "Cada reparación genera una garantía con certificado digital para tu cliente.")}
            ${tipCard("📈", "Reportes y métricas", "Analizá tu taller: órdenes por mes, ingresos, técnicos más productivos y más.")}

            ${button(appUrl, "Explorar más funciones")}
          `,
        }),
      }

    case "TIP_DAY_14":
      return {
        subject: "¿Ya exploraste todo lo que STApp puede hacer por tu taller?",
        html: baseTemplate({
          preheader: `${data.nombre}, hay funcionalidades que quizás todavía no probaste`,
          content: `
            <h1 class="text-heading" style="color: #1f2937; font-size: 24px; font-weight: 700; text-align: center; margin: 0 0 16px 0;">
              Llevás 2 semanas con STApp
            </h1>
            <p class="text-body" style="color: #4b5563; font-size: 16px; text-align: center; margin: 0 0 24px 0;">
              Hola <strong>${data.nombre}</strong>, ¿estás aprovechando al máximo tu período de prueba? Estas funcionalidades pueden hacer la diferencia en tu día a día:
            </p>

            ${tipCard("💰", "Cotizaciones con aprobación online", "Enviá presupuestos profesionales que tu cliente aprueba o rechaza con firma digital desde su celular, sin crear cuenta.")}
            ${tipCard("📊", "17 reportes avanzados", "Analizá ingresos, rendimiento de técnicos, fallas comunes, rentabilidad y más. Exportá todo a Excel.")}
            ${tipCard("💬", "Notificaciones por WhatsApp", "Avisale a tu cliente automáticamente cuando su equipo está listo para retirar o cuando hay un presupuesto nuevo.")}
            ${tipCard("🖥️", "Modo Kiosco", "Mostrá en una pantalla del local el estado de las reparaciones para que tus clientes no pregunten.")}

            <p class="text-body" style="color: #4b5563; font-size: 15px; text-align: center; margin: 0 0 8px 0;">
              Todavía tenés tiempo de probar todo gratis. ¡No te lo pierdas!
            </p>

            ${button(appUrl, "Explorar funcionalidades")}
          `,
        }),
      }

    case "TRIAL_EXPIRING_5":
      return {
        subject: "Tu prueba gratuita vence en 5 días",
        html: baseTemplate({
          preheader: `${data.nombre}, te quedan 5 días de prueba. No pierdas tu progreso.`,
          headerGradient: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
          content: `
            <h1 class="text-heading" style="color: #1f2937; font-size: 24px; font-weight: 700; text-align: center; margin: 0 0 16px 0;">
              Tu prueba vence en 5 días
            </h1>
            <p class="text-body" style="color: #4b5563; font-size: 16px; text-align: center; margin: 0 0 24px 0;">
              Hola <strong>${data.nombre}</strong>, tu período de prueba en <strong>${data.organizacion}</strong> está por terminar.
            </p>

            <table class="email-card" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 24px 0;">
              <tr>
                <td style="background-color: #fef3c7; padding: 24px; border-radius: 12px; border: 1px solid #fde68a; text-align: center;">
                  <p style="color: #92400e; font-size: 14px; margin: 0 0 8px 0; font-weight: 600;">Días restantes</p>
                  <p style="color: #92400e; font-size: 48px; font-weight: 700; margin: 0;">5</p>
                </td>
              </tr>
            </table>

            <p class="text-body" style="color: #4b5563; font-size: 15px; text-align: center; margin: 0 0 8px 0;">
              Suscribite al plan Premium para mantener acceso a:
            </p>

            ${tipCard("♾️", "Órdenes ilimitadas", "Sin límite mensual de órdenes de servicio.")}
            ${tipCard("👥", "Técnicos y vendedores ilimitados", "Agregá todo tu equipo sin restricciones.")}
            ${tipCard("💬", "Notificaciones WhatsApp", "Comunicación automática con tus clientes.")}

            ${button(appUrl + "/suscripcion-requerida", "Ver planes y precios", "#f59e0b")}
          `,
        }),
      }

    case "TRIAL_EXPIRING_1":
      return {
        subject: "Último día de prueba gratuita - No pierdas tu progreso",
        html: baseTemplate({
          preheader: `${data.nombre}, mañana vence tu prueba. Suscribite hoy.`,
          headerGradient: "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)",
          content: `
            <h1 class="text-heading" style="color: #1f2937; font-size: 24px; font-weight: 700; text-align: center; margin: 0 0 16px 0;">
              Tu prueba vence mañana
            </h1>
            <p class="text-body" style="color: #4b5563; font-size: 16px; text-align: center; margin: 0 0 24px 0;">
              Hola <strong>${data.nombre}</strong>, este es tu último día de prueba gratuita.
            </p>

            <table class="email-card" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 24px 0;">
              <tr>
                <td style="background-color: #fef2f2; padding: 24px; border-radius: 12px; border: 1px solid #fecaca; text-align: center;">
                  <p style="color: #991b1b; font-size: 16px; margin: 0; font-weight: 600;">
                    Si no te suscribís, perderás acceso a tu cuenta mañana.
                  </p>
                </td>
              </tr>
            </table>

            <p class="text-body" style="color: #4b5563; font-size: 15px; text-align: center; margin: 0 0 8px 0;">
              Todos tus datos se conservan. Solo necesitás activar tu plan para seguir usándolos.
            </p>

            ${button(appUrl + "/suscripcion-requerida", "Suscribirme ahora", "#ef4444")}

            <p class="text-muted" style="color: #9ca3af; font-size: 13px; text-align: center; margin: 24px 0 0 0;">
              ¿Necesitás ayuda? Respondé a este correo y te ayudamos.
            </p>
          `,
        }),
      }

    case "TRIAL_EXPIRED":
      return {
        subject: "Tu prueba expiró - Tus datos siguen esperándote",
        html: baseTemplate({
          preheader: `${data.nombre}, tu prueba terminó pero tus datos están seguros. Suscribite para volver.`,
          headerGradient: "linear-gradient(135deg, #6b7280 0%, #4b5563 100%)",
          content: `
            <h1 class="text-heading" style="color: #1f2937; font-size: 24px; font-weight: 700; text-align: center; margin: 0 0 16px 0;">
              Tu período de prueba terminó
            </h1>
            <p class="text-body" style="color: #4b5563; font-size: 16px; text-align: center; margin: 0 0 24px 0;">
              Hola <strong>${data.nombre}</strong>, tu prueba gratuita en <strong>${data.organizacion}</strong> expiró.
            </p>

            <table class="email-card" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 24px 0;">
              <tr>
                <td style="background-color: #f0fdf4; padding: 24px; border-radius: 12px; border: 1px solid #bbf7d0; text-align: center;">
                  <p style="color: #166534; font-size: 15px; margin: 0;">
                    Tus datos están seguros y te esperan. Suscribite cuando quieras para retomar donde dejaste.
                  </p>
                </td>
              </tr>
            </table>

            ${button(appUrl + "/suscripcion-requerida", "Activar mi cuenta")}
          `,
        }),
      }

    case "WIN_BACK_7":
      return {
        subject: "Te extrañamos - Tu taller te necesita organizado",
        html: baseTemplate({
          preheader: `${data.nombre}, hace una semana que no entrás. Tu taller te necesita.`,
          headerGradient: "linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)",
          content: `
            <h1 class="text-heading" style="color: #1f2937; font-size: 24px; font-weight: 700; text-align: center; margin: 0 0 16px 0;">
              Te extrañamos en STApp
            </h1>
            <p class="text-body" style="color: #4b5563; font-size: 16px; text-align: center; margin: 0 0 24px 0;">
              Hola <strong>${data.nombre}</strong>, hace un tiempo que no te vemos por acá.
            </p>
            <p class="text-body" style="color: #4b5563; font-size: 15px; text-align: center; margin: 0 0 24px 0;">
              Mientras no estabas, seguimos mejorando STApp. Algunas novedades te pueden interesar.
            </p>

            ${button(appUrl, "Volver a STApp", "#8b5cf6")}

            <p class="text-muted" style="color: #9ca3af; font-size: 13px; text-align: center; margin: 24px 0 0 0;">
              Si ya no querés recibir estos emails, simplemente ignoralo.
            </p>
          `,
        }),
      }

    case "WIN_BACK_30":
      return {
        subject: "Hace un mes que no te vemos - ¿Volvemos?",
        html: baseTemplate({
          preheader: `${data.nombre}, hace un mes sin STApp. Tu cuenta sigue activa.`,
          headerGradient: "linear-gradient(135deg, #ec4899 0%, #db2777 100%)",
          content: `
            <h1 class="text-heading" style="color: #1f2937; font-size: 24px; font-weight: 700; text-align: center; margin: 0 0 16px 0;">
              Tu cuenta sigue activa
            </h1>
            <p class="text-body" style="color: #4b5563; font-size: 16px; text-align: center; margin: 0 0 24px 0;">
              Hola <strong>${data.nombre}</strong>, hace un mes que no entrás a <strong>${data.organizacion}</strong>.
            </p>
            <p class="text-body" style="color: #4b5563; font-size: 15px; text-align: center; margin: 0 0 8px 0;">
              Tus datos, clientes y órdenes siguen ahí, esperándote.
            </p>
            <p class="text-body" style="color: #4b5563; font-size: 15px; text-align: center; margin: 0 0 24px 0;">
              Si necesitás ayuda o tenés alguna sugerencia, estamos para escucharte.
            </p>

            ${button(appUrl, "Volver a mi cuenta", "#ec4899")}

            <p class="text-muted" style="color: #9ca3af; font-size: 13px; text-align: center; margin: 24px 0 0 0;">
              Respondé a este correo si necesitás ayuda con algo.
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
              Hola <strong>${data.nombre}</strong>, ¡felicitaciones!
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
              ¡Seguí así! STApp te acompaña en el crecimiento de tu taller.
            </p>

            ${button(appUrl, "Seguir trabajando")}
          `,
        }),
      }

    default:
      return {
        subject: "Novedades de STApp",
        html: baseTemplate({
          preheader: `${data.nombre}, tenés novedades en STApp`,
          content: `
            <h1 class="text-heading" style="color: #1f2937; font-size: 24px; font-weight: 700; text-align: center; margin: 0 0 16px 0;">
              Novedades en STApp
            </h1>
            <p class="text-body" style="color: #4b5563; font-size: 16px; text-align: center; margin: 0 0 24px 0;">
              Hola <strong>${data.nombre}</strong>, entrá a tu cuenta para ver las novedades.
            </p>
            ${button(appUrl, "Ir a STApp")}
          `,
        }),
      }
  }
}

function getMilestoneSubject(milestone: { tipo: string; valor: number }): string {
  switch (milestone.tipo) {
    case "ordenes": return `¡Felicitaciones! Llegaste a ${milestone.valor} órdenes`
    case "clientes": return `¡Felicitaciones! Ya tenés ${milestone.valor} clientes`
    case "ventas": return `¡Felicitaciones! ${milestone.valor} ventas realizadas`
    default: return "¡Un nuevo hito en tu taller!"
  }
}

function getMilestonePreheader(nombre: string, milestone: { tipo: string; valor: number }): string {
  return `${nombre}, alcanzaste un nuevo hito: ${milestone.valor} ${milestone.tipo}!`
}

function getMilestoneTitle(milestone: { tipo: string; valor: number }): string {
  return `¡Nuevo hito: ${milestone.valor} ${milestone.tipo}!`
}

function getMilestoneMessage(org: string, milestone: { tipo: string; valor: number }): string {
  switch (milestone.tipo) {
    case "ordenes": return `${org} ya procesó ${milestone.valor} órdenes de servicio`
    case "clientes": return `${org} ya tiene ${milestone.valor} clientes registrados`
    case "ventas": return `${org} ya realizó ${milestone.valor} ventas`
    default: return `${org} alcanzó un nuevo hito!`
  }
}
