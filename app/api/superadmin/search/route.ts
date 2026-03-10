import { NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET(request: Request) {
  try {
    const { error } = await requireSuperadmin()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const q = searchParams.get("q")?.trim() || ""

    if (q.length < 2) {
      return NextResponse.json(
        { error: "La búsqueda debe tener al menos 2 caracteres" },
        { status: 400 }
      )
    }

    const searchPattern = `%${q}%`

    // Search organizations, users, and tickets in parallel
    const [orgsResult, usersResult, ticketsResult] = await Promise.all([
      supabaseAdmin
        .from("organizations")
        .select("id, nombre, slug, email, activo")
        .or(
          `nombre.ilike.${searchPattern},slug.ilike.${searchPattern},email.ilike.${searchPattern}`
        )
        .limit(5),

      supabaseAdmin
        .from("users")
        .select("id, nombre, email, organization_id")
        .or(
          `nombre.ilike.${searchPattern},email.ilike.${searchPattern}`
        )
        .limit(5),

      supabaseAdmin
        .from("support_tickets")
        .select("id, asunto, estado, prioridad, organization_id")
        .ilike("asunto", searchPattern)
        .limit(5),
    ])

    if (orgsResult.error) throw orgsResult.error
    if (usersResult.error) throw usersResult.error
    if (ticketsResult.error) throw ticketsResult.error

    return NextResponse.json({
      organizations: orgsResult.data || [],
      users: usersResult.data || [],
      tickets: ticketsResult.data || [],
    })
  } catch (error) {
    console.error("Error in global search:", error)
    return NextResponse.json(
      { error: "Error al realizar la búsqueda" },
      { status: 500 }
    )
  }
}
