import { NextResponse } from "next/server"
import { requireAdminOrVendedor } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { sucursalParaLectura } from "@/lib/sucursal"

export async function GET(request: Request) {
  try {
    const { error, organizationId, role } = await requireAdminOrVendedor()
    if (error) return error

    const filtro = await sucursalParaLectura({ role, userSucursalId: null })

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

    // Obtener ventas POS completadas (branch-filtered directly)
    let ventasData: any[] = []
    if (!tipo || tipo === "VENTA") {
      let ventasQuery = supabaseAdmin
        .from("ventas")
        .select("id, numero_venta, cliente_nombre, total, descuento, metodo_pago, estado, created_at")
        .eq("organization_id", organizationId!)
        .eq("estado", "COMPLETADA")
        .gte("created_at", fechaDesde.toISOString())
        .order("created_at", { ascending: false })

      if (!filtro.verTodas && filtro.sucursalId) {
        ventasQuery = ventasQuery.eq("sucursal_id", filtro.sucursalId)
      }

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

    // Obtener ingresos de facturas de servicio + cobros directos (dedupe por orden)
    // Branch filter: facturas via ordenes_servicio!inner, cobros via ordenes_servicio!inner
    let facturasData: any[] = []
    let cobrosData: any[] = []
    if (!tipo || tipo === "SERVICIO") {
      let facturasQuery = supabaseAdmin
        .from("facturas")
        .select(`
          id, numero_factura, total, estado_pago, fecha, orden_id,
          ordenes_servicio!inner (
            id, organization_id, sucursal_id,
            clientes (nombre)
          )
        `)
        .eq("ordenes_servicio.organization_id", organizationId!)
        .gte("fecha", fechaDesde.toISOString())
        .order("fecha", { ascending: false })

      if (!filtro.verTodas && filtro.sucursalId) {
        facturasQuery = facturasQuery.eq("ordenes_servicio.sucursal_id", filtro.sucursalId)
      }

      if (fechaHasta) {
        facturasQuery = facturasQuery.lte("fecha", fechaHasta.toISOString())
      }

      let cobrosQuery = supabaseAdmin
        .from("cobros_orden")
        .select(`
          id, monto, created_at, orden_id, metodo_pago,
          ordenes_servicio!inner (
            id, organization_id, sucursal_id, numero_orden, codigo_orden,
            clientes (nombre)
          )
        `)
        .eq("organization_id", organizationId!)
        .eq("ordenes_servicio.organization_id", organizationId!)
        .neq("anulado", true)
        .gte("created_at", fechaDesde.toISOString())
        .order("created_at", { ascending: false })

      if (!filtro.verTodas && filtro.sucursalId) {
        cobrosQuery = cobrosQuery.eq("ordenes_servicio.sucursal_id", filtro.sucursalId)
      }

      if (fechaHasta) {
        cobrosQuery = cobrosQuery.lte("created_at", fechaHasta.toISOString())
      }

      const [facturasR, cobrosR] = await Promise.all([facturasQuery, cobrosQuery])
      const facturasRaw = (facturasR.data || []) as any[]
      const cobrosRaw = (cobrosR.data || []) as any[]

      // Dedupe: si una orden tiene cobro directo en el período, no contar su factura
      const ordenesConCobro = new Set(cobrosRaw.map((c) => c.orden_id))

      facturasData = facturasRaw
        .filter((f) => !ordenesConCobro.has(f.orden_id))
        .map((f) => ({
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

      cobrosData = cobrosRaw.map((c) => ({
        id: c.id,
        tipoIngreso: "SERVICIO" as const,
        numero: c.ordenes_servicio?.codigo_orden || String(c.ordenes_servicio?.numero_orden || ""),
        clienteNombre: c.ordenes_servicio?.clientes?.nombre || "Sin cliente",
        monto: parseFloat(c.monto),
        descuento: 0,
        metodoPago: c.metodo_pago || "EFECTIVO",
        estado: "COBRADO",
        fecha: c.created_at,
      }))
    }

    // Combinar y ordenar por fecha
    const ingresos = [...ventasData, ...facturasData, ...cobrosData].sort(
      (a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime()
    )

    // Calcular resumen
    const totalVentas = ventasData.reduce((sum, v) => sum + v.monto, 0)
    const totalServiciosFacturas = facturasData.reduce((sum, f) => sum + f.monto, 0)
    const totalServiciosCobros = cobrosData.reduce((sum, c) => sum + c.monto, 0)
    const totalServicios = totalServiciosFacturas + totalServiciosCobros
    const totalDescuentos = ventasData.reduce((sum, v) => sum + v.descuento, 0)

    return NextResponse.json({
      data: ingresos,
      resumen: {
        totalGeneral: totalVentas + totalServicios,
        totalVentas,
        totalServicios,
        totalDescuentos,
        cantidadVentas: ventasData.length,
        cantidadServicios: facturasData.length + cobrosData.length,
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
