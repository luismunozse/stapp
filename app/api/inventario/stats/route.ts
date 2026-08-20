import { NextResponse } from "next/server"
import { requireAuth, hasInventarioAccess, resolveVendedoresHabilitados } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

// Stats agregadas para el header de /inventario:
// - totalSkus, valor a costo, valor a venta, sin stock, bajo stock, valor en riesgo
// Una sola query SQL en la base usando aggregations.
export async function GET() {
  try {
    const { error, organizationId, role } = await requireAuth()
    if (error) return error

    // Umbral global desde la organización (fallback 5)
    const { data: org } = await supabaseAdmin
      .from("organizations")
      .select("umbral_stock_bajo")
      .eq("id", organizationId!)
      .single()
    const globalThreshold = org?.umbral_stock_bajo ?? 5

    // Traer items activos. Sólo necesitamos los campos para agregar.
    // Para una org con miles de SKUs esto sigue siendo barato (una columna).
    const { data: items, error: dbError } = await supabaseAdmin
      .from("inventario")
      .select("stock, stock_reservado, precio_compra, precio_venta, stock_minimo")
      .eq("organization_id", organizationId!)
      .is("deleted_at", null)

    if (dbError) throw dbError

    let totalSkus = 0
    let valorCosto = 0
    let valorVenta = 0
    let sinStock = 0
    let bajoStock = 0
    let valorEnRiesgo = 0

    for (const item of items || []) {
      totalSkus++
      const stock = item.stock || 0
      const precioCompra = Number(item.precio_compra) || 0
      const precioVenta = Number(item.precio_venta) || 0
      const minimoEfectivo = item.stock_minimo ?? globalThreshold

      valorCosto += stock * precioCompra
      valorVenta += stock * precioVenta

      if (stock === 0) {
        sinStock++
        // Para items sin stock, el "valor en riesgo" es lo que costaría reponer al mínimo.
        valorEnRiesgo += minimoEfectivo * precioCompra
      } else if (stock <= minimoEfectivo) {
        bajoStock++
        // Para bajo stock: lo que costaría llegar al mínimo.
        valorEnRiesgo += Math.max(0, minimoEfectivo - stock) * precioCompra
      }
    }

    // valorCosto y valorEnRiesgo salen de precio_compra, así que van detrás del
    // mismo permiso que el costo de cada item. Los conteos y el valor a venta
    // no son costo y siguen disponibles para todos los roles.
    const vendedoresHabilitados = role === "VENDEDOR"
      ? await resolveVendedoresHabilitados(organizationId!)
      : false
    const canViewCost = hasInventarioAccess(role, vendedoresHabilitados)

    return NextResponse.json(
      {
        totalSkus,
        valorCosto: canViewCost ? Math.round(valorCosto * 100) / 100 : null,
        valorVenta: Math.round(valorVenta * 100) / 100,
        sinStock,
        bajoStock,
        valorEnRiesgo: canViewCost ? Math.round(valorEnRiesgo * 100) / 100 : null,
      },
      {
        // La respuesta ahora depende del rol: no se cachea, igual que el resto
        // de los endpoints con costo detrás de un permiso.
        headers: { "Cache-Control": "no-store" },
      }
    )
  } catch (error) {
    console.error("Error fetching inventario stats:", error)
    return NextResponse.json(
      { error: "Error al obtener estadísticas de inventario" },
      { status: 500 }
    )
  }
}
