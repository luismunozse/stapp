import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get("limit") || "50")
    const offset = parseInt(searchParams.get("offset") || "0")

    const { data: emails, error: dbError, count } = await supabaseAdmin
      .from("admin_emails")
      .select("*", { count: "exact" })
      .eq("organization_id", organizationId!)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1)

    if (dbError) throw dbError

    return NextResponse.json({
      emails: emails || [],
      total: count || 0,
    })
  } catch (error) {
    console.error("Error fetching email history:", error)
    return NextResponse.json(
      { error: "Error al obtener historial de emails" },
      { status: 500 }
    )
  }
}
