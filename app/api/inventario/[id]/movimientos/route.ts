import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { formatMovimiento } from "@/lib/db-utils"

// GET /api/inventario/[id]/movimientos?page=1&limit=20
// Paginated movement history for an inventory item
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { id } = await params
    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get("page") || "1")
    const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 100)
    const offset = (page - 1) * limit

    // Verify the inventory item belongs to the organization
    const { data: item, error: itemError } = await supabaseAdmin
      .from("inventario")
      .select("id")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (itemError || !item) {
      return NextResponse.json(
        { error: "Item no encontrado" },
        { status: 404 }
      )
    }

    // Fetch paginated movements with user info
    const { data: movimientos, error: dbError, count } = await supabaseAdmin
      .from("movimientos_inventario")
      .select("*, users:usuario_id (id, nombre)", { count: "exact" })
      .eq("inventario_id", id)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1)

    if (dbError) {
      throw dbError
    }

    return NextResponse.json({
      data: (movimientos || []).map(formatMovimiento),
      total: count || 0,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit),
    })
  } catch (error) {
    console.error("Error fetching movimientos:", error)
    return NextResponse.json(
      { error: "Error al obtener movimientos" },
      { status: 500 }
    )
  }
}
