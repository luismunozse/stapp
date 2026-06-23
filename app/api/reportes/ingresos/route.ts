import { NextResponse } from "next/server"
import { requireAdminOrVendedor } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { sucursalParaLectura } from "@/lib/sucursal"

export async function GET(request: Request) {
  try {
    const { error, organizationId, role, session } = await requireAdminOrVendedor()
    if (error) return error

    const filtro = await sucursalParaLectura({ role, userSucursalId: session!.user.sucursalId ?? null })

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
          id, numero_orden, organization_id, sucursal_id,
          clientes (*)
        )
      `)
      .eq("ordenes_servicio.organization_id", organizationId!)
      .eq("estado_pago", "PAGADO")
      .gte("fecha", fechaDesde.toISOString())
      .order("fecha", { ascending: true })

    if (!filtro.verTodas && filtro.sucursalId) {
      query = query.eq("ordenes_servicio.sucursal_id", filtro.sucursalId)
    }

    if (fechaHasta) {
      query = query.lte("fecha", fechaHasta.toISOString())
    }

    const { data: facturas, error: dbError } = await query

    if (dbError) throw dbError

    const totalBruto = facturas?.reduce((sum, f) => sum + (f.total || 0), 0) || 0
    // IVA collected is a fiscal liability — income is NET (base imponible = subtotal)
    const totalIva = facturas?.reduce((sum, f) => sum + (Number(f.iva) || 0), 0) || 0
    const totalSubtotal = facturas?.reduce((sum, f) => sum + (Number(f.subtotal) || 0), 0) || 0

    // Notas de crédito — restan ingresos (mismo período + org + sucursal)
    let notasCreditoQuery = supabaseAdmin
      .from("notas_credito")
      .select("monto")
      .eq("organization_id", organizationId!)
      .eq("anulada", false)
      .gte("fecha", fechaDesde.toISOString())

    if (!filtro.verTodas && filtro.sucursalId) {
      notasCreditoQuery = notasCreditoQuery.eq("sucursal_id", filtro.sucursalId)
    }
    if (fechaHasta) {
      notasCreditoQuery = notasCreditoQuery.lte("fecha", fechaHasta.toISOString())
    }

    const { data: notasCredito } = await notasCreditoQuery
    const totalNotasCredito = (notasCredito || []).reduce(
      (sum: number, n: any) => sum + parseFloat(n.monto || "0"),
      0
    )

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
        // NET income (base imponible) = subtotal sum minus notas de crédito
        total: totalSubtotal - totalNotasCredito,
        totalBruto,
        totalIva,
        totalSubtotal,
        totalNotasCredito,
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

