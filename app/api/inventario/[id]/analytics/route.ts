import { NextResponse } from "next/server"
import { requireAuth, hasInventarioAccess, resolveVendedoresHabilitados } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, role } = await requireAuth()
    if (error) return error

    const { id } = await params

    const now = new Date()
    const hace30Dias = new Date(now)
    hace30Dias.setDate(now.getDate() - 30)
    const hace90Dias = new Date(now)
    hace90Dias.setDate(now.getDate() - 90)

    const [itemResult, mov90Result, mov30Result, lastSaleResult] = await Promise.all([
      supabaseAdmin
        .from("inventario")
        .select("id, nombre, stock, stock_reservado, stock_minimo, punto_reorden, precio_compra, precio_venta")
        .eq("id", id)
        .eq("organization_id", organizationId!)
        .is("deleted_at", null)
        .single(),

      supabaseAdmin
        .from("movimientos_inventario")
        .select("cantidad, created_at")
        .eq("inventario_id", id)
        .eq("organization_id", organizationId!)
        .eq("tipo", "VENTA")
        .gte("created_at", hace90Dias.toISOString()),

      supabaseAdmin
        .from("movimientos_inventario")
        .select("cantidad, created_at")
        .eq("inventario_id", id)
        .eq("organization_id", organizationId!)
        .eq("tipo", "VENTA")
        .gte("created_at", hace30Dias.toISOString()),

      supabaseAdmin
        .from("movimientos_inventario")
        .select("created_at")
        .eq("inventario_id", id)
        .eq("organization_id", organizationId!)
        .eq("tipo", "VENTA")
        .order("created_at", { ascending: false })
        .limit(1),
    ])

    if (itemResult.error || !itemResult.data) {
      return NextResponse.json({ error: "Item no encontrado" }, { status: 404 })
    }

    const item = itemResult.data
    const mov90 = mov90Result.data || []
    const mov30 = mov30Result.data || []

    const ventasUlt90d = mov90.reduce((sum, m) => sum + Math.abs(m.cantidad), 0)
    const ventasUlt30d = mov30.reduce((sum, m) => sum + Math.abs(m.cantidad), 0)

    const promedioDiario90 = ventasUlt90d / 90
    const promedioDiario30 = ventasUlt30d / 30

    const disponible = item.stock - (item.stock_reservado || 0)
    const diasDeStockRestantes = promedioDiario90 > 0
      ? Math.round(disponible / promedioDiario90)
      : disponible > 0 ? 999 : 0

    const ultimaVenta = lastSaleResult.data?.[0]?.created_at || null

    let sinMovimientoDias = 0
    if (ultimaVenta) {
      sinMovimientoDias = Math.floor((now.getTime() - new Date(ultimaVenta).getTime()) / (1000 * 60 * 60 * 24))
    } else {
      sinMovimientoDias = 999
    }

    const puntoReorden = item.punto_reorden ?? (promedioDiario90 > 0 ? Math.ceil(promedioDiario90 * 14) : null)

    const vendedoresHabilitados = role === "VENDEDOR"
      ? await resolveVendedoresHabilitados(organizationId!)
      : false
    const canViewCost = hasInventarioAccess(role, vendedoresHabilitados)

    return NextResponse.json({
      ventasUlt30d,
      ventasUlt90d,
      promedioDiario30: Math.round(promedioDiario30 * 100) / 100,
      promedioDiario90: Math.round(promedioDiario90 * 100) / 100,
      diasDeStockRestantes,
      ultimaVenta,
      sinMovimientoDias,
      disponible,
      stockReservado: item.stock_reservado || 0,
      puntoReorden,
      valorStock: canViewCost ? item.stock * (Number(item.precio_compra) || 0) : null,
    })
  } catch (error) {
    console.error("Error fetching item analytics:", error)
    return NextResponse.json(
      { error: "Error al obtener analytics del item" },
      { status: 500 }
    )
  }
}
