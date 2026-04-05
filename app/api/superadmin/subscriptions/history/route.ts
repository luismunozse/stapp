import { NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET(request: Request) {
  try {
    const { error } = await requireSuperadmin()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const organizationId = searchParams.get("organizationId")
    const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 100)

    if (!organizationId) {
      return NextResponse.json({ error: "organizationId requerido" }, { status: 400 })
    }

    // Historial de subscription_history
    const { data: history, error: dbError } = await supabaseAdmin
      .from("subscription_history")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(limit)

    if (dbError) throw dbError

    // Trial extensions
    const { data: extensions } = await supabaseAdmin
      .from("trial_extensions")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(limit)

    return NextResponse.json({
      history: history || [],
      trialExtensions: extensions || [],
    })
  } catch (err) {
    console.error("Error fetching subscription history:", err)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}
