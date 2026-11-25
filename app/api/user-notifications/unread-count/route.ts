import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { reportarError, respuestaError } from "@/lib/api-error"

export async function GET() {
  try {
    const { error, organizationId, userId } = await requireAuth()
    if (error) return error

    const { count, error: dbError } = await supabaseAdmin
      .from("user_notifications")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId!)
      .eq("organization_id", organizationId!)
      .is("read_at", null)

    if (dbError) {
      return respuestaError(dbError, { ruta: "/api/user-notifications/unread-count" })
    }

    return NextResponse.json({ count: count || 0 })
  } catch (err) {
    console.error("Error fetching unread count:", err)
    reportarError(err, { ruta: "/api/user-notifications/unread-count" })
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
