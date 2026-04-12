import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { id } = await params

    const { data: eventos, error: dbError } = await supabaseAdmin
      .from("orden_eventos")
      .select(`
        id, tipo, estado_anterior, estado_nuevo,
        descripcion, metadata, created_at,
        users:created_by (nombre)
      `)
      .eq("orden_id", id)
      .eq("organization_id", organizationId!)
      .order("created_at", { ascending: false })

    if (dbError) throw dbError

    return NextResponse.json(eventos || [])
  } catch (error) {
    console.error("Error fetching eventos:", error)
    return NextResponse.json(
      { error: "Error al obtener eventos" },
      { status: 500 }
    )
  }
}
