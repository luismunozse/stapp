import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const desde = searchParams.get("desde")
    const hasta = searchParams.get("hasta")

    let fechaDesde: Date
    let fechaHasta: Date | null = null

    if (desde && hasta) {
      fechaDesde = new Date(desde)
      fechaHasta = new Date(hasta)
    } else {
      // Últimos 30 días por defecto
      fechaDesde = new Date()
      fechaDesde.setDate(fechaDesde.getDate() - 30)
    }

    let query = supabaseAdmin
      .from("facturas")
      .select(`
        *,
        ordenes_servicio!inner (
          id, numero_orden, organization_id,
          clientes (*)
        )
      `)
      .eq("ordenes_servicio.organization_id", organizationId!)
      .eq("estado_pago", "PAGADO")
      .gte("fecha", fechaDesde.toISOString())
      .order("fecha", { ascending: true })

    if (fechaHasta) {
      query = query.lte("fecha", fechaHasta.toISOString())
    }

    const { data: facturas, error: dbError } = await query

    if (dbError) throw dbError

    const total = facturas?.reduce((sum, f) => sum + f.total, 0) || 0
    const totalIva = facturas?.reduce((sum, f) => sum + f.iva, 0) || 0
    const totalSubtotal = facturas?.reduce((sum, f) => sum + f.subtotal, 0) || 0

    const facturasFormatted = facturas?.map(f => ({
      id: f.id,
      ordenId: f.orden_id,
      numeroFactura: f.numero_factura,
      fecha: f.fecha,
      subtotal: f.subtotal,
      iva: f.iva,
      total: f.total,
      estadoPago: f.estado_pago,
      orden: {
        id: f.ordenes_servicio.id,
        numeroOrden: f.ordenes_servicio.numero_orden,
        cliente: f.ordenes_servicio.clientes,
      },
    }))

    return NextResponse.json({
      facturas: facturasFormatted,
      resumen: {
        total,
        totalIva,
        totalSubtotal,
        cantidad: facturas?.length || 0,
      },
    })
  } catch (error) {
    console.error("Error fetching ingresos:", error)
    return NextResponse.json(
      { error: "Error al obtener ingresos" },
      { status: 500 }
    )
  }
}

