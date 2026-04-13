import { NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET() {
  try {
    const { error } = await requireSuperadmin()
    if (error) return error

    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const ninetyDaysAgo = new Date()
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)

    const [allTimeRes, last30Res, last90Res, recentRes] = await Promise.all([
      // Total respuestas all-time
      supabaseAdmin
        .from("nps_responses")
        .select("score, categoria")
        .limit(10000),

      // Últimos 30 días
      supabaseAdmin
        .from("nps_responses")
        .select("score, categoria")
        .gte("created_at", thirtyDaysAgo.toISOString())
        .limit(10000),

      // Últimos 90 días
      supabaseAdmin
        .from("nps_responses")
        .select("score, categoria")
        .gte("created_at", ninetyDaysAgo.toISOString())
        .limit(10000),

      // Todas las respuestas con comentario + últimas 20 sin comentario
      supabaseAdmin
        .from("nps_responses")
        .select(`
          id, score, categoria, comentario, created_at,
          users (nombre, email),
          organizations (nombre, slug)
        `)
        .order("created_at", { ascending: false })
        .limit(200),
    ])

    const calcNPS = (data: Array<{ score: number; categoria: string }>) => {
      if (!data || data.length === 0) return { nps: 0, promotores: 0, pasivos: 0, detractores: 0, total: 0 }
      const promotores = data.filter(d => d.categoria === "PROMOTOR").length
      const detractores = data.filter(d => d.categoria === "DETRACTOR").length
      const pasivos = data.filter(d => d.categoria === "PASIVO").length
      const total = data.length
      const nps = Math.round(((promotores - detractores) / total) * 100)
      return { nps, promotores, pasivos, detractores, total }
    }

    return NextResponse.json({
      allTime: calcNPS(allTimeRes.data || []),
      last30Days: calcNPS(last30Res.data || []),
      last90Days: calcNPS(last90Res.data || []),
      recentResponses: (recentRes.data || []).map((r: Record<string, unknown>) => ({
        id: r.id,
        score: r.score,
        categoria: r.categoria,
        comentario: r.comentario,
        createdAt: r.created_at,
        usuario: (r.users as Record<string, unknown>)?.nombre || "Unknown",
        email: (r.users as Record<string, unknown>)?.email || "",
        organizacion: (r.organizations as Record<string, unknown>)?.nombre || "Unknown",
      })),
    })
  } catch (error) {
    console.error("Error fetching NPS stats:", error)
    return NextResponse.json({ error: "Error al obtener NPS" }, { status: 500 })
  }
}
