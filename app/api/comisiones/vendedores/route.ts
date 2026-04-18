import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const vendedorId = searchParams.get("vendedorId")
    const desde = searchParams.get("desde")
    const hasta = searchParams.get("hasta")
    const soloPendientes = searchParams.get("soloPendientes") === "true"

    let query = supabaseAdmin
      .from("v_comisiones_ventas")
      .select(`
        venta_id,
        vendedor_id,
        numero_venta,
        cliente_nombre,
        created_at,
        total,
        porcentaje_comision,
        monto_comision,
        comision_pagada,
        fecha_pago_comision
      `)
      .eq("organization_id", organizationId!)
      .order("created_at", { ascending: false })

    if (vendedorId && vendedorId !== "all") query = query.eq("vendedor_id", vendedorId)
    if (desde) query = query.gte("created_at", desde)
    if (hasta) query = query.lte("created_at", hasta)
    if (soloPendientes) query = query.eq("comision_pagada", false)

    const { data: ventas, error: qErr } = await query
    if (qErr) throw qErr

    const vendedorIds = Array.from(
      new Set((ventas || []).map((v) => v.vendedor_id).filter(Boolean))
    )
    const vendedoresMap = new Map<string, string>()
    if (vendedorIds.length > 0) {
      const { data: vs } = await supabaseAdmin
        .from("users")
        .select("id, nombre")
        .in("id", vendedorIds)
      ;(vs || []).forEach((v) => vendedoresMap.set(v.id, v.nombre))
    }

    const items = (ventas || []).map((v) => ({
      ventaId: v.venta_id,
      vendedorId: v.vendedor_id,
      vendedorNombre: vendedoresMap.get(v.vendedor_id) || "Sin nombre",
      numeroVenta: v.numero_venta,
      clienteNombre: v.cliente_nombre,
      fecha: v.created_at,
      total: Number(v.total || 0),
      porcentajeComision: Number(v.porcentaje_comision || 0),
      montoComision: Number(v.monto_comision || 0),
      comisionPagada: !!v.comision_pagada,
      fechaPagoComision: v.fecha_pago_comision,
    }))

    const resumenMap = new Map<
      string,
      {
        vendedorId: string
        vendedorNombre: string
        totalVentas: number
        totalFacturado: number
        totalComision: number
        totalPendiente: number
      }
    >()
    for (const it of items) {
      if (!it.vendedorId) continue
      const k = it.vendedorId
      const cur = resumenMap.get(k) || {
        vendedorId: k,
        vendedorNombre: it.vendedorNombre,
        totalVentas: 0,
        totalFacturado: 0,
        totalComision: 0,
        totalPendiente: 0,
      }
      cur.totalVentas += 1
      cur.totalFacturado += it.total
      cur.totalComision += it.montoComision
      if (!it.comisionPagada) cur.totalPendiente += it.montoComision
      resumenMap.set(k, cur)
    }

    return NextResponse.json(
      { items, resumen: Array.from(resumenMap.values()) },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (err) {
    console.error("Error fetching comisiones vendedores:", err)
    return NextResponse.json(
      { error: "Error al obtener comisiones de vendedores" },
      { status: 500 }
    )
  }
}
