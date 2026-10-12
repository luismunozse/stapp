import { NextResponse } from "next/server"
import { requireAuth, hasInventarioAccess, resolveVendedoresHabilitados } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, role } = await requireAuth()
    if (error) return error

    const vendedoresHabilitados = role === "VENDEDOR"
      ? await resolveVendedoresHabilitados(organizationId!)
      : false
    const canViewCost = hasInventarioAccess(role, vendedoresHabilitados)

    const { id } = await params
    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get("page") || "1")
    const limit = parseInt(searchParams.get("limit") || "20")
    const offset = (page - 1) * limit

    // Verificar que el item pertenece a la organización
    const { data: item } = await supabaseAdmin
      .from("inventario")
      .select("id")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (!item) {
      return NextResponse.json(
        { error: "Item no encontrado" },
        { status: 404 }
      )
    }

    const { data: historial, error: dbError, count } = await supabaseAdmin
      .from("historial_precios")
      .select("*, users(id, nombre)", { count: "exact" })
      .eq("inventario_id", id)
      .eq("organization_id", organizationId!)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1)

    if (dbError) throw dbError

    const formatted = (historial || []).map((h: any) => ({
      id: h.id,
      inventarioId: h.inventario_id,
      precioCompraAnterior: canViewCost && h.precio_compra_anterior ? parseFloat(h.precio_compra_anterior) : null,
      precioCompraNuevo: canViewCost && h.precio_compra_nuevo ? parseFloat(h.precio_compra_nuevo) : null,
      precioVentaAnterior: h.precio_venta_anterior ? parseFloat(h.precio_venta_anterior) : null,
      precioVentaNuevo: h.precio_venta_nuevo ? parseFloat(h.precio_venta_nuevo) : null,
      motivo: h.motivo,
      usuarioId: h.usuario_id,
      usuario: h.users ? { id: h.users.id, nombre: h.users.nombre } : null,
      createdAt: h.created_at,
    }))

    return NextResponse.json({
      data: formatted,
      total: count || 0,
      page,
      limit,
    })
  } catch (error) {
    console.error("Error fetching historial precios:", error)
    return NextResponse.json(
      { error: "Error al obtener historial de precios" },
      { status: 500 }
    )
  }
}
