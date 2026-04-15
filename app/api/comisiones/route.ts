import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const tecnicoId = searchParams.get("tecnicoId")
    const desde = searchParams.get("desde")
    const hasta = searchParams.get("hasta")
    const soloPendientes = searchParams.get("soloPendientes") === "true"

    let query = supabaseAdmin
      .from("v_comisiones_ordenes")
      .select(`
        orden_id,
        tecnico_id,
        codigo_orden,
        numero_orden,
        dispositivo,
        estado,
        estado_cobro,
        fecha_completado,
        costo_final,
        costo_repuestos,
        ganancia,
        porcentaje_comision,
        monto_comision,
        comision_pagada,
        fecha_pago_comision
      `)
      .eq("organization_id", organizationId!)
      .in("estado", ["REPARADO", "ENTREGADO"])
      .eq("estado_cobro", "COBRADO")
      .order("fecha_completado", { ascending: false })

    if (tecnicoId) query = query.eq("tecnico_id", tecnicoId)
    if (desde) query = query.gte("fecha_completado", desde)
    if (hasta) query = query.lte("fecha_completado", hasta)
    if (soloPendientes) query = query.eq("comision_pagada", false)

    const { data: ordenes, error: qErr } = await query
    if (qErr) throw qErr

    // Obtener nombres de técnicos
    const tecnicoIds = Array.from(new Set((ordenes || []).map((o) => o.tecnico_id).filter(Boolean)))
    const tecnicosMap = new Map<string, string>()
    if (tecnicoIds.length > 0) {
      const { data: tecs } = await supabaseAdmin
        .from("users")
        .select("id, nombre")
        .in("id", tecnicoIds)
      ;(tecs || []).forEach((t) => tecnicosMap.set(t.id, t.nombre))
    }

    const items = (ordenes || []).map((o) => ({
      ordenId: o.orden_id,
      tecnicoId: o.tecnico_id,
      tecnicoNombre: tecnicosMap.get(o.tecnico_id) || "Sin nombre",
      codigoOrden: o.codigo_orden,
      numeroOrden: o.numero_orden,
      dispositivo: o.dispositivo,
      estado: o.estado,
      fechaCompletado: o.fecha_completado,
      costoFinal: Number(o.costo_final || 0),
      costoRepuestos: Number(o.costo_repuestos || 0),
      ganancia: Number(o.ganancia || 0),
      porcentajeComision: Number(o.porcentaje_comision || 0),
      montoComision: Number(o.monto_comision || 0),
      comisionPagada: !!o.comision_pagada,
      fechaPagoComision: o.fecha_pago_comision,
    }))

    // Totales por técnico
    const resumenMap = new Map<string, {
      tecnicoId: string
      tecnicoNombre: string
      totalOrdenes: number
      totalGanancia: number
      totalComision: number
      totalPendiente: number
    }>()
    for (const it of items) {
      const k = it.tecnicoId
      const cur = resumenMap.get(k) || {
        tecnicoId: k,
        tecnicoNombre: it.tecnicoNombre,
        totalOrdenes: 0,
        totalGanancia: 0,
        totalComision: 0,
        totalPendiente: 0,
      }
      cur.totalOrdenes += 1
      cur.totalGanancia += it.ganancia
      cur.totalComision += it.montoComision
      if (!it.comisionPagada) cur.totalPendiente += it.montoComision
      resumenMap.set(k, cur)
    }

    return NextResponse.json({
      items,
      resumen: Array.from(resumenMap.values()),
    }, { headers: { "Cache-Control": "no-store" } })
  } catch (err) {
    console.error("Error fetching comisiones:", err)
    return NextResponse.json({ error: "Error al obtener comisiones" }, { status: 500 })
  }
}
