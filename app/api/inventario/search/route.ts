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
    const includeZeroStock = searchParams.get("includeZeroStock") === "true"

    let query = supabaseAdmin
      .from("inventario")
      .select("id, codigo, nombre, stock, stock_reservado, precio_venta, precio_compra")
      .eq("organization_id", organizationId!)
      .is("deleted_at", null)

    if (!includeZeroStock) {
      query = query.gt("stock", 0)
    }

    query = query.order("nombre", { ascending: true }).limit(limit)

    if (q.trim()) {
      if (q.trim().length >= 3) {
        query = query.textSearch("search_vector", q, { type: "plain", config: "spanish" })
      } else {
        query = query.or(`nombre.ilike.%${q}%,codigo.ilike.%${q}%`)
      }
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
      stockReservado: item.stock_reservado ?? 0,
      precioVenta: item.precio_venta,
      precioCompra: item.precio_compra ?? 0,
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
