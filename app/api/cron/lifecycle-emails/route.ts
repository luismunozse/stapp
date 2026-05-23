import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { getLifecycleEmail, type LifecycleEmailType } from "@/lib/emails/lifecycle-templates"
import { requireCronAuth } from "@/lib/cron-auth"

const ENVIALOSIMPLE_API_URL = "https://backend.envialosimple.email/api/v1/mail/send"
const EMAIL_FROM = process.env.EMAIL_FROM || "noreply@stapp.com.ar"
const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "stapp.com.ar"

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

async function logEmail(orgId: string, emailType: string, status: "SENT" | "FAILED", userId?: string) {
  await supabaseAdmin.from("lifecycle_emails").insert({
    organization_id: orgId,
    user_id: userId || null,
    email_type: emailType,
    status,
  })
}

export const maxDuration = 60

export async function GET(request: Request) {
  const authError = requireCronAuth(request)
  if (authError) return authError

  try {
    const now = new Date()
    const results = {
      welcome: 0, tipDay3: 0, tipDay7: 0, tipDay14: 0,
      trialExpiring5: 0, trialExpiring1: 0, trialExpired: 0,
      winBack7: 0, winBack30: 0, milestones: 0,
      trialDay25Sent: 0, trialDay28Sent: 0,
    }

    // Traer todas las orgs activas con sus admins en bulk
    const { data: allOrgs } = await supabaseAdmin
      .from("organizations")
      .select("id, nombre, slug, created_at, notificaciones_whatsapp, notificaciones_email")
      .eq("activo", true)

    if (!allOrgs || allOrgs.length === 0) {
      return NextResponse.json({ success: true, results })
    }

    const orgIds = allOrgs.map(o => o.id)

    // Admins en bulk
    const { data: allAdmins } = await supabaseAdmin
      .from("users")
      .select("id, nombre, email, organization_id")
      .in("organization_id", orgIds)
      .eq("rol", "ADMIN")

    const adminMap = new Map((allAdmins || []).map(a => [a.organization_id, a]))

    // Helper para enviar un lifecycle email
    async function trySend(org: { id: string; nombre: string; slug: string }, emailType: LifecycleEmailType, extra?: { diasRestantes?: number; milestone?: { tipo: string; valor: number } }) {
      const alreadySent = await wasAlreadySent(org.id, emailType === "MILESTONE" ? `MILESTONE_ORDENES_${extra?.milestone?.valor}` : emailType)
      if (alreadySent) return false

      const admin = adminMap.get(org.id)
      if (!admin?.email) return false

      const { subject, html } = getLifecycleEmail(emailType, {
        nombre: admin.nombre,
        organizacion: org.nombre,
        slug: org.slug,
        ...extra,
      })

      const sent = await sendEmail(admin.email, subject, html)
      await logEmail(org.id, emailType === "MILESTONE" ? `MILESTONE_ORDENES_${extra?.milestone?.valor}` : emailType, sent ? "SENT" : "FAILED", admin.id)
      return sent
    }

    // ============================================
    // 1-3. WELCOME, TIP_DAY_3, TIP_DAY_7
    // ============================================
    for (const org of allOrgs) {
      const orgAge = Math.floor((now.getTime() - new Date(org.created_at).getTime()) / (1000 * 60 * 60 * 24))

      if (orgAge === 1) {
        if (await trySend(org, "WELCOME")) results.welcome++
      } else if (orgAge === 3) {
        if (await trySend(org, "TIP_DAY_3")) results.tipDay3++
      } else if (orgAge === 7) {
        if (await trySend(org, "TIP_DAY_7")) results.tipDay7++
      } else if (orgAge === 14) {
        if (await trySend(org, "TIP_DAY_14")) results.tipDay14++
      }
    }

    // ============================================
    // 4. TRIAL EXPIRING (5 días, 1 día, expirado)
    // ============================================
    const { data: trialingSubs } = await supabaseAdmin
      .from("subscriptions")
      .select("organization_id, trial_end")
      .eq("status", "TRIALING")
      .not("trial_end", "is", null)
      .in("organization_id", orgIds)

    for (const sub of trialingSubs || []) {
      if (!sub.trial_end) continue
      const daysLeft = Math.ceil((new Date(sub.trial_end).getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      const org = allOrgs.find(o => o.id === sub.organization_id)
      if (!org) continue

      if (daysLeft === 5) {
        if (await trySend(org, "TRIAL_EXPIRING_5", { diasRestantes: 5 })) results.trialExpiring5++
      } else if (daysLeft === 1) {
        if (await trySend(org, "TRIAL_EXPIRING_1", { diasRestantes: 1 })) results.trialExpiring1++
      } else if (daysLeft <= 0) {
        if (await trySend(org, "TRIAL_EXPIRED", { diasRestantes: 0 })) results.trialExpired++
      }
    }

    // ============================================
    // 4b. TRIAL COUNTDOWN — Day 25 (5 días restantes) y Day 28 (2 días restantes)
    // ----------------------------------------------
    // Refuerzo adicional sobre los TRIAL_EXPIRING_5/1 ya existentes; estos son
    // tipos de email distintos, con copy más urgente y CTA directo a /billing.
    // Idempotente vía lifecycle_emails (un envío por org y tipo).
    // ============================================
    const sendTrialCountdown = async (
      org: { id: string; nombre: string; slug: string },
      emailType: "TRIAL_DAY_25_REMINDER" | "TRIAL_DAY_28_URGENCY",
    ): Promise<boolean> => {
      const already = await wasAlreadySent(org.id, emailType)
      if (already) return false

      const admin = adminMap.get(org.id)
      if (!admin?.email) return false

      const billingUrl = `https://www.${ROOT_DOMAIN}/configuracion/billing`
      const { subject, html } =
        emailType === "TRIAL_DAY_25_REMINDER"
          ? buildTrialDay25Email(admin.nombre, org.nombre, billingUrl)
          : buildTrialDay28Email(admin.nombre, org.nombre, billingUrl)

      const sent = await sendEmail(admin.email, subject, html)
      await logEmail(org.id, emailType, sent ? "SENT" : "FAILED", admin.id)
      return sent
    }

    for (const sub of trialingSubs || []) {
      if (!sub.trial_end) continue
      const trialEndMs = new Date(sub.trial_end).getTime()
      const msLeft = trialEndMs - now.getTime()
      if (msLeft <= 0) continue

      const org = allOrgs.find(o => o.id === sub.organization_id)
      if (!org) continue
      if (org.slug === "superadmin") continue

      const oneDay = 24 * 60 * 60 * 1000

      // Día 28 urgency: queda entre 1 y 2 días
      if (msLeft > oneDay && msLeft <= 2 * oneDay) {
        const sent = await sendTrialCountdown(org, "TRIAL_DAY_28_URGENCY")
        if (sent) results.trialDay28Sent++
        continue
      }

      // Día 25 reminder: queda entre 4 y 5 días
      if (msLeft > 4 * oneDay && msLeft <= 5 * oneDay) {
        const sent = await sendTrialCountdown(org, "TRIAL_DAY_25_REMINDER")
        if (sent) results.trialDay25Sent++
      }
    }

    // ============================================
    // 5. WIN-BACK (bulk, sin N+1)
    // ============================================
    const { data: allOrders } = await supabaseAdmin
      .from("ordenes_servicio")
      .select("organization_id, created_at")
      .in("organization_id", orgIds)
      .order("created_at", { ascending: false })

    // Última actividad por org
    const lastActivityMap = new Map<string, Date>()
    for (const order of allOrders || []) {
      if (!lastActivityMap.has(order.organization_id)) {
        lastActivityMap.set(order.organization_id, new Date(order.created_at))
      }
    }

    for (const org of allOrgs) {
      const lastActivity = lastActivityMap.get(org.id)
      if (!lastActivity) continue

      const daysSince = Math.floor((now.getTime() - lastActivity.getTime()) / (1000 * 60 * 60 * 24))

      if (daysSince >= 6 && daysSince <= 8) {
        if (await trySend(org, "WIN_BACK_7")) results.winBack7++
      } else if (daysSince >= 28 && daysSince <= 32) {
        if (await trySend(org, "WIN_BACK_30")) results.winBack30++
      }
    }

    // ============================================
    // 6. MILESTONES (bulk, sin N+1)
    // ============================================
    const orderCounts: Record<string, number> = {}
    for (const o of allOrders || []) {
      orderCounts[o.organization_id] = (orderCounts[o.organization_id] || 0) + 1
    }

    const milestoneThresholds = [50, 100, 250, 500, 1000]
    for (const org of allOrgs) {
      const total = orderCounts[org.id] || 0
      for (const threshold of milestoneThresholds) {
        if (total >= threshold && total < threshold + 5) {
          if (await trySend(org, "MILESTONE", { milestone: { tipo: "ordenes", valor: threshold } })) {
            results.milestones++
          }
          break
        }
      }
    }

    return NextResponse.json({ success: true, results, timestamp: new Date().toISOString() })
  } catch (error) {
    console.error("Error en cron lifecycle-emails:", error)
    return NextResponse.json({ error: "Error procesando lifecycle emails" }, { status: 500 })
  }
}

// ============================================
// Email templates: TRIAL_DAY_25_REMINDER y TRIAL_DAY_28_URGENCY
// Diseño mobile-responsive, gradient header (estilo existente trial-management).
// ============================================
function buildTrialDay25Email(
  nombre: string,
  org: string,
  billingUrl: string,
): { subject: string; html: string } {
  const subject = `Te quedan 5 días de prueba en STApp`
  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f3f4f6;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;"><tr><td align="center" style="padding:40px 20px;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">
<tr><td style="background:linear-gradient(135deg,#3b82f6,#1d4ed8);padding:32px 40px;text-align:center;border-radius:16px 16px 0 0;">
<table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>
<td style="vertical-align:middle;padding-right:10px;"><img src="https://${ROOT_DOMAIN}/icon-192.png" style="height:36px;width:36px;border-radius:8px;" alt="" /></td>
<td style="vertical-align:middle;"><span style="color:#fff;font-size:24px;font-weight:700;">STApp</span></td>
</tr></table></td></tr>
<tr><td style="background:#fff;padding:40px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 16px 16px;">
<h1 style="color:#1f2937;font-size:24px;font-weight:700;text-align:center;margin:0 0 16px;">Te quedan 5 días de prueba</h1>
<p style="color:#4b5563;font-size:16px;text-align:center;margin:0 0 24px;">Hola <strong>${nombre}</strong>, en 5 días termina tu período de prueba de <strong>${org}</strong>. Si activás tu suscripción ahora, no perdés acceso a ninguna función.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;"><tr>
<td style="background:#eff6ff;padding:20px;border-radius:12px;border:1px solid #bfdbfe;">
<p style="color:#1e40af;font-size:15px;margin:0 0 12px;font-weight:600;">Si no activás, al final del trial volvés al plan Free y perdés:</p>
<table width="100%" cellpadding="0" cellspacing="0">
<tr><td style="color:#1e3a8a;font-size:14px;padding:3px 0;">• Notificaciones por WhatsApp a tus clientes</td></tr>
<tr><td style="color:#1e3a8a;font-size:14px;padding:3px 0;">• Reportes y métricas avanzadas</td></tr>
<tr><td style="color:#1e3a8a;font-size:14px;padding:3px 0;">• Punto de Venta (POS) y caja</td></tr>
<tr><td style="color:#1e3a8a;font-size:14px;padding:3px 0;">• Múltiples usuarios y roles</td></tr>
<tr><td style="color:#1e3a8a;font-size:14px;padding:3px 0;">• Límite ampliado de órdenes y clientes</td></tr>
</table></td></tr></table>
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:8px 0 16px;">
<a href="${billingUrl}" style="background:#3b82f6;color:#fff;padding:16px 32px;text-decoration:none;border-radius:10px;font-weight:600;font-size:16px;display:inline-block;">Activar mi plan</a>
</td></tr></table>
<p style="color:#9ca3af;font-size:13px;text-align:center;margin:16px 0 0;">Tus datos no se borran. Si volvés a un plan pago en cualquier momento, recuperás todo el acceso.</p>
</td></tr>
<tr><td style="padding:24px 40px;text-align:center;"><p style="color:#9ca3af;font-size:13px;margin:0;">Este correo fue enviado automáticamente por STApp.</p></td></tr>
</table></td></tr></table></body></html>`
  return { subject, html }
}

function buildTrialDay28Email(
  nombre: string,
  org: string,
  billingUrl: string,
): { subject: string; html: string } {
  const subject = `Solo 2 días para mantener acceso completo a STApp`
  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f3f4f6;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;"><tr><td align="center" style="padding:40px 20px;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">
<tr><td style="background:linear-gradient(135deg,#f97316,#dc2626);padding:32px 40px;text-align:center;border-radius:16px 16px 0 0;">
<table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>
<td style="vertical-align:middle;padding-right:10px;"><img src="https://${ROOT_DOMAIN}/icon-192.png" style="height:36px;width:36px;border-radius:8px;" alt="" /></td>
<td style="vertical-align:middle;"><span style="color:#fff;font-size:24px;font-weight:700;">STApp</span></td>
</tr></table></td></tr>
<tr><td style="background:#fff;padding:40px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 16px 16px;">
<h1 style="color:#1f2937;font-size:24px;font-weight:700;text-align:center;margin:0 0 16px;">Quedan 2 días de prueba</h1>
<p style="color:#4b5563;font-size:16px;text-align:center;margin:0 0 20px;">Hola <strong>${nombre}</strong>, tu trial de <strong>${org}</strong> termina en 2 días. Si no activás tu plan, perdés acceso a estas funciones clave:</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;"><tr>
<td style="background:#fef2f2;padding:20px;border-radius:12px;border:1px solid #fecaca;">
<table width="100%" cellpadding="0" cellspacing="0">
<tr><td style="color:#991b1b;font-size:15px;padding:4px 0;font-weight:600;">• WhatsApp Business — adiós al canal donde más responden tus clientes</td></tr>
<tr><td style="color:#991b1b;font-size:15px;padding:4px 0;font-weight:600;">• Reportes avanzados — métricas, ranking de técnicos, facturación</td></tr>
<tr><td style="color:#991b1b;font-size:15px;padding:4px 0;font-weight:600;">• POS y caja — no podrás cobrar en mostrador</td></tr>
<tr><td style="color:#991b1b;font-size:15px;padding:4px 0;font-weight:600;">• Múltiples usuarios — solo el admin podrá entrar</td></tr>
<tr><td style="color:#991b1b;font-size:15px;padding:4px 0;font-weight:600;">• Capacidad ampliada — bajás al límite del plan Free</td></tr>
</table></td></tr></table>
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:8px 0 16px;">
<a href="${billingUrl}" style="background:#dc2626;color:#fff;padding:16px 32px;text-decoration:none;border-radius:10px;font-weight:700;font-size:16px;display:inline-block;">Activar Profesional ahora</a>
</td></tr></table>
<p style="color:#6b7280;font-size:14px;text-align:center;margin:16px 0 0;">Activación inmediata. Sin permanencia. Cancelás cuando quieras.</p>
</td></tr>
<tr><td style="padding:24px 40px;text-align:center;"><p style="color:#9ca3af;font-size:13px;margin:0;">Este correo fue enviado automáticamente por STApp.</p></td></tr>
</table></td></tr></table></body></html>`
  return { subject, html }
}
