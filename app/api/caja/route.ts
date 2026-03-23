import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const fecha = searchParams.get("fecha") || new Date().toISOString().split("T")[0]
    const fechaDesde = `${fecha}T00:00:00`
    const fechaHasta = `${fecha}T23:59:59`

    // Cobros de órdenes del día
    const { data: cobrosOrdenes } = await supabaseAdmin
      .from("cobros_orden")
      .select("monto, metodo_pago, created_at, orden_id, observaciones")
      .eq("organization_id", organizationId!)
      .gte("created_at", fechaDesde)
      .lte("created_at", fechaHasta)
      .order("created_at", { ascending: false })

    // Pagos de facturas del día
    const { data: pagosFacturas } = await supabaseAdmin
      .from("pagos_parciales")
      .select(`
        monto, metodo_pago, fecha, factura_id, observaciones,
        facturas!inner(
          id, numero_factura,
          ordenes_servicio!inner(organization_id, numero_orden)
        )
      `)
      .eq("facturas.ordenes_servicio.organization_id", organizationId!)
      .gte("fecha", fechaDesde)
      .lte("fecha", fechaHasta)
      .order("fecha", { ascending: false })

    // Pagos de ventas del día
    const { data: pagosVentas } = await supabaseAdmin
      .from("pagos_venta")
      .select(`
        monto, metodo_pago, fecha, venta_id, observaciones,
        ventas!inner(organization_id, numero_venta)
      `)
      .eq("ventas.organization_id", organizationId!)
      .gte("fecha", fechaDesde)
      .lte("fecha", fechaHasta)
      .order("fecha", { ascending: false })

    // Depósitos cuenta corriente del día
    const { data: depositos } = await supabaseAdmin
      .from("cuenta_corriente")
      .select("monto, metodo_pago, created_at, observaciones, cliente_id")
      .eq("organization_id", organizationId!)
      .eq("tipo", "DEPOSITO")
      .gte("created_at", fechaDesde)
      .lte("created_at", fechaHasta)
      .order("created_at", { ascending: false })

    // Construir movimientos unificados
    const movimientos: any[] = []

    // Cobros de órdenes
    for (const c of cobrosOrdenes || []) {
      movimientos.push({
        tipo: "COBRO_ORDEN",
        monto: parseFloat(c.monto),
        metodoPago: c.metodo_pago,
        fecha: c.created_at,
        referencia: `Orden`,
        referenciaId: c.orden_id,
        observaciones: c.observaciones,
      })
    }

    // Pagos de facturas (evitar duplicar con cobros directos)
    for (const p of pagosFacturas || []) {
      movimientos.push({
        tipo: "PAGO_FACTURA",
        monto: parseFloat(p.monto),
        metodoPago: p.metodo_pago,
        fecha: p.fecha,
        referencia: `Factura`,
        referenciaId: p.factura_id,
        observaciones: p.observaciones,
      })
    }

    // Pagos de ventas
    for (const p of pagosVentas || []) {
      movimientos.push({
        tipo: "PAGO_VENTA",
        monto: parseFloat(p.monto),
        metodoPago: p.metodo_pago,
        fecha: p.fecha,
        referencia: `Venta`,
        referenciaId: p.venta_id,
        observaciones: p.observaciones,
      })
    }

    // Depósitos a cuenta
    for (const d of depositos || []) {
      movimientos.push({
        tipo: "DEPOSITO_CUENTA",
        monto: parseFloat(d.monto),
        metodoPago: d.metodo_pago,
        fecha: d.created_at,
        referencia: "Depósito a cuenta",
        referenciaId: d.cliente_id,
        observaciones: d.observaciones,
      })
    }

    // Ordenar por fecha desc
    movimientos.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())

    // Resumen por método de pago
    const porMetodo: Record<string, number> = {}
    const porTipo: Record<string, { count: number; total: number }> = {}

    for (const m of movimientos) {
      porMetodo[m.metodoPago] = (porMetodo[m.metodoPago] || 0) + m.monto
      if (!porTipo[m.tipo]) porTipo[m.tipo] = { count: 0, total: 0 }
      porTipo[m.tipo].count++
      porTipo[m.tipo].total += m.monto
    }

    const totalDia = movimientos.reduce((sum, m) => sum + m.monto, 0)

    // Órdenes reparadas sin cobrar
    const { data: sinCobrar, count: sinCobrarCount } = await supabaseAdmin
      .from("ordenes_servicio")
      .select("id, numero_orden, costo_final, total_cobrado, estado_cobro", { count: "exact" })
      .eq("organization_id", organizationId!)
      .in("estado", ["REPARADO", "ENTREGADO"])
      .in("estado_cobro", ["PENDIENTE", "PARCIAL"])
      .not("costo_final", "is", null)
      .gt("costo_final", 0)
      .order("created_at", { ascending: false })
      .limit(10)

    return NextResponse.json({
      fecha,
      totalDia,
      movimientos,
      porMetodo,
      porTipo,
      sinCobrar: {
        count: sinCobrarCount || 0,
        ordenes: (sinCobrar || []).map((o) => ({
          id: o.id,
          numeroOrden: o.numero_orden,
          costoFinal: parseFloat(o.costo_final || "0"),
          totalCobrado: parseFloat(o.total_cobrado || "0"),
          pendiente: parseFloat(o.costo_final || "0") - parseFloat(o.total_cobrado || "0"),
        })),
      },
    })
  } catch (err) {
    console.error("Error fetching caja:", err)
    return NextResponse.json({ error: "Error al obtener caja diaria" }, { status: 500 })
  }
}
