import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { reportarError, respuestaError } from "@/lib/api-error"

export async function PATCH() {
  try {
    const { error, organizationId, userId } = await requireAuth()
    if (error) return error

    const { data, error: dbError } = await supabaseAdmin
      .from("user_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", userId!)
      .eq("organization_id", organizationId!)
      .is("read_at", null)
      .select("id")

    if (dbError) {
      return respuestaError(dbError, { ruta: "/api/user-notifications/mark-all-read" })
    }

    return NextResponse.json({ success: true, updated: data?.length || 0 })
  } catch (err) {
    console.error("Error marking all as read:", err)
    reportarError(err, { ruta: "/api/user-notifications/mark-all-read" })
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
