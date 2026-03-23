import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { getLifecycleEmail, type LifecycleEmailType } from "@/lib/emails/lifecycle-templates"

const ENVIALOSIMPLE_API_URL = "https://backend.envialosimple.email/api/v1/mail/send"
const EMAIL_FROM = process.env.EMAIL_FROM || "noreply@stapp.com.ar"

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
  // Verificar autenticación del cron
  const authHeader = request.headers.get("authorization")
  const expectedKey = process.env.CRON_SECRET
  if (expectedKey && authHeader !== `Bearer ${expectedKey}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }

  try {
    const now = new Date()
    const results = {
      welcome: 0, tipDay3: 0, tipDay7: 0,
      trialExpiring5: 0, trialExpiring1: 0, trialExpired: 0,
      winBack7: 0, winBack30: 0, milestones: 0,
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
