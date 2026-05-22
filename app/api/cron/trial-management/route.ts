import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { requireCronAuth } from "@/lib/cron-auth"

const ENVIALOSIMPLE_API_URL = "https://backend.envialosimple.email/api/v1/mail/send"
const EMAIL_FROM = process.env.EMAIL_FROM || "noreply@stapp.com.ar"
const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "stapp.com.ar"

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
  const authError = requireCronAuth(request)
  if (authError) return authError

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
      .neq("organizations.slug", "superadmin")

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

      // Verificar si ya se le envió email de reactivación
      const alreadyNotified = await wasAlreadySent(org.id, "TRIAL_REACTIVATION_INVITE")
      if (alreadyNotified) {
        results.alreadyHandled++
        continue
      }

      const admin = adminMap.get(org.id)
      if (!admin?.email) continue

      const appUrl = `https://${org.slug}.${ROOT_DOMAIN}`
      const reactivarUrl = `${appUrl}/reactivar`

      if (daysLeft <= 0) {
        // Trial vencido: enviar email invitando a reactivar (NO extender automáticamente)
        // Los 7 días se activan solo cuando el usuario hace clic en /reactivar
        const sent = await sendEmail(
          admin.email,
          "Reactivá tu cuenta en STApp - Tenés 7 días más para probar",
          getReactivationEmailHtml(admin.nombre, org.nombre, reactivarUrl)
        )
        await supabaseAdmin.from("lifecycle_emails").insert({
          organization_id: org.id, user_id: admin.id,
          email_type: "TRIAL_REACTIVATION_INVITE",
          status: sent ? "SENT" : "FAILED",
        })
        if (sent) results.lastChanceEmails++
      }
    }

    return NextResponse.json({ success: true, results, timestamp: new Date().toISOString() })
  } catch (error) {
    console.error("Error en cron trial-management:", error)
    return NextResponse.json({ error: "Error procesando trials" }, { status: 500 })
  }
}

// Email template: invitación a reactivar (sin extender automáticamente)
function getReactivationEmailHtml(nombre: string, org: string, reactivarUrl: string): string {
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
<h1 style="color:#1f2937;font-size:24px;font-weight:700;text-align:center;margin:0 0 16px;">Tenés 7 días más para probar STApp</h1>
<p style="color:#4b5563;font-size:16px;text-align:center;margin:0 0 24px;">Hola <strong>${nombre}</strong>, tu prueba gratuita de <strong>${org}</strong> venció, pero no queremos que te vayas sin conocer todo lo que STApp puede hacer por tu taller.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;"><tr>
<td style="background:#fffbeb;padding:24px;border-radius:12px;border:1px solid #fde68a;text-align:center;">
<p style="color:#92400e;font-size:16px;margin:0;font-weight:600;">Hacé clic abajo para reactivar tu cuenta por 7 días más.</p>
</td></tr></table>
<p style="color:#4b5563;font-size:15px;text-align:center;margin:0 0 8px;">Aprovechá para:</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
<tr><td style="color:#4b5563;font-size:15px;padding:4px 0;">• Cargar tus clientes y órdenes reales</td></tr>
<tr><td style="color:#4b5563;font-size:15px;padding:4px 0;">• Probar las notificaciones por WhatsApp</td></tr>
<tr><td style="color:#4b5563;font-size:15px;padding:4px 0;">• Ver cómo funciona el seguimiento público</td></tr>
<tr><td style="color:#4b5563;font-size:15px;padding:4px 0;">• Cobrar órdenes con múltiples métodos de pago</td></tr>
</table>
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:16px 0;">
<a href="${reactivarUrl}" style="background:#f59e0b;color:#fff;padding:16px 32px;text-decoration:none;border-radius:10px;font-weight:600;font-size:16px;display:inline-block;">Reactivar mi cuenta</a>
</td></tr></table>
<p style="color:#9ca3af;font-size:13px;text-align:center;margin:24px 0 0;">Los 7 días empiezan a correr desde que hacés clic. Tus datos siguen ahí, tal como los dejaste.</p>
</td></tr>
<tr><td style="padding:24px 40px;text-align:center;"><p style="color:#9ca3af;font-size:13px;margin:0;">Este correo fue enviado automáticamente por STApp.</p></td></tr>
</table></td></tr></table></body></html>`
}
