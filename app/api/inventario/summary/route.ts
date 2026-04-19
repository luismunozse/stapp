import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

// GET /api/inventario/summary?proveedorId=...&categoria=...&tipoDispositivo=...&bajoStock=true
// Agrega totales del inventario (solo activos, no archivados) para los filtros
// aplicados. Ideal para mostrar métricas por proveedor en la vista de inventario.
export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const categoria = searchParams.get("categoria") || ""
    const tipoDispositivo = searchParams.get("tipoDispositivo") || ""
    const proveedorId = searchParams.get("proveedorId") || ""
    const bajoStock = searchParams.get("bajoStock") === "true"

    let query = supabaseAdmin
      .from("inventario")
      .select("stock, precio_compra, precio_venta, stock_minimo")
      .eq("organization_id", organizationId!)
      .is("deleted_at", null)

    if (categoria) query = query.eq("categoria", categoria)
    if (tipoDispositivo) query = query.eq("tipo_dispositivo", tipoDispositivo)

    if (proveedorId) {
      if (proveedorId === "none") {
        query = query.is("proveedor_id", null)
      } else {
        query = query.eq("proveedor_id", proveedorId)
      }
    }

    if (bajoStock) {
      const { data: org } = await supabaseAdmin
        .from("organizations")
        .select("umbral_stock_bajo")
        .eq("id", organizationId!)
        .single()
      const globalThreshold = org?.umbral_stock_bajo ?? 5
      query = query.lte("stock", globalThreshold)
    }

    // Límite defensivo por si la organización tiene miles de items. 10k cubre
    // casos reales; si se supera, avisamos en un flag para el cliente.
    const LIMIT = 10000
    query = query.limit(LIMIT)

    const { data, error: dbError } = await query
    if (dbError) throw dbError

    const rows = data || []
    let totalArticulos = rows.length
    let totalStock = 0
    let valorCosto = 0
    let valorVenta = 0
    let itemsBajoStock = 0
    let itemsSinStock = 0

    // Umbral por defecto para bajo stock (sólo para el contador; no filtra).
    const { data: org } = await supabaseAdmin
      .from("organizations")
      .select("umbral_stock_bajo")
      .eq("id", organizationId!)
      .single()
    const globalThreshold = org?.umbral_stock_bajo ?? 5

    for (const r of rows) {
      const stock = Number(r.stock) || 0
      const pc = Number(r.precio_compra) || 0
      const pv = Number(r.precio_venta) || 0
      totalStock += stock
      valorCosto += stock * pc
      valorVenta += stock * pv
      if (stock === 0) itemsSinStock++
      else if (stock <= (r.stock_minimo ?? globalThreshold)) itemsBajoStock++
    }

    return NextResponse.json({
      totalArticulos,
      totalStock,
      valorCosto: Math.round(valorCosto * 100) / 100,
      valorVenta: Math.round(valorVenta * 100) / 100,
      margenEstimado: Math.round((valorVenta - valorCosto) * 100) / 100,
      itemsBajoStock,
      itemsSinStock,
      truncated: rows.length >= LIMIT,
    }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    console.error("Error en summary inventario:", error)
    return NextResponse.json(
      { error: "Error al calcular resumen" },
      { status: 500 }
    )
  }
}
