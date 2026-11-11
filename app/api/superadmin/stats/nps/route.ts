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

    // Conteos con count/head. Antes se traían las filas (.limit(10000)), pero
    // PostgREST igual corta en 1000 (max_rows) sin error: el NPS se calculaba
    // sobre una parte de las respuestas.
    const resumen = async (desde?: Date) => {
      const contar = (categoria?: string) => {
        let q = supabaseAdmin.from("nps_responses").select("id", { count: "exact", head: true })
        if (desde) q = q.gte("created_at", desde.toISOString())
        if (categoria) q = q.eq("categoria", categoria)
        return q
      }
      const resultados = await Promise.all([contar("PROMOTOR"), contar("PASIVO"), contar("DETRACTOR"), contar()])
      const fallo = resultados.find((r) => r.error)
      if (fallo) throw fallo.error
      const [promotores, pasivos, detractores, total] = resultados.map((r) => r.count ?? 0)
      const nps = total > 0 ? Math.round(((promotores - detractores) / total) * 100) : 0
      return { nps, promotores, pasivos, detractores, total }
    }

    const [allTime, last30Days, last90Days, recentRes] = await Promise.all([
      resumen(),
      resumen(thirtyDaysAgo),
      resumen(ninetyDaysAgo),

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

    return NextResponse.json({
      allTime,
      last30Days,
      last90Days,
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
