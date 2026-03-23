import { NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"

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
      // 0 - Engagement scores últimos 30 días (promedio por org)
      supabaseAdmin
        .from("organization_engagement")
        .select("organization_id, engagement_score, fecha, ordenes_creadas, ventas_realizadas, usuarios_activos")
        .gte("fecha", thirtyDaysAgo.toISOString().split("T")[0])
        .order("fecha", { ascending: false }),

      // 1 - Organizaciones con info
      supabaseAdmin
        .from("organizations")
        .select("id, nombre, slug, activo, created_at")
        .eq("activo", true),

      // 2 - Suscripciones con plan
      supabaseAdmin
        .from("subscriptions")
        .select("organization_id, status, plans(tipo)")
        .in("status", ["ACTIVE", "TRIALING"]),

      // 3 - Lifecycle emails enviados últimos 30 días
      supabaseAdmin
        .from("lifecycle_emails")
        .select("email_type, status, sent_at")
        .gte("sent_at", thirtyDaysAgo.toISOString()),

      // 4 - Orgs que cancelaron (churn)
      supabaseAdmin
        .from("subscriptions")
        .select("organization_id, canceled_at, organizations(nombre, slug)")
        .eq("status", "CANCELED")
        .not("canceled_at", "is", null)
        .gte("canceled_at", thirtyDaysAgo.toISOString()),

      // 5 - Últimas órdenes por org (para detectar inactividad)
      supabaseAdmin.rpc("get_last_activity_per_org" as never),
    ])

    const safeValue = <T,>(result: PromiseSettledResult<T>): T | null =>
      result.status === "fulfilled" ? result.value : null

    const engagementData = (safeValue(results[0]) as { data: Array<{
      organization_id: string
      engagement_score: number
      fecha: string
      ordenes_creadas: number
      ventas_realizadas: number
      usuarios_activos: number
    }> } | null)?.data || []

    const orgs = (safeValue(results[1]) as { data: Array<{
      id: string
      nombre: string
      slug: string
      activo: boolean
      created_at: string
    }> } | null)?.data || []

    const subs = (safeValue(results[2]) as { data: Array<{
      organization_id: string
      status: string
      plans: { tipo: string } | { tipo: string }[]
    }> } | null)?.data || []

    const lifecycleData = (safeValue(results[3]) as { data: Array<{
      email_type: string
      status: string
      sent_at: string
    }> } | null)?.data || []

    const churned = (safeValue(results[4]) as { data: Array<{
      organization_id: string
      canceled_at: string
      organizations: { nombre: string; slug: string }
    }> } | null)?.data || []

    // Calcular métricas por organización
    const orgMap = new Map(orgs.map(o => [o.id, o]))
    const subMap = new Map(subs.map(s => [s.organization_id, s]))

    // Engagement promedio por org (últimos 7 días)
    const orgEngagement: Record<string, { scores: number[]; ordenes: number; ventas: number; usuarios: number }> = {}
    for (const e of engagementData) {
      if (new Date(e.fecha) >= sevenDaysAgo) {
        if (!orgEngagement[e.organization_id]) {
          orgEngagement[e.organization_id] = { scores: [], ordenes: 0, ventas: 0, usuarios: 0 }
        }
        orgEngagement[e.organization_id].scores.push(e.engagement_score)
        orgEngagement[e.organization_id].ordenes += e.ordenes_creadas
        orgEngagement[e.organization_id].ventas += e.ventas_realizadas
        orgEngagement[e.organization_id].usuarios = Math.max(orgEngagement[e.organization_id].usuarios, e.usuarios_activos)
      }
    }

    // Construir lista de orgs con engagement
    const orgList = orgs.map(org => {
      const engagement = orgEngagement[org.id]
      const sub = subMap.get(org.id)
      const planType = sub ? (Array.isArray(sub.plans) ? sub.plans[0]?.tipo : (sub.plans as { tipo: string })?.tipo) : "FREE"
      const avgScore = engagement
        ? Math.round(engagement.scores.reduce((a, b) => a + b, 0) / engagement.scores.length)
        : 0

      return {
        id: org.id,
        nombre: org.nombre,
        slug: org.slug,
        plan: planType || "FREE",
        subscriptionStatus: sub?.status || "NONE",
        avgEngagement7d: avgScore,
        ordenes7d: engagement?.ordenes || 0,
        ventas7d: engagement?.ventas || 0,
        usuariosActivos: engagement?.usuarios || 0,
        createdAt: org.created_at,
        riesgo: avgScore === 0 ? "alto" : avgScore < 20 ? "medio" : "bajo",
      }
    })

    // Engagement trend (últimos 30 días, agrupado por día)
    const engagementTrend: Record<string, { totalScore: number; count: number; ordenes: number }> = {}
    for (const e of engagementData) {
      if (!engagementTrend[e.fecha]) {
        engagementTrend[e.fecha] = { totalScore: 0, count: 0, ordenes: 0 }
      }
      engagementTrend[e.fecha].totalScore += e.engagement_score
      engagementTrend[e.fecha].count++
      engagementTrend[e.fecha].ordenes += e.ordenes_creadas
    }

    const trend = Object.entries(engagementTrend)
      .map(([fecha, data]) => ({
        fecha,
        avgScore: Math.round(data.totalScore / data.count),
        totalOrdenes: data.ordenes,
        orgsActivas: data.count,
      }))
      .sort((a, b) => a.fecha.localeCompare(b.fecha))

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
      },
      organizations: orgList.sort((a, b) => a.avgEngagement7d - b.avgEngagement7d),
      trend,
      emailStats,
      churned: churned.map(c => ({
        organizationId: c.organization_id,
        nombre: (c.organizations as { nombre: string })?.nombre || "Unknown",
        canceledAt: c.canceled_at,
      })),
    })
  } catch (error) {
    console.error("Error fetching engagement stats:", error)
    return NextResponse.json(
      { error: "Error al obtener estadísticas de engagement" },
      { status: 500 }
    )
  }
}
