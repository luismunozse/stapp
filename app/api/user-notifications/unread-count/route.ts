import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

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
      return NextResponse.json({ error: dbError.message }, { status: 500 })
    }

    return NextResponse.json({ count: count || 0 })
  } catch (err) {
    console.error("Error fetching unread count:", err)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
