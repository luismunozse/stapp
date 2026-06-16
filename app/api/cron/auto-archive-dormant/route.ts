import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { resolveTemplate } from "@/lib/emails/template-resolver"
import { requireCronAuth } from "@/lib/cron-auth"
import {
  classifyDormantOrg,
  DORMANT_DAYS,
  ARCHIVE_GRACE_DAYS,
} from "@/lib/dormancy"

const ENVIALOSIMPLE_API_URL = "https://backend.envialosimple.email/api/v1/mail/send"
const EMAIL_FROM = process.env.EMAIL_FROM || "noreply@stapp.com.ar"
const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "stapp.com.ar"

const EMAIL_TYPE = "ARCHIVAL_WARNING"

// Hard safety switch. While false the cron is a DRY RUN: it computes and
// reports candidates but sends no emails, stamps no warnings, and archives
// nothing. Flip AUTO_ARCHIVE_DORMANT_ENABLED=true (env) to act. Even then,
// archiving also requires the ARCHIVAL_WARNING email template to be PUBLISHED
// (kill switch via resolveTemplate) — no warning delivered, no archive.
const ENABLED = process.env.AUTO_ARCHIVE_DORMANT_ENABLED === "true"

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
    const dormancyCutoff = new Date(now)
    dormancyCutoff.setDate(dormancyCutoff.getDate() - DORMANT_DAYS)

    const results = {
      dryRun: !ENABLED,
      processed: 0,
      warned: 0,
      archived: 0,
      reprieved: 0,
      skippedDraft: 0,
      skippedNoEmail: 0,
    }

    // 1. Candidate orgs: active, not the admin org, not already archived.
    const { data: allOrgs } = await supabaseAdmin
      .from("organizations")
      .select("id, nombre, slug, email, archival_warned_at")
      .eq("activo", true)
      .neq("slug", "superadmin")
      .is("deleted_at", null)

    if (!allOrgs || allOrgs.length === 0) {
      return NextResponse.json({ success: true, results })
    }

    const orgIds = allOrgs.map((o) => o.id)

    // 2. Orgs that EVER had a payment row → not eligible (never archive a payer).
    const { data: paidRows } = await supabaseAdmin
      .from("subscription_payments")
      .select("organization_id")
      .in("organization_id", orgIds)
    const paidOrgIds = new Set<string>((paidRows || []).map((r) => r.organization_id))

    // 3. Activity within the dormancy window. audit_logs covers logins/any
    //    action, so an org that logs in but creates nothing still counts active.
    const [ordenesRes, ventasRes, clientesRes, auditRes] = await Promise.all([
      supabaseAdmin
        .from("ordenes_servicio")
        .select("organization_id")
        .in("organization_id", orgIds)
        .gte("created_at", dormancyCutoff.toISOString()),
      supabaseAdmin
        .from("ventas")
        .select("organization_id")
        .in("organization_id", orgIds)
        .gte("created_at", dormancyCutoff.toISOString()),
      supabaseAdmin
        .from("clientes")
        .select("organization_id")
        .in("organization_id", orgIds)
        .gte("created_at", dormancyCutoff.toISOString()),
      supabaseAdmin
        .from("audit_logs")
        .select("organization_id")
        .in("organization_id", orgIds)
        .gte("created_at", dormancyCutoff.toISOString()),
    ])

    const activeRecently = new Set<string>()
    for (const row of [
      ...(ordenesRes.data || []),
      ...(ventasRes.data || []),
      ...(clientesRes.data || []),
      ...(auditRes.data || []),
    ]) {
      if (row.organization_id) activeRecently.add(row.organization_id)
    }

    // 4. Admin contacts for the warning email.
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

    // 5. Classify + act per org.
    for (const org of allOrgs) {
      results.processed++

      const action = classifyDormantOrg({
        eligible: !paidOrgIds.has(org.id),
        activeRecently: activeRecently.has(org.id),
        warnedAt: org.archival_warned_at ? new Date(org.archival_warned_at) : null,
        now,
      })

      if (action === "none") continue

      // DRY RUN: tally what WOULD happen, touch nothing.
      if (!ENABLED) {
        if (action === "warn") results.warned++
        else if (action === "archive") results.archived++
        else if (action === "reprieve") results.reprieved++
        continue
      }

      if (action === "reprieve") {
        await supabaseAdmin
          .from("organizations")
          .update({ archival_warned_at: null })
          .eq("id", org.id)
        results.reprieved++
        continue
      }

      if (action === "warn") {
        const admin = adminByOrg.get(org.id)
        const email = admin?.email || org.email
        if (!email) {
          results.skippedNoEmail++
          continue
        }

        // Kill switch: ARCHIVAL_WARNING is BLOCKED until a PUBLISHED template
        // exists. If blocked we do NOT stamp archival_warned_at — no archiving
        // can ever happen without a delivered warning.
        const resolved = await resolveTemplate(
          EMAIL_TYPE,
          { nombre: admin?.nombre || org.nombre || "", organizacion: org.nombre || "", slug: org.slug || "" },
          () =>
            buildArchivalWarningEmail({
              nombre: admin?.nombre || org.nombre || "amigo",
              slug: org.slug,
            })
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

        // Only start the archival clock once the warning actually went out.
        if (sent) {
          await supabaseAdmin
            .from("organizations")
            .update({ archival_warned_at: now.toISOString() })
            .eq("id", org.id)
          results.warned++
        }
        continue
      }

      if (action === "archive") {
        const reason = `Auto-archivado: ${DORMANT_DAYS}d sin actividad + ${ARCHIVE_GRACE_DAYS}d tras aviso`
        const { data: archived } = await supabaseAdmin
          .from("organizations")
          .update({
            deleted_at: now.toISOString(),
            deleted_by: "system:auto-archive",
            archived_reason: reason,
          })
          .eq("id", org.id)
          .is("deleted_at", null)
          .select("id")

        if (archived && archived.length > 0) {
          await supabaseAdmin.from("audit_logs").insert({
            organization_id: org.id,
            user_id: null,
            action: "ARCHIVE",
            entity: "organizations",
            entity_id: org.id,
            changes: {
              reason,
              auto: true,
              superadmin_email: "system:auto-archive",
            },
          })
          results.archived++
        }
        continue
      }
    }

    return NextResponse.json({ success: true, results, timestamp: now.toISOString() })
  } catch (error) {
    console.error("Error en cron auto-archive-dormant:", error)
    return NextResponse.json({ error: "Error procesando auto-archivado" }, { status: 500 })
  }
}

// ============================================
// Email template: ARCHIVAL_WARNING (fallback)
// Used only if a PUBLISHED email_templates row exists with an empty body.
// Otherwise the resolver blocks the send (kill switch).
// ============================================
function buildArchivalWarningEmail({
  nombre,
  slug,
}: {
  nombre: string
  slug: string | null
}): { subject: string; html: string } {
  const appUrl = slug ? `https://${slug}.${ROOT_DOMAIN}` : `https://${ROOT_DOMAIN}`
  const subject = `Tu cuenta STApp lleva ${DORMANT_DAYS} días inactiva — la archivaremos en ${ARCHIVE_GRACE_DAYS} días`
  const safeNombre = escapeHtml(nombre)
  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f3f4f6;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;"><tr><td align="center" style="padding:40px 20px;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">
<tr><td style="background:linear-gradient(135deg,#f59e0b,#d97706);padding:32px 40px;text-align:center;border-radius:16px 16px 0 0;">
<span style="color:#fff;font-size:24px;font-weight:700;">STApp</span></td></tr>
<tr><td style="background:#fff;padding:40px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 16px 16px;">
<h1 style="color:#1f2937;font-size:22px;font-weight:700;text-align:center;margin:0 0 16px;">Tu cuenta está por archivarse</h1>
<p style="color:#4b5563;font-size:16px;text-align:center;margin:0 0 20px;">Hola <strong>${safeNombre}</strong>, hace ${DORMANT_DAYS} días que no registramos actividad en tu cuenta. Si no volvés en los próximos <strong>${ARCHIVE_GRACE_DAYS} días</strong>, la archivaremos.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;"><tr>
<td style="background:#fffbeb;padding:20px;border-radius:12px;border:1px solid #fde68a;">
<p style="color:#92400e;font-size:14px;margin:0;">Archivar es reversible: tus datos se conservan y podés pedir la restauración. Pero para evitarlo, simplemente entrá y seguí trabajando.</p>
</td></tr></table>
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:8px 0 16px;">
<a href="${appUrl}" style="background:#f59e0b;color:#fff;padding:16px 32px;text-decoration:none;border-radius:10px;font-weight:600;font-size:16px;display:inline-block;">Mantener mi cuenta activa</a>
</td></tr></table>
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
