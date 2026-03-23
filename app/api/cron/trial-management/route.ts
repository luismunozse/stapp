import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

const ENVIALOSIMPLE_API_URL = "https://backend.envialosimple.email/api/v1/mail/send"
const EMAIL_FROM = process.env.EMAIL_FROM || "noreply@stapp.com.ar"
const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "stapp.com.ar"

const AUTO_EXTENSION_DAYS = 7
const ACTIVITY_LOOKBACK_DAYS = 14

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const apiKey = process.env.ENVIALOSIMPLE_API_KEY
  if (!apiKey) return false
  try {
    const res = await fetch(ENVIALOSIMPLE_API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: EMAIL_FROM, to, subject, html }),
    })
    return res.ok
  } catch {
    return false
  }
}

async function wasAlreadySent(orgId: string, emailType: string): Promise<boolean> {
  const { count } = await supabaseAdmin
    .from("lifecycle_emails")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("email_type", emailType)
    .eq("status", "SENT")
  return (count || 0) > 0
}

export const maxDuration = 60

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  const expectedKey = process.env.CRON_SECRET
  if (expectedKey && authHeader !== `Bearer ${expectedKey}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }

  try {
    const now = new Date()
    const results = { autoExtended: 0, lastChanceEmails: 0, alreadyHandled: 0 }

    // Buscar trials vencidos o por vencer en 3 días
    const threeDaysFromNow = new Date(now)
    threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3)

    const { data: subs } = await supabaseAdmin
      .from("subscriptions")
      .select(`
        id, organization_id, trial_end, status,
        organizations!inner (id, nombre, slug, activo)
      `)
      .eq("status", "TRIALING")
      .not("trial_end", "is", null)
      .lte("trial_end", threeDaysFromNow.toISOString())
      .eq("organizations.activo", true)

    if (!subs || subs.length === 0) {
      return NextResponse.json({ success: true, results })
    }

    const orgIds = subs.map(s => s.organization_id)

    // Admins en bulk
    const { data: allAdmins } = await supabaseAdmin
      .from("users")
      .select("id, nombre, email, organization_id")
      .in("organization_id", orgIds)
      .eq("rol", "ADMIN")

    const adminMap = new Map((allAdmins || []).map(a => [a.organization_id, a]))

    // Actividad reciente en bulk
    const lookbackDate = new Date(now)
    lookbackDate.setDate(lookbackDate.getDate() - ACTIVITY_LOOKBACK_DAYS)

    const [ordenesRes, ventasRes, clientesRes] = await Promise.all([
      supabaseAdmin.from("ordenes_servicio").select("organization_id").in("organization_id", orgIds).gte("created_at", lookbackDate.toISOString()),
      supabaseAdmin.from("ventas").select("organization_id").in("organization_id", orgIds).gte("created_at", lookbackDate.toISOString()),
      supabaseAdmin.from("clientes").select("organization_id").in("organization_id", orgIds).gte("created_at", lookbackDate.toISOString()),
    ])

    // Contar actividad por org
    const activityCounts: Record<string, number> = {}
    for (const row of [...(ordenesRes.data || []), ...(ventasRes.data || []), ...(clientesRes.data || [])]) {
      activityCounts[row.organization_id] = (activityCounts[row.organization_id] || 0) + 1
    }

    // Extensiones previas en bulk
    const { data: prevExtensions } = await supabaseAdmin
      .from("trial_extensions")
      .select("organization_id")
      .in("organization_id", orgIds)
      .like("motivo", "%auto-extension%")

    const extensionCounts: Record<string, number> = {}
    for (const ext of prevExtensions || []) {
      extensionCounts[ext.organization_id] = (extensionCounts[ext.organization_id] || 0) + 1
    }

    for (const sub of subs) {
      const org = sub.organizations as unknown as { id: string; nombre: string; slug: string; activo: boolean }
      const trialEnd = new Date(sub.trial_end!)
      const daysLeft = Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

      if (daysLeft > 3) continue

      // Máximo 2 auto-extensiones
      if ((extensionCounts[org.id] || 0) >= 2) {
        results.alreadyHandled++
        continue
      }

      const admin = adminMap.get(org.id)
      if (!admin?.email) continue

      const hasActivity = (activityCounts[org.id] || 0) >= 3
      const appUrl = `https://${org.slug}.${ROOT_DOMAIN}`

      if (hasActivity) {
        // Auto-extensión
        const newTrialEnd = new Date(trialEnd)
        newTrialEnd.setDate(newTrialEnd.getDate() + AUTO_EXTENSION_DAYS)

        await supabaseAdmin.from("subscriptions").update({
          status: "TRIALING",
          trial_end: newTrialEnd.toISOString(),
        }).eq("id", sub.id)

        await supabaseAdmin.from("trial_extensions").insert({
          organization_id: org.id,
          dias_extendidos: AUTO_EXTENSION_DAYS,
          nueva_fecha_fin: newTrialEnd.toISOString(),
          motivo: `auto-extension: ${activityCounts[org.id]} acciones en ${ACTIVITY_LOOKBACK_DAYS} días`,
          extendido_por: "sistema",
        })

        if (!(await wasAlreadySent(org.id, "TRIAL_AUTO_EXTENDED"))) {
          const fechaStr = newTrialEnd.toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" })
          await sendEmail(admin.email, "Buenas noticias - Te extendimos la prueba gratuita", getTrialExtendedEmailHtml(admin.nombre, org.nombre, appUrl, AUTO_EXTENSION_DAYS, fechaStr))
          await supabaseAdmin.from("lifecycle_emails").insert({
            organization_id: org.id, user_id: admin.id,
            email_type: "TRIAL_AUTO_EXTENDED", status: "SENT",
            metadata: { dias: AUTO_EXTENSION_DAYS, nuevaFecha: newTrialEnd.toISOString() },
          })
        }
        results.autoExtended++
      } else if (daysLeft <= 0) {
        // Última oportunidad
        if (!(await wasAlreadySent(org.id, "TRIAL_LAST_CHANCE"))) {
          const newTrialEnd = new Date(now)
          newTrialEnd.setDate(newTrialEnd.getDate() + AUTO_EXTENSION_DAYS)

          await supabaseAdmin.from("subscriptions").update({
            status: "TRIALING", trial_end: newTrialEnd.toISOString(),
          }).eq("id", sub.id)

          await supabaseAdmin.from("trial_extensions").insert({
            organization_id: org.id, dias_extendidos: AUTO_EXTENSION_DAYS,
            nueva_fecha_fin: newTrialEnd.toISOString(),
            motivo: "auto-extension: última oportunidad (sin actividad)",
            extendido_por: "sistema",
          })

          await sendEmail(admin.email, "Te damos 7 días más - Solo tenés que usarlos", getLastChanceEmailHtml(admin.nombre, org.nombre, appUrl))
          await supabaseAdmin.from("lifecycle_emails").insert({
            organization_id: org.id, user_id: admin.id,
            email_type: "TRIAL_LAST_CHANCE", status: "SENT",
          })
          results.lastChanceEmails++
        }
      }
    }

    return NextResponse.json({ success: true, results, timestamp: new Date().toISOString() })
  } catch (error) {
    console.error("Error en cron trial-management:", error)
    return NextResponse.json({ error: "Error procesando trials" }, { status: 500 })
  }
}

// Inline email templates (simplified)
function getTrialExtendedEmailHtml(nombre: string, org: string, appUrl: string, dias: number, fechaStr: string): string {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f3f4f6;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;"><tr><td align="center" style="padding:40px 20px;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">
<tr><td style="background:linear-gradient(135deg,#10b981,#059669);padding:32px 40px;text-align:center;border-radius:16px 16px 0 0;">
<table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>
<td style="vertical-align:middle;padding-right:10px;"><img src="https://${ROOT_DOMAIN}/icon-192.png" style="height:36px;width:36px;border-radius:8px;" /></td>
<td style="vertical-align:middle;"><span style="color:#fff;font-size:24px;font-weight:700;">STApp</span></td>
</tr></table></td></tr>
<tr><td style="background:#fff;padding:40px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 16px 16px;">
<h1 style="color:#1f2937;font-size:24px;font-weight:700;text-align:center;margin:0 0 16px;">Te extendimos la prueba gratuita</h1>
<p style="color:#4b5563;font-size:16px;text-align:center;margin:0 0 24px;">Hola <strong>${nombre}</strong>, vimos que estás usando <strong>${org}</strong> activamente, así que te extendimos la prueba <strong>${dias} días más</strong>.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;"><tr>
<td style="background:#ecfdf5;padding:24px;border-radius:12px;border:1px solid #a7f3d0;text-align:center;">
<p style="color:#065f46;font-size:14px;margin:0 0 8px;font-weight:600;">Nueva fecha límite</p>
<p style="color:#065f46;font-size:28px;font-weight:700;margin:0;">${fechaStr}</p>
</td></tr></table>
<p style="color:#4b5563;font-size:15px;text-align:center;margin:0 0 24px;">Seguí usando STApp y cuando estés listo, podés suscribirte al plan Premium para mantener acceso ilimitado.</p>
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:16px 0;">
<a href="${appUrl}" style="background:#10b981;color:#fff;padding:16px 32px;text-decoration:none;border-radius:10px;font-weight:600;font-size:16px;display:inline-block;">Seguir usando STApp</a>
</td></tr></table></td></tr>
<tr><td style="padding:24px 40px;text-align:center;"><p style="color:#9ca3af;font-size:13px;margin:0;">Este correo fue enviado automáticamente por STApp.</p></td></tr>
</table></td></tr></table></body></html>`
}

function getLastChanceEmailHtml(nombre: string, org: string, appUrl: string): string {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f3f4f6;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;"><tr><td align="center" style="padding:40px 20px;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">
<tr><td style="background:linear-gradient(135deg,#f59e0b,#d97706);padding:32px 40px;text-align:center;border-radius:16px 16px 0 0;">
<table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>
<td style="vertical-align:middle;padding-right:10px;"><img src="https://${ROOT_DOMAIN}/icon-192.png" style="height:36px;width:36px;border-radius:8px;" /></td>
<td style="vertical-align:middle;"><span style="color:#fff;font-size:24px;font-weight:700;">STApp</span></td>
</tr></table></td></tr>
<tr><td style="background:#fff;padding:40px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 16px 16px;">
<h1 style="color:#1f2937;font-size:24px;font-weight:700;text-align:center;margin:0 0 16px;">Te damos 7 días más</h1>
<p style="color:#4b5563;font-size:16px;text-align:center;margin:0 0 24px;">Hola <strong>${nombre}</strong>, tu prueba gratuita de <strong>${org}</strong> venció, pero no queremos que te vayas sin probar STApp a fondo.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;"><tr>
<td style="background:#fffbeb;padding:24px;border-radius:12px;border:1px solid #fde68a;text-align:center;">
<p style="color:#92400e;font-size:16px;margin:0;font-weight:600;">Te extendimos la prueba 7 días más para que puedas evaluar la plataforma.</p>
</td></tr></table>
<p style="color:#4b5563;font-size:15px;text-align:center;margin:0 0 8px;">Aprovechá para:</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
<tr><td style="color:#4b5563;font-size:15px;padding:4px 0;">• Cargar tus clientes y órdenes reales</td></tr>
<tr><td style="color:#4b5563;font-size:15px;padding:4px 0;">• Probar las notificaciones por WhatsApp</td></tr>
<tr><td style="color:#4b5563;font-size:15px;padding:4px 0;">• Ver cómo funciona el seguimiento público</td></tr>
</table>
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:16px 0;">
<a href="${appUrl}" style="background:#f59e0b;color:#fff;padding:16px 32px;text-decoration:none;border-radius:10px;font-weight:600;font-size:16px;display:inline-block;">Volver a STApp</a>
</td></tr></table>
<p style="color:#9ca3af;font-size:13px;text-align:center;margin:24px 0 0;">¿Necesitás ayuda? Respondé a este correo y te ayudamos a empezar.</p>
</td></tr>
<tr><td style="padding:24px 40px;text-align:center;"><p style="color:#9ca3af;font-size:13px;margin:0;">Este correo fue enviado automáticamente por STApp.</p></td></tr>
</table></td></tr></table></body></html>`
}
