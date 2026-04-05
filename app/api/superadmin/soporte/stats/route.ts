import { NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET() {
  try {
    const { error } = await requireSuperadmin()
    if (error) return error

    // Un solo query con todos los tickets, agrupamos en JS
    const { data: tickets, error: dbError } = await supabaseAdmin
      .from("support_tickets")
      .select("estado")

    if (dbError) throw dbError

    const counts: Record<string, number> = {}
    for (const t of tickets || []) {
      counts[t.estado] = (counts[t.estado] || 0) + 1
    }

    const stats = {
      abiertos: counts["ABIERTO"] || 0,
      enProceso: counts["EN_PROCESO"] || 0,
      resueltos: counts["RESUELTO"] || 0,
      cerrados: counts["CERRADO"] || 0,
      total: (tickets || []).length,
    }

    return NextResponse.json(stats)
  } catch (error) {
    console.error("Error fetching support stats:", error)
    return NextResponse.json(
      { error: "Error al obtener estadísticas" },
      { status: 500 }
    )
  }
}
