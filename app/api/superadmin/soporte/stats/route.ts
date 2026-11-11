import { NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET() {
  try {
    const { error } = await requireSuperadmin()
    if (error) return error

    // Conteos con count/head: traer las filas y contarlas en JS se cortaba en
    // 1000 tickets (PostgREST max_rows) sin ningún error.
    const contar = (estado?: string) => {
      const q = supabaseAdmin.from("support_tickets").select("id", { count: "exact", head: true })
      return estado ? q.eq("estado", estado) : q
    }
    const resultados = await Promise.all([
      contar("ABIERTO"),
      contar("EN_PROCESO"),
      contar("RESUELTO"),
      contar("CERRADO"),
      contar(),
    ])
    const fallo = resultados.find((r) => r.error)
    if (fallo) throw fallo.error
    const [abiertos, enProceso, resueltos, cerrados, total] = resultados.map((r) => r.count ?? 0)

    const stats = { abiertos, enProceso, resueltos, cerrados, total }

    return NextResponse.json(stats)
  } catch (error) {
    console.error("Error fetching support stats:", error)
    return NextResponse.json(
      { error: "Error al obtener estadísticas" },
      { status: 500 }
    )
  }
}
