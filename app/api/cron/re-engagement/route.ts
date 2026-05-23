import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { resolveTemplate } from "@/lib/emails/template-resolver"
import { requireCronAuth } from "@/lib/cron-auth"

const ENVIALOSIMPLE_API_URL = "https://backend.envialosimple.email/api/v1/mail/send"
const EMAIL_FROM = process.env.EMAIL_FROM || "noreply@stapp.com.ar"
const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "stapp.com.ar"

const INACTIVITY_DAYS = 14
const RESEND_COOLDOWN_DAYS = 30
const EMAIL_TYPE = "RE_ENGAGEMENT_INACTIVE"

export const maxDuration = 60

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

export async function GET(request: Request) {
  const authError = requireCronAuth(request)
  if (authError) return authError

  try {
    const now = new Date()
    const inactivityCutoff = new Date(now)
    inactivityCutoff.setDate(inactivityCutoff.getDate() - INACTIVITY_DAYS)
    const resendCutoff = new Date(now)
    resendCutoff.setDate(resendCutoff.getDate() - RESEND_COOLDOWN_DAYS)

    const results = { processed: 0, sent: 0, failed: 0, skippedNoEmail: 0, skippedRecent: 0, skippedActive: 0, skippedDraft: 0 }

    // 1. Todas las orgs activas (excepto superadmin).
    const { data: allOrgs } = await supabaseAdmin
      .from("organizations")
      .select("id, nombre, slug, email")
      .eq("activo", true)
      .neq("slug", "superadmin")

    if (!allOrgs || allOrgs.length === 0) {
      return NextResponse.json({ success: true, results })
    }

    const orgIds = allOrgs.map((o) => o.id)

    // 2. Bulk: actividad reciente (orders, ventas, clientes) en los últimos INACTIVITY_DAYS.
    const [ordenesRes, ventasRes, clientesRes] = await Promise.all([
      supabaseAdmin
        .from("ordenes_servicio")
        .select("organization_id")
        .in("organization_id", orgIds)
        .gte("created_at", inactivityCutoff.toISOString()),
      supabaseAdmin
        .from("ventas")
        .select("organization_id")
        .in("organization_id", orgIds)
        .gte("created_at", inactivityCutoff.toISOString()),
      supabaseAdmin
        .from("clientes")
        .select("organization_id")
        .in("organization_id", orgIds)
        .gte("created_at", inactivityCutoff.toISOString()),
    ])

    const activeRecently = new Set<string>()
    for (const row of [
      ...(ordenesRes.data || []),
      ...(ventasRes.data || []),
      ...(clientesRes.data || []),
    ]) {
      if (row.organization_id) activeRecently.add(row.organization_id)
    }

    // 3. Bulk: emails RE_ENGAGEMENT_INACTIVE enviados en los últimos RESEND_COOLDOWN_DAYS.
    const { data: recentEmails } = await supabaseAdmin
      .from("lifecycle_emails")
      .select("organization_id")
      .eq("email_type", EMAIL_TYPE)
      .eq("status", "SENT")
      .gte("sent_at", resendCutoff.toISOString())
      .in("organization_id", orgIds)

    const recentlyEmailed = new Set<string>((recentEmails || []).map((r) => r.organization_id))

    // 4. Bulk: admins.
    const { data: admins } = await supabaseAdmin
      .from("users")
      .select("id, nombre, email, organization_id, created_at")
      .in("organization_id", orgIds)
      .eq("rol", "ADMIN")
      .order("created_at", { ascending: true })

    const adminByOrg = new Map<string, { id: string; nombre: string; email: string }>()
    for (const a of admins || []) {
      if (!a.email) continue
      if (!adminByOrg.has(a.organization_id)) {
        adminByOrg.set(a.organization_id, { id: a.id, nombre: a.nombre, email: a.email })
      }
    }

    // 5. Loop: filtra y envía.
    for (const org of allOrgs) {
      results.processed++

      if (activeRecently.has(org.id)) {
        results.skippedActive++
        continue
      }
      if (recentlyEmailed.has(org.id)) {
        results.skippedRecent++
        continue
      }

      const admin = adminByOrg.get(org.id)
      const email = admin?.email || org.email
      if (!email) {
        results.skippedNoEmail++
        continue
      }

      const nombre = admin?.nombre || org.nombre || "amigo"

      // Kill switch via resolver. RE_ENGAGEMENT_INACTIVE arranca DRAFT → bloquea
      // hasta que el superadmin publique desde el panel.
      const data = {
        nombre,
        organizacion: org.nombre || "",
        slug: org.slug || "",
      }
      const resolved = await resolveTemplate(EMAIL_TYPE, data, () =>
        buildReEngagementEmail({ nombre, slug: org.slug })
      )

      if (!resolved) {
        await supabaseAdmin.from("lifecycle_emails").insert({
          organization_id: org.id,
          user_id: admin?.id || null,
          email_type: EMAIL_TYPE,
          status: "SKIPPED_DRAFT",
        })
        results.skippedDraft++
        continue
      }

      const sent = await sendEmail(email, resolved.subject, resolved.html)
      await supabaseAdmin.from("lifecycle_emails").insert({
        organization_id: org.id,
        user_id: admin?.id || null,
        email_type: EMAIL_TYPE,
        status: sent ? "SENT" : "FAILED",
      })

      if (sent) results.sent++
      else results.failed++
    }

    return NextResponse.json({
      success: true,
      results,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error("Error en cron re-engagement:", error)
    return NextResponse.json(
      { error: "Error procesando re-engagement" },
      { status: 500 }
    )
  }
}

// ============================================
// Email template: RE_ENGAGEMENT_INACTIVE
// Gradient suave púrpura/indigo. Tono amable, no urgente.
// ============================================
function buildReEngagementEmail({
  nombre,
  slug,
}: {
  nombre: string
  slug: string | null
}): { subject: string; html: string } {
  const appUrl = slug ? `https://${slug}.${ROOT_DOMAIN}` : `https://${ROOT_DOMAIN}`
  const subject = "Hace 2 semanas que no entrás a STApp — todo sigue acá"
  const safeNombre = escapeHtml(nombre)
  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f3f4f6;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;"><tr><td align="center" style="padding:40px 20px;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">
<tr><td style="background:linear-gradient(135deg,#8b5cf6,#6366f1);padding:32px 40px;text-align:center;border-radius:16px 16px 0 0;">
<table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>
<td style="vertical-align:middle;padding-right:10px;"><img src="https://${ROOT_DOMAIN}/icon-192.png" style="height:36px;width:36px;border-radius:8px;" alt="" /></td>
<td style="vertical-align:middle;"><span style="color:#fff;font-size:24px;font-weight:700;">STApp</span></td>
</tr></table></td></tr>
<tr><td style="background:#fff;padding:40px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 16px 16px;">
<h1 style="color:#1f2937;font-size:24px;font-weight:700;text-align:center;margin:0 0 16px;">Te extrañamos en STApp</h1>
<p style="color:#4b5563;font-size:16px;text-align:center;margin:0 0 20px;">Hola <strong>${safeNombre}</strong>, vimos que hace un par de semanas que no entrás. Todo sigue como lo dejaste: clientes, órdenes, inventario y configuraciones.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;"><tr>
<td style="background:#f5f3ff;padding:20px;border-radius:12px;border:1px solid #ddd6fe;">
<p style="color:#5b21b6;font-size:15px;margin:0 0 8px;font-weight:600;">Cuando vuelvas podés:</p>
<table width="100%" cellpadding="0" cellspacing="0">
<tr><td style="color:#6d28d9;font-size:14px;padding:4px 0;">• Cargar una orden nueva en 30 segundos</td></tr>
<tr><td style="color:#6d28d9;font-size:14px;padding:4px 0;">• Sumar un cliente al portal de seguimiento</td></tr>
<tr><td style="color:#6d28d9;font-size:14px;padding:4px 0;">• Ver tus reportes y métricas del mes</td></tr>
<tr><td style="color:#6d28d9;font-size:14px;padding:4px 0;">• Cobrar con POS y emitir cotizaciones</td></tr>
</table></td></tr></table>
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:8px 0 16px;">
<a href="${appUrl}" style="background:#8b5cf6;color:#fff;padding:16px 32px;text-decoration:none;border-radius:10px;font-weight:600;font-size:16px;display:inline-block;">Volver a STApp</a>
</td></tr></table>
<p style="color:#9ca3af;font-size:13px;text-align:center;margin:24px 0 0;">Si STApp ya no te sirve, no pasa nada. Solo queríamos avisarte que sigue todo acá.</p>
</td></tr>
<tr><td style="padding:24px 40px;text-align:center;"><p style="color:#9ca3af;font-size:13px;margin:0;">Este correo fue enviado automáticamente por STApp.</p></td></tr>
</table></td></tr></table></body></html>`
  return { subject, html }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}
