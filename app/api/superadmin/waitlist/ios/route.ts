import { NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET() {
  try {
    const { error } = await requireSuperadmin()
    if (error) return error

    const { data, error: dbError } = await supabaseAdmin
      .from("ios_waitlist")
      .select("id, email, created_at")
      .order("created_at", { ascending: false })

    if (dbError) throw dbError

    return NextResponse.json({ entries: data ?? [], total: data?.length ?? 0 })
  } catch (error) {
    console.error("Error fetching iOS waitlist:", error)
    return NextResponse.json(
      { error: "Error al obtener la waitlist" },
      { status: 500 }
    )
  }
}

export async function DELETE(request: Request) {
  try {
    const { error } = await requireSuperadmin()
    if (error) return error

    const { id } = await request.json()

    const { error: dbError } = await supabaseAdmin
      .from("ios_waitlist")
      .delete()
      .eq("id", id)

    if (dbError) throw dbError

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting waitlist entry:", error)
    return NextResponse.json(
      { error: "Error al eliminar el registro" },
      { status: 500 }
    )
  }
}
