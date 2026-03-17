import { NextResponse } from "next/server"
import { requireAdminOrVendedor } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireAdminOrVendedor()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const desde = searchParams.get("desde")
    const hasta = searchParams.get("hasta")
    const tipo = searchParams.get("tipo") // VENTA, SERVICIO, o vacío para ambos

    let fechaDesde: Date
    let fechaHasta: Date | null = null

    if (desde && hasta) {
      fechaDesde = new Date(desde)
      fechaHasta = new Date(hasta)
    } else {
      fechaDesde = new Date()
      fechaDesde.setDate(fechaDesde.getDate() - 30)
    }

    // Obtener ventas POS completadas
    let ventasData: any[] = []
    if (!tipo || tipo === "VENTA") {
      let ventasQuery = supabaseAdmin
        .from("ventas")
        .select("id, numero_venta, cliente_nombre, total, descuento, metodo_pago, estado, created_at")
        .eq("organization_id", organizationId!)
        .eq("estado", "COMPLETADA")
        .gte("created_at", fechaDesde.toISOString())
        .order("created_at", { ascending: false })

      if (fechaHasta) {
        ventasQuery = ventasQuery.lte("created_at", fechaHasta.toISOString())
      }

      const { data } = await ventasQuery
      ventasData = (data || []).map((v) => ({
        id: v.id,
        tipoIngreso: "VENTA" as const,
        numero: String(v.numero_venta),
        clienteNombre: v.cliente_nombre,
        monto: parseFloat(v.total),
        descuento: parseFloat(v.descuento),
        metodoPago: v.metodo_pago,
        estado: v.estado,
        fecha: v.created_at,
      }))
    }

    // Obtener ingresos de facturas de servicio
    let facturasData: any[] = []
    if (!tipo || tipo === "SERVICIO") {
      let facturasQuery = supabaseAdmin
        .from("facturas")
        .select(`
          id, numero_factura, total, estado_pago, fecha,
          ordenes_servicio!inner (
            id, organization_id,
            clientes (nombre)
          )
        `)
        .eq("ordenes_servicio.organization_id", organizationId!)
        .gte("fecha", fechaDesde.toISOString())
        .order("fecha", { ascending: false })

      if (fechaHasta) {
        facturasQuery = facturasQuery.lte("fecha", fechaHasta.toISOString())
      }

      const { data } = await facturasQuery
      facturasData = (data || []).map((f: any) => ({
        id: f.id,
        tipoIngreso: "SERVICIO" as const,
        numero: f.numero_factura,
        clienteNombre: f.ordenes_servicio?.clientes?.nombre || "Sin cliente",
        monto: parseFloat(f.total),
        descuento: 0,
        metodoPago: "PENDIENTE",
        estado: f.estado_pago,
        fecha: f.fecha,
      }))
    }

    // Combinar y ordenar por fecha
    const ingresos = [...ventasData, ...facturasData].sort(
      (a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime()
    )

    // Calcular resumen
    const totalVentas = ventasData.reduce((sum, v) => sum + v.monto, 0)
    const totalServicios = facturasData.reduce((sum, f) => sum + f.monto, 0)
    const totalDescuentos = ventasData.reduce((sum, v) => sum + v.descuento, 0)

    return NextResponse.json({
      data: ingresos,
      resumen: {
        totalGeneral: totalVentas + totalServicios,
        totalVentas,
        totalServicios,
        totalDescuentos,
        cantidadVentas: ventasData.length,
        cantidadServicios: facturasData.length,
        cantidadTotal: ingresos.length,
      },
    })
  } catch (error) {
    console.error("Error fetching ingresos unificados:", error)
    return NextResponse.json(
      { error: "Error al obtener ingresos unificados" },
      { status: 500 }
    )
  }
}
