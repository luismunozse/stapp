import { NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET() {
  try {
    const { error } = await requireSuperadmin()
    if (error) return error

    const { count: calientesNoVistos, error: dbError } = await supabaseAdmin
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("visto", false)
      .gte("score", 80)

    if (dbError) throw dbError

    return NextResponse.json({
      calientesNoVistos: calientesNoVistos || 0,
    })
  } catch (error) {
    console.error("Error fetching leads stats:", error)
    return NextResponse.json(
      { error: "Error al obtener estadísticas de leads" },
      { status: 500 }
    )
  }
}
