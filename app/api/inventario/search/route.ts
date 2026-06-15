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
      .select("id, codigo, nombre, stock, stock_reservado, precio_venta, precio_compra, trackea_series")
      .eq("organization_id", organizationId!)
      .is("deleted_at", null)

    if (!includeZeroStock) {
      query = query.gt("stock", 0)
    }

    query = query.order("nombre", { ascending: true }).limit(limit)

    // Substring search by name + code. Each whitespace-separated term must
    // match (AND); a term matches nombre OR codigo via ILIKE substring. This
    // finds partial names ("tornil" → "tornillo") and partial/alphanumeric
    // codes ("ABC1" → "ABC123") — cases the previous full-text search missed,
    // because to_tsvector only matched whole stemmed lexemes, not substrings.
    if (q.trim()) {
      const terms = q
        .trim()
        .split(/\s+/)
        // Strip LIKE wildcards (% _) and PostgREST filter delimiters ( , ( ) * \ )
        // so user input can't break or inject into the .or() filter string.
        .map((t) => t.replace(/[%_,()*\\]/g, "").trim())
        .filter(Boolean)
        .slice(0, 6)

      for (const term of terms) {
        query = query.or(`nombre.ilike.%${term}%,codigo.ilike.%${term}%`)
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
      trackeaSeries: item.trackea_series ?? false,
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
