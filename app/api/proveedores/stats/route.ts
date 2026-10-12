import { NextResponse } from "next/server"
import { requireAdminOrVendedor, hasInventarioAccess, resolveVendedoresHabilitados } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

// GET /api/proveedores/stats
// Devuelve KPIs agregados por proveedor para la lista:
// - productosCount: cantidad de items de inventario asociados (no archivados)
// - ordenesCount: cantidad de órdenes de compra
// - totalComprado: suma de totales de ordenes_compra recibidas / parciales
//   (null cuando el rol no puede ver costos de compra)
// - ultimaCompra: fecha de la última OC (emisión)
export async function GET() {
  try {
    // Mismo eje que el resto del namespace: ver el comentario en
    // app/api/proveedores/route.ts.
    const { error, organizationId, role } = await requireAdminOrVendedor()
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

    // totalComprado es lo que la organización le pagó al proveedor: la suma de
    // ordenes_compra.total recibidas. Es el mismo dato comercial que
    // valorCostoStock, que /api/proveedores/[id]/stats ya esconde detrás de
    // hasInventarioAccess. Mostrar uno y tapar el otro en la misma pantalla no
    // es una línea defendible, así que van juntos.
    const vendedoresHabilitados = role === "VENDEDOR"
      ? await resolveVendedoresHabilitados(organizationId!)
      : false
    const canViewCost = hasInventarioAccess(role, vendedoresHabilitados)

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

    // El gate se aplica recién al escribir la respuesta, así los totales se
    // siguen sumando sobre las cifras reales y no sobre los nulls.
    const payload: Record<
      string,
      { productosCount: number; ordenesCount: number; totalComprado: number | null; ultimaCompra: string | null }
    > = canViewCost
      ? stats
      : Object.fromEntries(
          Object.entries(stats).map(([id, s]) => [id, { ...s, totalComprado: null }])
        )

    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    console.error("Error en stats proveedores:", error)
    return NextResponse.json({ error: "Error al calcular stats" }, { status: 500 })
  }
}
