import { NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"

// Datos cambian 1x/día (cuando corre el cron de engagement). Cache 1h.
export const revalidate = 3600

export async function GET() {
  try {
    const { error } = await requireSuperadmin()
    if (error) return error

    const now = new Date()
    const thirtyDaysAgo = new Date(now)
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    const sevenDaysAgo = new Date(now)
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    const results = await Promise.allSettled([
      // 0 - Organizaciones con info (excluye org del panel admin)
      supabaseAdmin
        .from("organizations")
        .select("id, nombre, slug, activo, created_at")
        .eq("activo", true)
        .neq("slug", "superadmin"),

      // 1 - Suscripciones con plan y trial_end
      supabaseAdmin
        .from("subscriptions")
        .select("organization_id, status, trial_end, plans(tipo)")
        .in("status", ["ACTIVE", "TRIALING"]),

      // 2 - Lifecycle emails enviados últimos 30 días
      supabaseAdmin
        .from("lifecycle_emails")
        .select("email_type, status, sent_at")
        .gte("sent_at", thirtyDaysAgo.toISOString()),

      // 3 - Orgs que cancelaron (churn)
      supabaseAdmin
        .from("subscriptions")
        .select("organization_id, canceled_at, organizations(nombre, slug)")
        .eq("status", "CANCELED")
        .not("canceled_at", "is", null)
        .gte("canceled_at", thirtyDaysAgo.toISOString()),

      // 4 - Órdenes últimos 30 días (actividad real)
      // Limit alto para evitar truncamiento silencioso por PostgREST (default 1000)
      supabaseAdmin
        .from("ordenes_servicio")
        .select("organization_id, estado, created_at, updated_at")
        .gte("created_at", thirtyDaysAgo.toISOString())
        .limit(10000),

      // 5 - Ventas últimos 30 días
      supabaseAdmin
        .from("ventas")
        .select("organization_id, created_at")
        .gte("created_at", thirtyDaysAgo.toISOString())
        .limit(10000),

      // 6 - Clientes nuevos últimos 30 días
      supabaseAdmin
        .from("clientes")
        .select("organization_id, created_at")
        .gte("created_at", thirtyDaysAgo.toISOString())
        .limit(10000),

      // 7 - Engagement pre-calculado (si existe, como complemento)
      supabaseAdmin
        .from("organization_engagement")
        .select("organization_id, engagement_score, fecha, ordenes_creadas, ventas_realizadas, usuarios_activos")
        .gte("fecha", thirtyDaysAgo.toISOString().split("T")[0])
        .order("fecha", { ascending: false })
        .limit(10000),

      // 8 - Trials vencidos sin conversión (últimos 30 días)
      supabaseAdmin
        .from("subscriptions")
        .select("organization_id, trial_end, organizations(nombre, slug)")
        .eq("status", "TRIALING")
        .lt("trial_end", now.toISOString()),
    ])

    const safeData = <T,>(result: PromiseSettledResult<{ data: T[] | null }>): T[] => {
      if (result.status === "fulfilled" && result.value.data) {
        return result.value.data
      }
      return []
    }

    const orgs = safeData<{ id: string; nombre: string; slug: string; activo: boolean; created_at: string }>(results[0] as never)
    const subs = safeData<{ organization_id: string; status: string; trial_end: string | null; plans: { tipo: string } | { tipo: string }[] }>(results[1] as never)
    const lifecycleData = safeData<{ email_type: string; status: string; sent_at: string }>(results[2] as never)
    const churned = safeData<{ organization_id: string; canceled_at: string; organizations: { nombre: string; slug: string } }>(results[3] as never)
    const ordenes = safeData<{ organization_id: string; estado: string; created_at: string; updated_at: string }>(results[4] as never)
    const ventas = safeData<{ organization_id: string; created_at: string }>(results[5] as never)
    const clientesNuevos = safeData<{ organization_id: string; created_at: string }>(results[6] as never)
    const engagementData = safeData<{ organization_id: string; engagement_score: number; fecha: string; ordenes_creadas: number; ventas_realizadas: number; usuarios_activos: number }>(results[7] as never)
    const expiredTrials = safeData<{ organization_id: string; trial_end: string; organizations: { nombre: string; slug: string } }>(results[8] as never)

    const subMap = new Map(subs.map(s => [s.organization_id, s]))

    // Calcular métricas REALES por org (últimos 7 días)
    const orgMetrics: Record<string, {
      ordenes7d: number
      ordenesCompletadas7d: number
      ventas7d: number
      clientesNuevos7d: number
      ordenes30d: number
      ventas30d: number
      ultimaActividad: string | null
    }> = {}

    for (const org of orgs) {
      orgMetrics[org.id] = {
        ordenes7d: 0,
        ordenesCompletadas7d: 0,
        ventas7d: 0,
        clientesNuevos7d: 0,
        ordenes30d: 0,
        ventas30d: 0,
        ultimaActividad: null,
      }
    }

    // Contar órdenes
    for (const o of ordenes) {
      const m = orgMetrics[o.organization_id]
      if (!m) continue
      m.ordenes30d++
      const actDate = o.updated_at || o.created_at
      if (!m.ultimaActividad || actDate > m.ultimaActividad) {
        m.ultimaActividad = actDate
      }
      if (new Date(o.created_at) >= sevenDaysAgo) {
        m.ordenes7d++
        if (o.estado === "ENTREGADO") {
          m.ordenesCompletadas7d++
        }
      }
    }

    // Contar ventas
    for (const v of ventas) {
      const m = orgMetrics[v.organization_id]
      if (!m) continue
      m.ventas30d++
      if (new Date(v.created_at) >= sevenDaysAgo) {
        m.ventas7d++
      }
      if (!m.ultimaActividad || v.created_at > m.ultimaActividad) {
        m.ultimaActividad = v.created_at
      }
    }

    // Contar clientes nuevos
    for (const c of clientesNuevos) {
      const m = orgMetrics[c.organization_id]
      if (!m) continue
      if (new Date(c.created_at) >= sevenDaysAgo) {
        m.clientesNuevos7d++
      }
    }

    // Calcular engagement score real por org
    function calculateScore(m: typeof orgMetrics[string]): number {
      const ordenesScore = Math.min(m.ordenes7d * 5, 30)
      const completadasScore = Math.min(m.ordenesCompletadas7d * 5, 20)
      const ventasScore = Math.min(m.ventas7d * 5, 20)
      const clientesScore = Math.min(m.clientesNuevos7d * 5, 15)
      let recienteScore = 0
      if (m.ultimaActividad) {
        const diasSinActividad = Math.floor((now.getTime() - new Date(m.ultimaActividad).getTime()) / (1000 * 60 * 60 * 24))
        if (diasSinActividad <= 1) recienteScore = 15
        else if (diasSinActividad <= 3) recienteScore = 10
        else if (diasSinActividad <= 7) recienteScore = 5
      }
      return Math.min(100, ordenesScore + completadasScore + ventasScore + clientesScore + recienteScore)
    }

    // Construir lista de orgs con engagement real
    const orgList = orgs.map(org => {
      const metrics = orgMetrics[org.id]
      const sub = subMap.get(org.id)
      const planType = sub ? (Array.isArray(sub.plans) ? sub.plans[0]?.tipo : (sub.plans as { tipo: string })?.tipo) : "FREE"
      const score = metrics ? calculateScore(metrics) : 0

      let riesgo: "alto" | "medio" | "bajo" = "bajo"
      if (score === 0) {
        const orgAge = Math.floor((now.getTime() - new Date(org.created_at).getTime()) / (1000 * 60 * 60 * 24))
        riesgo = orgAge < 7 ? "medio" : "alto"
      } else if (score < 20) {
        riesgo = "medio"
      }

      return {
        id: org.id,
        nombre: org.nombre,
        slug: org.slug,
        plan: planType || "FREE",
        subscriptionStatus: sub?.status || "NONE",
        trialEnd: sub?.trial_end || null,
        avgEngagement7d: score,
        ordenes7d: metrics?.ordenes7d || 0,
        ventas7d: metrics?.ventas7d || 0,
        ordenes30d: metrics?.ordenes30d || 0,
        ventas30d: metrics?.ventas30d || 0,
        ultimaActividad: metrics?.ultimaActividad || null,
        usuariosActivos: Math.max(metrics?.ordenes7d || 0, metrics?.ventas7d || 0) > 0 ? 1 : 0,
        createdAt: org.created_at,
        riesgo,
      }
    })

    // Engagement trend
    let trend: Array<{ fecha: string; avgScore: number; totalOrdenes: number; orgsActivas: number }> = []

    if (engagementData.length > 0) {
      const engagementTrend: Record<string, { totalScore: number; count: number; ordenes: number }> = {}
      for (const e of engagementData) {
        if (!engagementTrend[e.fecha]) {
          engagementTrend[e.fecha] = { totalScore: 0, count: 0, ordenes: 0 }
        }
        engagementTrend[e.fecha].totalScore += e.engagement_score
        engagementTrend[e.fecha].count++
        engagementTrend[e.fecha].ordenes += e.ordenes_creadas
      }

      trend = Object.entries(engagementTrend)
        .map(([fecha, d]) => ({
          fecha,
          avgScore: Math.round(d.totalScore / d.count),
          totalOrdenes: d.ordenes,
          orgsActivas: d.count,
        }))
        .sort((a, b) => a.fecha.localeCompare(b.fecha))
    } else {
      const dailyOrdenes: Record<string, { count: number; orgIds: Set<string> }> = {}
      for (const o of ordenes) {
        const fecha = o.created_at.split("T")[0]
        if (!dailyOrdenes[fecha]) {
          dailyOrdenes[fecha] = { count: 0, orgIds: new Set() }
        }
        dailyOrdenes[fecha].count++
        dailyOrdenes[fecha].orgIds.add(o.organization_id)
      }
      for (const v of ventas) {
        const fecha = v.created_at.split("T")[0]
        if (!dailyOrdenes[fecha]) {
          dailyOrdenes[fecha] = { count: 0, orgIds: new Set() }
        }
        dailyOrdenes[fecha].count++
        dailyOrdenes[fecha].orgIds.add(v.organization_id)
      }

      trend = Object.entries(dailyOrdenes)
        .map(([fecha, d]) => ({
          fecha,
          avgScore: Math.min(100, Math.round((d.count / Math.max(orgs.length, 1)) * 50)),
          totalOrdenes: d.count,
          orgsActivas: d.orgIds.size,
        }))
        .sort((a, b) => a.fecha.localeCompare(b.fecha))
    }

    // Último cálculo de engagement
    const lastCalculatedAt = engagementData.length > 0
      ? engagementData[0].fecha
      : null

    // Lifecycle emails stats
    const emailStats: Record<string, { sent: number; failed: number }> = {}
    for (const e of lifecycleData) {
      if (!emailStats[e.email_type]) {
        emailStats[e.email_type] = { sent: 0, failed: 0 }
      }
      if (e.status === "SENT") emailStats[e.email_type].sent++
      else emailStats[e.email_type].failed++
    }

    // Resumen
    const totalActive = orgs.length
    const highRisk = orgList.filter(o => o.riesgo === "alto").length
    const mediumRisk = orgList.filter(o => o.riesgo === "medio").length
    const avgEngagement = orgList.length > 0
      ? Math.round(orgList.reduce((s, o) => s + o.avgEngagement7d, 0) / orgList.length)
      : 0
    const churnRate = totalActive > 0
      ? Math.round((churned.length / (totalActive + churned.length)) * 100)
      : 0

    return NextResponse.json({
      summary: {
        totalActive,
        highRisk,
        mediumRisk,
        avgEngagement,
        churnRate,
        churnedThisMonth: churned.length,
        lastCalculatedAt,
      },
      organizations: orgList.sort((a, b) => a.avgEngagement7d - b.avgEngagement7d),
      trend,
      emailStats,
      churned: churned.map(c => ({
        organizationId: c.organization_id,
        nombre: (c.organizations as { nombre: string })?.nombre || "Unknown",
        canceledAt: c.canceled_at,
      })),
      trialsExpiredWithoutConversion: expiredTrials.length,
    })
  } catch (error) {
    console.error("Error fetching engagement stats:", error)
    return NextResponse.json(
      { error: "Error al obtener estadísticas de engagement" },
      { status: 500 }
    )
  }
}
