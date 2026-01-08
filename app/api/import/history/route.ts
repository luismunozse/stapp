import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { formatImportacion } from "@/lib/db-utils"

export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const entityType = searchParams.get("entityType") // Optional filter

    let query = supabaseAdmin
      .from("importaciones")
      .select(`
        *,
        users:user_id(id, nombre, email)
      `)
      .eq("organization_id", organizationId!)
      .order("created_at", { ascending: false })
      .limit(50) // Last 50 imports

    if (entityType) {
      query = query.eq("entity_type", entityType)
    }

    const { data: importaciones, error: dbError } = await query

    if (dbError) {
      throw dbError
    }

    return NextResponse.json(importaciones?.map(formatImportacion))
  } catch (error) {
    console.error("Error fetching import history:", error)
    return NextResponse.json(
      { error: "Error al obtener historial" },
      { status: 500 }
    )
  }
}
