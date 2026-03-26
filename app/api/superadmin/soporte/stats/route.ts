import { NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET() {
  try {
    const { error } = await requireSuperadmin()
    if (error) return error

    const { data, error: dbError } = await supabaseAdmin.rpc("support_ticket_stats")

    if (dbError) throw dbError

    const stats = {
      abiertos: 0,
      enProceso: 0,
      resueltos: 0,
      cerrados: 0,
      total: 0,
    }

    for (const row of data || []) {
      const count = row.count as number
      stats.total += count
      switch (row.estado) {
        case "ABIERTO": stats.abiertos = count; break
        case "EN_PROCESO": stats.enProceso = count; break
        case "RESUELTO": stats.resueltos = count; break
        case "CERRADO": stats.cerrados = count; break
      }
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
