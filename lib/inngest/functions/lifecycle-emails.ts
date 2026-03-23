import { inngest } from "../client"
import { supabaseAdmin } from "@/lib/supabase"
import { getLifecycleEmail, type LifecycleEmailType } from "@/lib/emails/lifecycle-templates"

const ENVIALOSIMPLE_API_URL = "https://backend.envialosimple.email/api/v1/mail/send"
const EMAIL_FROM = process.env.EMAIL_FROM || "noreply@stapp.com.ar"

async function sendLifecycleEmail(to: string, subject: string, html: string) {
  const apiKey = process.env.ENVIALOSIMPLE_API_KEY
  if (!apiKey) {
    console.error("ENVIALOSIMPLE_API_KEY no configurada")
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
    console.error("Error enviando lifecycle email:", error)
    return false
  }
}

async function wasEmailAlreadySent(
  organizationId: string,
  emailType: string,
  userId?: string
): Promise<boolean> {
  const query = supabaseAdmin
    .from("lifecycle_emails")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("email_type", emailType)
    .eq("status", "SENT")

  if (userId) {
    query.eq("user_id", userId)
  }

  const { count } = await query
  return (count || 0) > 0
}

async function logLifecycleEmail(
  organizationId: string,
  emailType: string,
  status: "SENT" | "FAILED",
  userId?: string,
  metadata?: Record<string, unknown>
) {
  await supabaseAdmin.from("lifecycle_emails").insert({
    organization_id: organizationId,
    user_id: userId || null,
    email_type: emailType,
    status,
    metadata: metadata || {},
  })
}

/**
 * Cron diario: Lifecycle emails para onboarding y retención
 * Se ejecuta todos los días a las 11:00 AM
 */
export const lifecycleEmails = inngest.createFunction(
  {
    id: "lifecycle-emails",
    name: "Lifecycle Emails - Onboarding & Retention",
    retries: 1,
  },
  { cron: "0 11 * * *" },
  async ({ step }) => {
    const now = new Date()
    const results = {
      welcome: 0,
      tipDay3: 0,
      tipDay7: 0,
      trialExpiring5: 0,
      trialExpiring1: 0,
      trialExpired: 0,
      winBack7: 0,
      winBack30: 0,
      milestones: 0,
    }

    // ============================================
    // 1. WELCOME EMAIL (organizaciones creadas ayer)
    // ============================================
    await step.run("welcome-emails", async () => {
      const yesterday = new Date(now)
      yesterday.setDate(yesterday.getDate() - 1)
      yesterday.setHours(0, 0, 0, 0)
      const today = new Date(now)
      today.setHours(0, 0, 0, 0)

      const { data: newOrgs } = await supabaseAdmin
        .from("organizations")
        .select("id, nombre, slug")
        .gte("created_at", yesterday.toISOString())
        .lt("created_at", today.toISOString())
        .eq("activo", true)

      for (const org of newOrgs || []) {
        const alreadySent = await wasEmailAlreadySent(org.id, "WELCOME")
        if (alreadySent) continue

        // Obtener admin de la org
        const { data: admins } = await supabaseAdmin
          .from("users")
          .select("id, nombre, email")
          .eq("organization_id", org.id)
          .eq("rol", "ADMIN")
          .limit(1)

        const admin = admins?.[0]
        if (!admin?.email) continue

        const { subject, html } = getLifecycleEmail("WELCOME", {
          nombre: admin.nombre,
          organizacion: org.nombre,
          slug: org.slug,
        })

        const sent = await sendLifecycleEmail(admin.email, subject, html)
        await logLifecycleEmail(org.id, "WELCOME", sent ? "SENT" : "FAILED", admin.id)
        if (sent) results.welcome++
      }
    })

    // ============================================
    // 2. TIP DAY 3 (organizaciones creadas hace 3 días)
    // ============================================
    await step.run("tip-day-3", async () => {
      const targetDate = new Date(now)
      targetDate.setDate(targetDate.getDate() - 3)
      const targetStart = new Date(targetDate)
      targetStart.setHours(0, 0, 0, 0)
      const targetEnd = new Date(targetDate)
      targetEnd.setHours(23, 59, 59, 999)

      const { data: orgs } = await supabaseAdmin
        .from("organizations")
        .select("id, nombre, slug")
        .gte("created_at", targetStart.toISOString())
        .lte("created_at", targetEnd.toISOString())
        .eq("activo", true)

      for (const org of orgs || []) {
        const alreadySent = await wasEmailAlreadySent(org.id, "TIP_DAY_3")
        if (alreadySent) continue

        const { data: admins } = await supabaseAdmin
          .from("users")
          .select("id, nombre, email")
          .eq("organization_id", org.id)
          .eq("rol", "ADMIN")
          .limit(1)

        const admin = admins?.[0]
        if (!admin?.email) continue

        const { subject, html } = getLifecycleEmail("TIP_DAY_3", {
          nombre: admin.nombre,
          organizacion: org.nombre,
          slug: org.slug,
        })

        const sent = await sendLifecycleEmail(admin.email, subject, html)
        await logLifecycleEmail(org.id, "TIP_DAY_3", sent ? "SENT" : "FAILED", admin.id)
        if (sent) results.tipDay3++
      }
    })

    // ============================================
    // 3. TIP DAY 7 (organizaciones creadas hace 7 días)
    // ============================================
    await step.run("tip-day-7", async () => {
      const targetDate = new Date(now)
      targetDate.setDate(targetDate.getDate() - 7)
      const targetStart = new Date(targetDate)
      targetStart.setHours(0, 0, 0, 0)
      const targetEnd = new Date(targetDate)
      targetEnd.setHours(23, 59, 59, 999)

      const { data: orgs } = await supabaseAdmin
        .from("organizations")
        .select("id, nombre, slug")
        .gte("created_at", targetStart.toISOString())
        .lte("created_at", targetEnd.toISOString())
        .eq("activo", true)

      for (const org of orgs || []) {
        const alreadySent = await wasEmailAlreadySent(org.id, "TIP_DAY_7")
        if (alreadySent) continue

        const { data: admins } = await supabaseAdmin
          .from("users")
          .select("id, nombre, email")
          .eq("organization_id", org.id)
          .eq("rol", "ADMIN")
          .limit(1)

        const admin = admins?.[0]
        if (!admin?.email) continue

        const { subject, html } = getLifecycleEmail("TIP_DAY_7", {
          nombre: admin.nombre,
          organizacion: org.nombre,
          slug: org.slug,
        })

        const sent = await sendLifecycleEmail(admin.email, subject, html)
        await logLifecycleEmail(org.id, "TIP_DAY_7", sent ? "SENT" : "FAILED", admin.id)
        if (sent) results.tipDay7++
      }
    })

    // ============================================
    // 4. TRIAL EXPIRING (5 días y 1 día antes)
    // ============================================
    await step.run("trial-expiring", async () => {
      const { data: trialingSubs } = await supabaseAdmin
        .from("subscriptions")
        .select(`
          id, organization_id, trial_end,
          organizations (id, nombre, slug, activo)
        `)
        .eq("status", "TRIALING")
        .not("trial_end", "is", null)

      for (const sub of trialingSubs || []) {
        if (!sub.trial_end) continue
        const org = sub.organizations as unknown as { id: string; nombre: string; slug: string; activo: boolean }
        if (!org?.activo) continue

        const trialEnd = new Date(sub.trial_end)
        const daysLeft = Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

        let emailType: LifecycleEmailType | null = null
        if (daysLeft === 5) emailType = "TRIAL_EXPIRING_5"
        else if (daysLeft === 1) emailType = "TRIAL_EXPIRING_1"
        else if (daysLeft <= 0) emailType = "TRIAL_EXPIRED"
        else continue

        const alreadySent = await wasEmailAlreadySent(org.id, emailType)
        if (alreadySent) continue

        const { data: admins } = await supabaseAdmin
          .from("users")
          .select("id, nombre, email")
          .eq("organization_id", org.id)
          .eq("rol", "ADMIN")
          .limit(1)

        const admin = admins?.[0]
        if (!admin?.email) continue

        const { subject, html } = getLifecycleEmail(emailType, {
          nombre: admin.nombre,
          organizacion: org.nombre,
          slug: org.slug,
          diasRestantes: Math.max(daysLeft, 0),
        })

        const sent = await sendLifecycleEmail(admin.email, subject, html)
        await logLifecycleEmail(org.id, emailType, sent ? "SENT" : "FAILED", admin.id)
        if (sent) {
          if (emailType === "TRIAL_EXPIRING_5") results.trialExpiring5++
          else if (emailType === "TRIAL_EXPIRING_1") results.trialExpiring1++
          else results.trialExpired++
        }
      }
    })

    // ============================================
    // 5. WIN-BACK (organizaciones inactivas)
    // ============================================
    await step.run("win-back-emails", async () => {
      // Buscar orgs activas con suscripción activa/trial que no tienen actividad reciente
      const { data: allOrgs } = await supabaseAdmin
        .from("organizations")
        .select("id, nombre, slug")
        .eq("activo", true)

      for (const org of allOrgs || []) {
        // Ver última actividad (última orden creada)
        const { data: lastOrder } = await supabaseAdmin
          .from("ordenes_servicio")
          .select("created_at")
          .eq("organization_id", org.id)
          .order("created_at", { ascending: false })
          .limit(1)

        if (!lastOrder || lastOrder.length === 0) continue

        const lastActivity = new Date(lastOrder[0].created_at)
        const daysSinceActivity = Math.floor((now.getTime() - lastActivity.getTime()) / (1000 * 60 * 60 * 24))

        let emailType: LifecycleEmailType | null = null
        if (daysSinceActivity >= 28 && daysSinceActivity <= 32) emailType = "WIN_BACK_30"
        else if (daysSinceActivity >= 6 && daysSinceActivity <= 8) emailType = "WIN_BACK_7"
        else continue

        const alreadySent = await wasEmailAlreadySent(org.id, emailType)
        if (alreadySent) continue

        const { data: admins } = await supabaseAdmin
          .from("users")
          .select("id, nombre, email")
          .eq("organization_id", org.id)
          .eq("rol", "ADMIN")
          .limit(1)

        const admin = admins?.[0]
        if (!admin?.email) continue

        const { subject, html } = getLifecycleEmail(emailType, {
          nombre: admin.nombre,
          organizacion: org.nombre,
          slug: org.slug,
        })

        const sent = await sendLifecycleEmail(admin.email, subject, html)
        await logLifecycleEmail(org.id, emailType, sent ? "SENT" : "FAILED", admin.id)
        if (sent) {
          if (emailType === "WIN_BACK_7") results.winBack7++
          else results.winBack30++
        }
      }
    })

    // ============================================
    // 6. MILESTONES (hitos de uso)
    // ============================================
    await step.run("milestone-emails", async () => {
      const milestoneThresholds = [50, 100, 250, 500, 1000]

      const { data: allOrgs } = await supabaseAdmin
        .from("organizations")
        .select("id, nombre, slug")
        .eq("activo", true)

      for (const org of allOrgs || []) {
        // Contar órdenes totales
        const { count: ordenesCount } = await supabaseAdmin
          .from("ordenes_servicio")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", org.id)

        const total = ordenesCount || 0

        // Verificar si cruzó algún milestone
        for (const threshold of milestoneThresholds) {
          if (total >= threshold && total < threshold + 5) {
            const milestoneKey = `MILESTONE_ORDENES_${threshold}`
            const alreadySent = await wasEmailAlreadySent(org.id, milestoneKey)
            if (alreadySent) continue

            const { data: admins } = await supabaseAdmin
              .from("users")
              .select("id, nombre, email")
              .eq("organization_id", org.id)
              .eq("rol", "ADMIN")
              .limit(1)

            const admin = admins?.[0]
            if (!admin?.email) continue

            const { subject, html } = getLifecycleEmail("MILESTONE", {
              nombre: admin.nombre,
              organizacion: org.nombre,
              slug: org.slug,
              milestone: { tipo: "ordenes", valor: threshold },
            })

            const sent = await sendLifecycleEmail(admin.email, subject, html)
            await logLifecycleEmail(org.id, milestoneKey, sent ? "SENT" : "FAILED", admin.id)
            if (sent) results.milestones++
            break // Solo un milestone por org por día
          }
        }
      }
    })

    return { success: true, results }
  }
)

/**
 * Cron diario: Calcular engagement score por organización
 * Se ejecuta todos los días a las 2:00 AM
 */
export const calculateEngagement = inngest.createFunction(
  {
    id: "calculate-engagement",
    name: "Calculate Daily Engagement Scores",
    retries: 1,
  },
  { cron: "0 2 * * *" },
  async ({ step }) => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const fechaStr = yesterday.toISOString().split("T")[0]

    const orgsProcessed = await step.run("calculate-scores", async () => {
      const { data: orgs } = await supabaseAdmin
        .from("organizations")
        .select("id")
        .eq("activo", true)

      let processed = 0

      for (const org of orgs || []) {
        const yesterdayStart = new Date(fechaStr + "T00:00:00Z")
        const yesterdayEnd = new Date(fechaStr + "T23:59:59Z")

        // Obtener métricas del día anterior en paralelo
        const [ordenesRes, completadasRes, ventasRes, clientesRes] = await Promise.all([
          supabaseAdmin
            .from("ordenes_servicio")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", org.id)
            .gte("created_at", yesterdayStart.toISOString())
            .lte("created_at", yesterdayEnd.toISOString()),
          supabaseAdmin
            .from("ordenes_servicio")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", org.id)
            .eq("estado", "ENTREGADO")
            .gte("updated_at", yesterdayStart.toISOString())
            .lte("updated_at", yesterdayEnd.toISOString()),
          supabaseAdmin
            .from("ventas")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", org.id)
            .gte("created_at", yesterdayStart.toISOString())
            .lte("created_at", yesterdayEnd.toISOString()),
          supabaseAdmin
            .from("clientes")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", org.id)
            .gte("created_at", yesterdayStart.toISOString())
            .lte("created_at", yesterdayEnd.toISOString()),
        ])

        const ordenes = ordenesRes.count || 0
        const completadas = completadasRes.count || 0
        const ventas = ventasRes.count || 0
        const clientes = clientesRes.count || 0

        // Contar usuarios que estuvieron activos (crearon/actualizaron algo)
        const { data: activeUsers } = await supabaseAdmin
          .from("audit_logs")
          .select("user_id")
          .eq("organization_id", org.id)
          .gte("created_at", yesterdayStart.toISOString())
          .lte("created_at", yesterdayEnd.toISOString())

        const uniqueUsers = new Set(activeUsers?.map(a => a.user_id).filter(Boolean) || [])
        const loginCount = uniqueUsers.size

        // Calcular score
        const score = Math.min(100,
          Math.min(loginCount * 10, 30) +
          Math.min(ordenes * 5, 25) +
          Math.min(completadas * 5, 20) +
          Math.min(ventas * 5, 15) +
          Math.min(clientes * 5, 10)
        )

        // Upsert engagement
        await supabaseAdmin
          .from("organization_engagement")
          .upsert({
            organization_id: org.id,
            fecha: fechaStr,
            ordenes_creadas: ordenes,
            ordenes_completadas: completadas,
            ventas_realizadas: ventas,
            clientes_nuevos: clientes,
            usuarios_activos: loginCount,
            login_count: loginCount,
            engagement_score: score,
          }, {
            onConflict: "organization_id,fecha",
          })

        processed++
      }

      return processed
    })

    return { success: true, orgsProcessed, fecha: fechaStr }
  }
)
