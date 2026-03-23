import { inngest } from "../client"
import { supabaseAdmin } from "@/lib/supabase"
import { getLifecycleEmail } from "@/lib/emails/lifecycle-templates"

const ENVIALOSIMPLE_API_URL = "https://backend.envialosimple.email/api/v1/mail/send"
const EMAIL_FROM = process.env.EMAIL_FROM || "noreply@stapp.com.ar"

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const apiKey = process.env.ENVIALOSIMPLE_API_KEY
  if (!apiKey) {
    console.error("[TrialMgmt] ENVIALOSIMPLE_API_KEY no configurada")
    return false
  }

  try {
    const response = await fetch(ENVIALOSIMPLE_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: EMAIL_FROM, to, subject, html }),
    })
    return response.ok
  } catch (error) {
    console.error("[TrialMgmt] Error enviando email:", error)
    return false
  }
}

async function wasEmailAlreadySent(organizationId: string, emailType: string): Promise<boolean> {
  const { count } = await supabaseAdmin
    .from("lifecycle_emails")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("email_type", emailType)
    .eq("status", "SENT")

  return (count || 0) > 0
}

const AUTO_EXTENSION_DAYS = 7 // Días que se extienden automáticamente
const ACTIVITY_LOOKBACK_DAYS = 14 // Ventana para buscar actividad reciente

/**
 * Cron diario: Gestión automática de trials
 * - Extiende automáticamente trials de orgs con actividad reciente
 * - Envía email de extensión otorgada
 * - Para orgs sin actividad, envía email de "última oportunidad"
 * Se ejecuta todos los días a las 8:00 AM
 */
export const trialManagement = inngest.createFunction(
  {
    id: "trial-management",
    name: "Trial Management - Auto Extension & Recovery",
    retries: 1,
  },
  { cron: "0 8 * * *" },
  async ({ step }) => {
    const now = new Date()
    const results = {
      autoExtended: 0,
      lastChanceEmails: 0,
      alreadyHandled: 0,
    }

    // ============================================
    // 1. Buscar trials vencidos o por vencer (0-3 días)
    // ============================================
    const expiredOrAboutTo = await step.run("find-expiring-trials", async () => {
      const threeDaysFromNow = new Date(now)
      threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3)

      const { data: subs } = await supabaseAdmin
        .from("subscriptions")
        .select(`
          id, organization_id, trial_end, status,
          organizations (id, nombre, slug, activo)
        `)
        .eq("status", "TRIALING")
        .not("trial_end", "is", null)
        .lte("trial_end", threeDaysFromNow.toISOString())

      return subs || []
    })

    // ============================================
    // 2. Para cada trial vencido/por vencer, evaluar actividad
    // ============================================
    await step.run("process-trials", async () => {
      for (const sub of expiredOrAboutTo) {
        const org = sub.organizations as unknown as {
          id: string; nombre: string; slug: string; activo: boolean
        }
        if (!org?.activo) continue

        const trialEnd = new Date(sub.trial_end!)
        const daysLeft = Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

        // Solo procesar si está vencido o le quedan 0-3 días
        if (daysLeft > 3) continue

        // Verificar si ya se extendió automáticamente (máximo 2 veces)
        const { count: extensionCount } = await supabaseAdmin
          .from("trial_extensions")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", org.id)
          .like("motivo", "%auto-extension%")

        if ((extensionCount || 0) >= 2) {
          results.alreadyHandled++
          continue
        }

        // Verificar actividad reciente
        const lookbackDate = new Date(now)
        lookbackDate.setDate(lookbackDate.getDate() - ACTIVITY_LOOKBACK_DAYS)

        const [ordenesRes, ventasRes, clientesRes] = await Promise.all([
          supabaseAdmin
            .from("ordenes_servicio")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", org.id)
            .gte("created_at", lookbackDate.toISOString()),
          supabaseAdmin
            .from("ventas")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", org.id)
            .gte("created_at", lookbackDate.toISOString()),
          supabaseAdmin
            .from("clientes")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", org.id)
            .gte("created_at", lookbackDate.toISOString()),
        ])

        const totalActivity = (ordenesRes.count || 0) + (ventasRes.count || 0) + (clientesRes.count || 0)
        const hasActivity = totalActivity >= 3 // Al menos 3 acciones en los últimos 14 días

        // Obtener admin email
        const { data: admins } = await supabaseAdmin
          .from("users")
          .select("id, nombre, email")
          .eq("organization_id", org.id)
          .eq("rol", "ADMIN")
          .limit(1)

        const admin = admins?.[0]
        if (!admin?.email) continue

        if (hasActivity) {
          // ============================================
          // AUTO-EXTENSIÓN: Org activa, extender trial
          // ============================================
          const newTrialEnd = new Date(trialEnd)
          newTrialEnd.setDate(newTrialEnd.getDate() + AUTO_EXTENSION_DAYS)

          await supabaseAdmin
            .from("subscriptions")
            .update({
              status: "TRIALING",
              trial_end: newTrialEnd.toISOString(),
            })
            .eq("id", sub.id)

          // Registrar extensión
          await supabaseAdmin.from("trial_extensions").insert({
            organization_id: org.id,
            dias_extendidos: AUTO_EXTENSION_DAYS,
            nueva_fecha_fin: newTrialEnd.toISOString(),
            motivo: `auto-extension: ${totalActivity} acciones en ${ACTIVITY_LOOKBACK_DAYS} días`,
            extendido_por: "sistema",
          })

          // Enviar email de extensión
          const alreadySent = await wasEmailAlreadySent(org.id, "TRIAL_AUTO_EXTENDED")
          if (!alreadySent) {
            const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "stapp.com.ar"
            const appUrl = `https://${org.slug}.${ROOT_DOMAIN}`
            const sent = await sendEmail(
              admin.email,
              "Buenas noticias - Extendimos tu prueba gratuita",
              getTrialExtendedEmail(admin.nombre, org.nombre, appUrl, AUTO_EXTENSION_DAYS, newTrialEnd)
            )
            await supabaseAdmin.from("lifecycle_emails").insert({
              organization_id: org.id,
              user_id: admin.id,
              email_type: "TRIAL_AUTO_EXTENDED",
              status: sent ? "SENT" : "FAILED",
              metadata: { dias: AUTO_EXTENSION_DAYS, nuevaFecha: newTrialEnd.toISOString(), actividad: totalActivity },
            })
          }

          results.autoExtended++
        } else if (daysLeft <= 0) {
          // ============================================
          // SIN ACTIVIDAD Y VENCIDO: enviar email de última oportunidad
          // ============================================
          const emailType = "TRIAL_LAST_CHANCE"
          const alreadySent = await wasEmailAlreadySent(org.id, emailType)
          if (!alreadySent) {
            const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "stapp.com.ar"
            const appUrl = `https://${org.slug}.${ROOT_DOMAIN}`
            const sent = await sendEmail(
              admin.email,
              "Te damos 7 dias mas - Solo tenes que usarlos",
              getLastChanceEmail(admin.nombre, org.nombre, appUrl)
            )
            await supabaseAdmin.from("lifecycle_emails").insert({
              organization_id: org.id,
              user_id: admin.id,
              email_type: emailType,
              status: sent ? "SENT" : "FAILED",
            })

            // Extender 7 días de todas formas para dar la oportunidad
            const newTrialEnd = new Date(now)
            newTrialEnd.setDate(newTrialEnd.getDate() + AUTO_EXTENSION_DAYS)

            await supabaseAdmin
              .from("subscriptions")
              .update({
                status: "TRIALING",
                trial_end: newTrialEnd.toISOString(),
              })
              .eq("id", sub.id)

            await supabaseAdmin.from("trial_extensions").insert({
              organization_id: org.id,
              dias_extendidos: AUTO_EXTENSION_DAYS,
              nueva_fecha_fin: newTrialEnd.toISOString(),
              motivo: `auto-extension: última oportunidad (sin actividad)`,
              extendido_por: "sistema",
            })

            if (sent) results.lastChanceEmails++
          }
        }
      }
    })

    return { success: true, ...results }
  }
)

// ============================================
// EMAIL TEMPLATES
// ============================================

const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "stapp.com.ar"

function getTrialExtendedEmail(nombre: string, org: string, appUrl: string, dias: number, newEnd: Date): string {
  const fechaStr = newEnd.toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" })
  return `
    <!DOCTYPE html>
    <html lang="es">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>STApp - Trial Extendido</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; line-height: 1.6; background-color: #f3f4f6;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f3f4f6;">
          <tr>
            <td align="center" style="padding: 40px 20px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px;">
                <tr>
                  <td style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 32px 40px; text-align: center; border-radius: 16px 16px 0 0;">
                    <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 0 auto;">
                      <tr>
                        <td style="vertical-align: middle; padding-right: 10px;">
                          <img src="https://${ROOT_DOMAIN}/icon-192.png" alt="" style="height: 36px; width: 36px; border-radius: 8px;" />
                        </td>
                        <td style="vertical-align: middle;">
                          <span style="color: #ffffff; font-size: 24px; font-weight: 700;">STApp</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="background-color: #ffffff; padding: 40px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 16px 16px;">
                    <h1 style="color: #1f2937; font-size: 24px; font-weight: 700; text-align: center; margin: 0 0 16px 0;">
                      Extendimos tu prueba gratuita
                    </h1>
                    <p style="color: #4b5563; font-size: 16px; text-align: center; margin: 0 0 24px 0;">
                      Hola <strong>${nombre}</strong>, vimos que estas usando <strong>${org}</strong> activamente, asi que te extendimos la prueba <strong>${dias} dias mas</strong>.
                    </p>

                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 24px 0;">
                      <tr>
                        <td style="background-color: #ecfdf5; padding: 24px; border-radius: 12px; border: 1px solid #a7f3d0; text-align: center;">
                          <p style="color: #065f46; font-size: 14px; margin: 0 0 8px 0; font-weight: 600;">Nueva fecha limite</p>
                          <p style="color: #065f46; font-size: 28px; font-weight: 700; margin: 0;">${fechaStr}</p>
                        </td>
                      </tr>
                    </table>

                    <p style="color: #4b5563; font-size: 15px; text-align: center; margin: 0 0 24px 0;">
                      Segui usando STApp y cuando estes listo, podes suscribirte al plan Premium para mantener acceso ilimitado.
                    </p>

                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td align="center" style="padding: 16px 0;">
                          <a href="${appUrl}" style="background: #10b981; color: #ffffff; padding: 16px 32px; text-decoration: none; border-radius: 10px; font-weight: 600; font-size: 16px; display: inline-block;">
                            Seguir usando STApp
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 24px 40px; text-align: center;">
                    <p style="color: #9ca3af; font-size: 13px; margin: 0;">
                      Este correo fue enviado automaticamente por STApp.
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

function getLastChanceEmail(nombre: string, org: string, appUrl: string): string {
  return `
    <!DOCTYPE html>
    <html lang="es">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>STApp - Ultima Oportunidad</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; line-height: 1.6; background-color: #f3f4f6;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f3f4f6;">
          <tr>
            <td align="center" style="padding: 40px 20px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px;">
                <tr>
                  <td style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); padding: 32px 40px; text-align: center; border-radius: 16px 16px 0 0;">
                    <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 0 auto;">
                      <tr>
                        <td style="vertical-align: middle; padding-right: 10px;">
                          <img src="https://${ROOT_DOMAIN}/icon-192.png" alt="" style="height: 36px; width: 36px; border-radius: 8px;" />
                        </td>
                        <td style="vertical-align: middle;">
                          <span style="color: #ffffff; font-size: 24px; font-weight: 700;">STApp</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="background-color: #ffffff; padding: 40px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 16px 16px;">
                    <h1 style="color: #1f2937; font-size: 24px; font-weight: 700; text-align: center; margin: 0 0 16px 0;">
                      Te damos 7 dias mas
                    </h1>
                    <p style="color: #4b5563; font-size: 16px; text-align: center; margin: 0 0 24px 0;">
                      Hola <strong>${nombre}</strong>, tu prueba gratuita de <strong>${org}</strong> vencio, pero no queremos que te vayas sin probar STApp a fondo.
                    </p>

                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 24px 0;">
                      <tr>
                        <td style="background-color: #fffbeb; padding: 24px; border-radius: 12px; border: 1px solid #fde68a; text-align: center;">
                          <p style="color: #92400e; font-size: 16px; margin: 0; font-weight: 600;">
                            Te extendimos la prueba 7 dias mas para que puedas evaluar la plataforma.
                          </p>
                        </td>
                      </tr>
                    </table>

                    <p style="color: #4b5563; font-size: 15px; text-align: center; margin: 0 0 8px 0;">
                      Aprovecha para:
                    </p>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 24px 0;">
                      <tr><td style="color: #4b5563; font-size: 15px; padding: 4px 0;">• Cargar tus clientes y ordenes reales</td></tr>
                      <tr><td style="color: #4b5563; font-size: 15px; padding: 4px 0;">• Probar las notificaciones por WhatsApp</td></tr>
                      <tr><td style="color: #4b5563; font-size: 15px; padding: 4px 0;">• Ver como funciona el seguimiento publico</td></tr>
                    </table>

                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td align="center" style="padding: 16px 0;">
                          <a href="${appUrl}" style="background: #f59e0b; color: #ffffff; padding: 16px 32px; text-decoration: none; border-radius: 10px; font-weight: 600; font-size: 16px; display: inline-block;">
                            Volver a STApp
                          </a>
                        </td>
                      </tr>
                    </table>

                    <p style="color: #9ca3af; font-size: 13px; text-align: center; margin: 24px 0 0 0;">
                      Necesitas ayuda? Responde a este correo y te ayudamos a empezar.
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 24px 40px; text-align: center;">
                    <p style="color: #9ca3af; font-size: 13px; margin: 0;">
                      Este correo fue enviado automaticamente por STApp.
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
