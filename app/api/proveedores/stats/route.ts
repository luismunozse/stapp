import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

// GET /api/proveedores/stats
// Devuelve KPIs agregados por proveedor para la lista:
// - productosCount: cantidad de items de inventario asociados (no archivados)
// - ordenesCount: cantidad de órdenes de compra
// - totalComprado: suma de totales de ordenes_compra recibidas / parciales
// - ultimaCompra: fecha de la última OC (emisión)
export async function GET() {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const [invRes, ocRes] = await Promise.all([
      supabaseAdmin
        .from("inventario")
        .select("proveedor_id")
        .eq("organization_id", organizationId!)
        .is("deleted_at", null)
        .not("proveedor_id", "is", null)
        .limit(50000),
      supabaseAdmin
        .from("ordenes_compra")
        .select("proveedor_id, estado, total, fecha_emision")
        .eq("organization_id", organizationId!)
        .not("proveedor_id", "is", null)
        .limit(50000),
    ])

    if (invRes.error) throw invRes.error
    if (ocRes.error) throw ocRes.error

    const stats: Record<
      string,
      { productosCount: number; ordenesCount: number; totalComprado: number; ultimaCompra: string | null }
    > = {}

    for (const row of invRes.data || []) {
      const id = row.proveedor_id as string
      if (!id) continue
      if (!stats[id]) stats[id] = { productosCount: 0, ordenesCount: 0, totalComprado: 0, ultimaCompra: null }
      stats[id].productosCount++
    }

    for (const oc of ocRes.data || []) {
      const id = oc.proveedor_id as string
      if (!id) continue
      if (!stats[id]) stats[id] = { productosCount: 0, ordenesCount: 0, totalComprado: 0, ultimaCompra: null }
      stats[id].ordenesCount++
      if (oc.estado === "RECIBIDA" || oc.estado === "RECIBIDA_PARCIAL") {
        stats[id].totalComprado += Number(oc.total) || 0
      }
      const fecha = oc.fecha_emision as string | null
      if (fecha && (!stats[id].ultimaCompra || fecha > stats[id].ultimaCompra!)) {
        stats[id].ultimaCompra = fecha
      }
    }

    return NextResponse.json(stats, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    console.error("Error en stats proveedores:", error)
    return NextResponse.json({ error: "Error al calcular stats" }, { status: 500 })
  }
}
