import { NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { fetchAllRows } from "@/lib/fetch-all-rows"

/** Lo que devuelve superadmin_engagement_metricas (migración 396). */
interface MetricasEngagement {
  orgs?: Array<{
    id: string
    nombre: string
    slug: string
    created_at: string
    sub_status: string | null
    trial_end: string | null
    plan_tipo: string | null
    ordenes7d: number
    ordenes_completadas7d: number
    ordenes30d: number
    ventas7d: number
    ventas30d: number
    clientes_nuevos7d: number
    ultima_actividad: string | null
  }>
  tendencia_engagement?: Array<{ fecha: string; suma_score: number; cantidad: number; ordenes: number }>
  ultimo_calculo?: string | null
  tendencia_actividad?: Array<{ fecha: string; total: number; orgs: number }>
  emails?: Record<string, { sent: number; failed: number }>
}

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

    // Conteos por org, tendencia y emails se resuelven en SQL
    // (superadmin_engagement_metricas). Antes se traían las filas de órdenes,
    // ventas, clientes, emails y engagement y se contaban en JS: PostgREST corta
    // cada lectura en 1000 filas sin error (el .limit(10000) no lo evita), y la
    // de órdenes además filtraba por created_at, que ordenes_servicio no tiene,
    // así que fallaba en silencio y las órdenes no contaban nunca.
    const [metricasRes, churned, expiredTrialsRes] = await Promise.all([
      supabaseAdmin.rpc("superadmin_engagement_metricas", {
        p_desde_30d: thirtyDaysAgo.toISOString(),
        p_desde_7d: sevenDaysAgo.toISOString(),
      }),

      // Orgs que cancelaron en los últimos 30 días (churn), paginado
      fetchAllRows<{ organization_id: string; canceled_at: string; organizations: { nombre: string; slug: string } | null }>(
        "subscriptions",
        "id, organization_id, canceled_at, organizations(nombre, slug)",
        (q) => q.eq("status", "CANCELED").not("canceled_at", "is", null).gte("canceled_at", thirtyDaysAgo.toISOString())
      ),

      // Trials vencidos sin conversión (solo el conteo)
      supabaseAdmin
        .from("subscriptions")
        .select("id", { count: "exact", head: true })
        .eq("status", "TRIALING")
        .lt("trial_end", now.toISOString()),
    ])

    if (metricasRes.error) throw metricasRes.error
    if (expiredTrialsRes.error) throw expiredTrialsRes.error

    const metricas = (metricasRes.data ?? {}) as MetricasEngagement
    const orgs = metricas.orgs ?? []

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
        ordenes7d: Number(org.ordenes7d) || 0,
        ordenesCompletadas7d: Number(org.ordenes_completadas7d) || 0,
        ventas7d: Number(org.ventas7d) || 0,
        clientesNuevos7d: Number(org.clientes_nuevos7d) || 0,
        ordenes30d: Number(org.ordenes30d) || 0,
        ventas30d: Number(org.ventas30d) || 0,
        ultimaActividad: org.ultima_actividad ?? null,
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
      const planType = org.sub_status ? org.plan_tipo : "FREE"
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
        subscriptionStatus: org.sub_status || "NONE",
        trialEnd: org.trial_end || null,
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

    // Engagement trend: el pre-calculado por el cron si existe; si no, la
    // actividad diaria (órdenes + ventas).
    const tendenciaEngagement = metricas.tendencia_engagement ?? []
    const trend: Array<{ fecha: string; avgScore: number; totalOrdenes: number; orgsActivas: number }> =
      tendenciaEngagement.length > 0
        ? tendenciaEngagement.map((t) => ({
            fecha: t.fecha,
            avgScore: Math.round(Number(t.suma_score) / Math.max(Number(t.cantidad), 1)),
            totalOrdenes: Number(t.ordenes) || 0,
            orgsActivas: Number(t.cantidad) || 0,
          }))
        : (metricas.tendencia_actividad ?? []).map((t) => ({
            fecha: t.fecha,
            avgScore: Math.min(100, Math.round((Number(t.total) / Math.max(orgs.length, 1)) * 50)),
            totalOrdenes: Number(t.total) || 0,
            orgsActivas: Number(t.orgs) || 0,
          }))

    // Último cálculo de engagement
    const lastCalculatedAt = metricas.ultimo_calculo ?? null

    // Lifecycle emails stats
    const emailStats: Record<string, { sent: number; failed: number }> = {}
    for (const [tipo, e] of Object.entries(metricas.emails ?? {})) {
      emailStats[tipo] = { sent: Number(e.sent) || 0, failed: Number(e.failed) || 0 }
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
      trialsExpiredWithoutConversion: expiredTrialsRes.count ?? 0,
    })
  } catch (error) {
    console.error("Error fetching engagement stats:", error)
    return NextResponse.json(
      { error: "Error al obtener estadísticas de engagement" },
      { status: 500 }
    )
  }
}
