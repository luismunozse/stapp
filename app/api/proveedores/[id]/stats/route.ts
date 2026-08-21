import { NextResponse } from "next/server"
import { requireAuth, hasInventarioAccess, resolveVendedoresHabilitados } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

// GET /api/proveedores/[id]/stats
// KPIs detallados para la página del proveedor:
// - productosCount, valorCostoStock, valorVentaStock, itemsSinStock, itemsBajoStock
// - ordenesCount, ordenesAbiertas (ENVIADA/RECIBIDA_PARCIAL/BORRADOR), totalComprado, ultimaCompra
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, role } = await requireAuth()
    if (error) return error
    const { id } = await params

    const { data: prov, error: provErr } = await supabaseAdmin
      .from("proveedores")
      .select("id")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()
    if (provErr || !prov) {
      return NextResponse.json({ error: "Proveedor no encontrado" }, { status: 404 })
    }

    const { data: org } = await supabaseAdmin
      .from("organizations")
      .select("umbral_stock_bajo")
      .eq("id", organizationId!)
      .single()
    const globalThreshold = org?.umbral_stock_bajo ?? 5

    const [invRes, ocRes] = await Promise.all([
      supabaseAdmin
        .from("inventario")
        .select("stock, stock_minimo, precio_compra, precio_venta")
        .eq("organization_id", organizationId!)
        .eq("proveedor_id", id)
        .is("deleted_at", null)
        .limit(10000),
      supabaseAdmin
        .from("ordenes_compra")
        .select("estado, total, fecha_emision")
        .eq("organization_id", organizationId!)
        .eq("proveedor_id", id)
        .limit(10000),
    ])

    if (invRes.error) throw invRes.error
    if (ocRes.error) throw ocRes.error

    let valorCostoStock = 0
    let valorVentaStock = 0
    let itemsSinStock = 0
    let itemsBajoStock = 0
    for (const r of invRes.data || []) {
      const stock = Number(r.stock) || 0
      const pc = Number(r.precio_compra) || 0
      const pv = Number(r.precio_venta) || 0
      valorCostoStock += stock * pc
      valorVentaStock += stock * pv
      if (stock === 0) itemsSinStock++
      else if (stock <= (r.stock_minimo ?? globalThreshold)) itemsBajoStock++
    }

    let totalComprado = 0
    let ordenesAbiertas = 0
    let ultimaCompra: string | null = null
    for (const oc of ocRes.data || []) {
      if (oc.estado === "RECIBIDA" || oc.estado === "RECIBIDA_PARCIAL") {
        totalComprado += Number(oc.total) || 0
      }
      if (oc.estado === "BORRADOR" || oc.estado === "ENVIADA" || oc.estado === "RECIBIDA_PARCIAL") {
        ordenesAbiertas++
      }
      const fecha = oc.fecha_emision as string | null
      if (fecha && (!ultimaCompra || fecha > ultimaCompra)) ultimaCompra = fecha
    }

    // valorCostoStock sale de precio_compra. Con un solo producto,
    // valorCostoStock / stock devuelve el costo exacto de ese item, así que va
    // detrás del mismo permiso. Los conteos y el valor a venta se mantienen.
    //
    // totalComprado va detrás del MISMO permiso: es la suma de
    // ordenes_compra.total recibidas, o sea lo que la organización le pagó a
    // este proveedor. Es el mismo dato comercial que valorCostoStock y viaja en
    // la misma respuesta — mostrar uno y tapar el otro no es una línea
    // defendible. Con un proveedor de una sola OC recibida, totalComprado ES el
    // precio de esa compra.
    const vendedoresHabilitados = role === "VENDEDOR"
      ? await resolveVendedoresHabilitados(organizationId!)
      : false
    const canViewCost = hasInventarioAccess(role, vendedoresHabilitados)

    return NextResponse.json(
      {
        productosCount: invRes.data?.length || 0,
        valorCostoStock: canViewCost ? Math.round(valorCostoStock * 100) / 100 : null,
        valorVentaStock: Math.round(valorVentaStock * 100) / 100,
        itemsSinStock,
        itemsBajoStock,
        ordenesCount: ocRes.data?.length || 0,
        ordenesAbiertas,
        totalComprado: canViewCost ? Math.round(totalComprado * 100) / 100 : null,
        ultimaCompra,
      },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    console.error("Error en stats proveedor:", error)
    return NextResponse.json({ error: "Error al calcular stats" }, { status: 500 })
  }
}
