import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { reportarError, respuestaError } from "@/lib/api-error"

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, userId } = await requireAuth()
    if (error) return error

    const { id } = await params

    const { error: dbError } = await supabaseAdmin
      .from("user_notifications")
      .delete()
      .eq("id", id)
      .eq("user_id", userId!)

    if (dbError) {
      return respuestaError(dbError, { ruta: "/api/user-notifications/[id]" })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("Error deleting notification:", err)
    reportarError(err, { ruta: "/api/user-notifications/[id]" })
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
