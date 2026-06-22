import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { ESTADOS_ACTIVOS } from "@/lib/order-states"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { id: origenId } = await params
    const body = await request.json()
    const { tecnicoDestinoId, ordenIds } = body as {
      tecnicoDestinoId?: string
      ordenIds?: string[]
    }

    if (!tecnicoDestinoId || typeof tecnicoDestinoId !== "string") {
      return NextResponse.json(
        { error: "tecnicoDestinoId es requerido" },
        { status: 400 }
      )
    }

    if (tecnicoDestinoId === origenId) {
      return NextResponse.json(
        { error: "El técnico destino debe ser distinto del origen" },
        { status: 400 }
      )
    }

    const { data: destino, error: destinoError } = await supabaseAdmin
      .from("users")
      .select("id, rol, activo, porcentaje_comision, costo_hora")
      .eq("id", tecnicoDestinoId)
      .eq("organization_id", organizationId!)
      .single()

    if (destinoError || !destino) {
      return NextResponse.json({ error: "Técnico destino no encontrado" }, { status: 404 })
    }
    if (destino.rol !== "TECNICO" && destino.rol !== "ADMIN") {
      return NextResponse.json(
        { error: "El usuario destino no tiene rol válido" },
        { status: 400 }
      )
    }
    if (destino.activo === false) {
      return NextResponse.json(
        { error: "El técnico destino está inactivo" },
        { status: 400 }
      )
    }

    let query = supabaseAdmin
      .from("ordenes_servicio")
      .select("id, estado, comision_pagada")
      .eq("organization_id", organizationId!)
      .eq("tecnico_id", origenId)
      .in("estado", ESTADOS_ACTIVOS as unknown as string[])

    if (Array.isArray(ordenIds) && ordenIds.length > 0) {
      query = query.in("id", ordenIds)
    }

    const { data: ordenes, error: ordenesError } = await query
    if (ordenesError) throw ordenesError

    const targetIds = (ordenes || []).map((o: any) => o.id)
    if (targetIds.length === 0) {
      return NextResponse.json({ reasignadas: 0, tecnicoDestinoId })
    }

    const noPagadas = (ordenes || [])
      .filter((o: any) => !o.comision_pagada)
      .map((o: any) => o.id)

    const porcentajeDestino = Number(destino.porcentaje_comision ?? 0)
    const costoHoraDestino = Number((destino as any).costo_hora ?? 0)

    const { error: updateError } = await supabaseAdmin
      .from("ordenes_servicio")
      .update({ tecnico_id: tecnicoDestinoId })
      .in("id", targetIds)
      .eq("organization_id", organizationId!)

    if (updateError) throw updateError

    if (noPagadas.length > 0) {
      const { error: pctError } = await supabaseAdmin
        .from("ordenes_servicio")
        .update({ porcentaje_comision: porcentajeDestino, costo_hora_snapshot: costoHoraDestino })
        .in("id", noPagadas)
        .eq("organization_id", organizationId!)

      if (pctError) throw pctError
    }

    return NextResponse.json({
      reasignadas: targetIds.length,
      comisionActualizada: noPagadas.length,
      tecnicoDestinoId,
    })
  } catch (err) {
    console.error("Error reasignando órdenes:", err)
    return NextResponse.json(
      { error: "Error al reasignar órdenes" },
      { status: 500 }
    )
  }
}
