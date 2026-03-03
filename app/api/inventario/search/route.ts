import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { formatInventario } from "@/lib/db-utils"

// GET /api/inventario/search?q=term&limit=10
// Server-side search for inventory items (used by sale form)
// Returns minimal payload: id, codigo, nombre, stock, precioVenta
// Filters: stock > 0, matches query on nombre OR codigo with ilike
export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const q = searchParams.get("q") || ""
    const limit = Math.min(parseInt(searchParams.get("limit") || "10"), 50)

    let query = supabaseAdmin
      .from("inventario")
      .select("id, codigo, nombre, stock, precio_venta")
      .eq("organization_id", organizationId!)
      .gt("stock", 0)
      .order("nombre", { ascending: true })
      .limit(limit)

    if (q.trim()) {
      query = query.or(`nombre.ilike.%${q}%,codigo.ilike.%${q}%`)
    }

    const { data: items, error: dbError } = await query

    if (dbError) {
      throw dbError
    }

    const formatted = (items || []).map((item) => ({
      id: item.id,
      codigo: item.codigo,
      nombre: item.nombre,
      stock: item.stock,
      precioVenta: item.precio_venta,
    }))

    return NextResponse.json(formatted)
  } catch (error) {
    console.error("Error searching inventario:", error)
    return NextResponse.json(
      { error: "Error al buscar items de inventario" },
      { status: 500 }
    )
  }
}
