import { NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"

// Contador del menu del superadmin: cuantos faltan cargar en Play Console.
export async function GET() {
  const { error } = await requireSuperadmin()
  if (error) return error

  const { count, error: dbError } = await supabaseAdmin
    .from("android_beta_testers")
    .select("id", { count: "exact", head: true })
    .eq("estado", "PENDIENTE")

  if (dbError) {
    console.error("[superadmin/beta-android] stats", dbError)
    return NextResponse.json({ error: "Error al obtener el contador" }, { status: 500 })
  }

  return NextResponse.json({ pendientes: count ?? 0 })
}
