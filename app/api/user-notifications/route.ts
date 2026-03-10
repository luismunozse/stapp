import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET(request: Request) {
  try {
    const { error, organizationId, userId } = await requireAuth()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 50)
    const cursor = searchParams.get("cursor")

    let query = supabaseAdmin
      .from("user_notifications")
      .select("*")
      .eq("user_id", userId!)
      .eq("organization_id", organizationId!)
      .order("created_at", { ascending: false })
      .limit(limit + 1)

    if (cursor) {
      query = query.lt("created_at", cursor)
    }

    const { data, error: dbError } = await query

    if (dbError) {
      return NextResponse.json({ error: dbError.message }, { status: 500 })
    }

    const hasMore = (data?.length || 0) > limit
    const notifications = hasMore ? data!.slice(0, limit) : (data || [])
    const nextCursor = hasMore ? notifications[notifications.length - 1].created_at : null

    return NextResponse.json({ notifications, nextCursor })
  } catch (err) {
    console.error("Error fetching notifications:", err)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
