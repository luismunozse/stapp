import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { sucursalParaLectura } from "@/lib/sucursal"

// GET - Obtener órdenes con cobro pendiente de un cliente
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, session, role } = await requireAuth()
    if (error) return error

    const { id: clienteId } = await params

    const filtro = await sucursalParaLectura({
      role,
      userSucursalId: session!.user.sucursalId ?? null,
    })
    const sid = filtro.verTodas ? null : filtro.sucursalId

    let query = supabaseAdmin
      .from("ordenes_servicio")
      .select("id, numero_orden, codigo_orden, dispositivo, costo_final, total_cobrado, estado_cobro, descuento_cobro, estado")
      .eq("organization_id", organizationId!)
      .eq("cliente_id", clienteId)
      .in("estado_cobro", ["PENDIENTE", "PARCIAL"])
      .not("costo_final", "is", null)
      .gt("costo_final", 0)
      .order("fecha_ingreso", { ascending: false })

    if (sid) query = query.eq("sucursal_id", sid)

    const { data: ordenes, error: dbError } = await query

    if (dbError) throw dbError

    return NextResponse.json(
      (ordenes || []).map((o) => ({
        id: o.id,
        numeroOrden: o.numero_orden,
        codigoOrden: o.codigo_orden,
        dispositivo: o.dispositivo,
        costoFinal: parseFloat(o.costo_final || "0"),
        totalCobrado: parseFloat(o.total_cobrado || "0"),
        descuentoCobro: parseFloat(o.descuento_cobro || "0"),
        pendiente: parseFloat(o.costo_final || "0") - parseFloat(o.descuento_cobro || "0") - parseFloat(o.total_cobrado || "0"),
        estadoCobro: o.estado_cobro,
        estado: o.estado,
      }))
    )
  } catch (err) {
    console.error("Error fetching ordenes pendientes:", err)
    return NextResponse.json({ error: "Error al obtener órdenes pendientes" }, { status: 500 })
  }
}
