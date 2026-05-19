import { NextResponse } from "next/server"
import { requireAdminOrVendedor } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

// GET /api/inventario/series/buscar?q=...
// Búsqueda global por número de serie (parcial). Devuelve serie + item asociado.
export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireAdminOrVendedor()
    if (error) return error

    const url = new URL(request.url)
    const q = url.searchParams.get("q")?.trim() ?? ""
    if (q.length < 2) {
      return NextResponse.json({ data: [] })
    }
    const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 200)

    const { data, error: dbErr } = await supabaseAdmin
      .from("inventario_series")
      .select(
        `
          id, numero_serie, estado, fecha_venta, fecha_garantia_vence, venta_id, cliente_id,
          inventario:inventario_id (id, codigo, nombre),
          lote:lote_id (id, numero_lote)
        `
      )
      .eq("organization_id", organizationId!)
      .ilike("numero_serie", `%${q}%`)
      .order("created_at", { ascending: false })
      .limit(limit)

    if (dbErr) throw dbErr

    return NextResponse.json({ data: data ?? [] })
  } catch (err) {
    console.error("Error searching series:", err)
    return NextResponse.json({ error: "Error al buscar series" }, { status: 500 })
  }
}
