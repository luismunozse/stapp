import { NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET() {
  try {
    const { error } = await requireSuperadmin()
    if (error) return error

    const { data: tickets, error: dbError } = await supabaseAdmin
      .from("support_tickets")
      .select("estado")

    if (dbError) throw dbError

    const stats = {
      abiertos: 0,
      enProceso: 0,
      resueltos: 0,
      cerrados: 0,
      total: tickets?.length || 0,
    }

    for (const t of tickets || []) {
      switch (t.estado) {
        case "ABIERTO": stats.abiertos++; break
        case "EN_PROCESO": stats.enProceso++; break
        case "RESUELTO": stats.resueltos++; break
        case "CERRADO": stats.cerrados++; break
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
