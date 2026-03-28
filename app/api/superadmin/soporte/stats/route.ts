import { NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET() {
  try {
    const { error } = await requireSuperadmin()
    if (error) return error

    const [abiertos, enProceso, resueltos, cerrados] = await Promise.all([
      supabaseAdmin.from("support_tickets").select("id", { count: "exact", head: true }).eq("estado", "ABIERTO"),
      supabaseAdmin.from("support_tickets").select("id", { count: "exact", head: true }).eq("estado", "EN_PROCESO"),
      supabaseAdmin.from("support_tickets").select("id", { count: "exact", head: true }).eq("estado", "RESUELTO"),
      supabaseAdmin.from("support_tickets").select("id", { count: "exact", head: true }).eq("estado", "CERRADO"),
    ])

    const stats = {
      abiertos: abiertos.count || 0,
      enProceso: enProceso.count || 0,
      resueltos: resueltos.count || 0,
      cerrados: cerrados.count || 0,
      total: (abiertos.count || 0) + (enProceso.count || 0) + (resueltos.count || 0) + (cerrados.count || 0),
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
