import { NextResponse } from "next/server"
import { requireAdminOrVendedor } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { getDeviceTypeLabel } from "@/lib/device-types"

export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireAdminOrVendedor()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const meses = parseInt(searchParams.get("meses") || "6")

    // Calculate date range (last N months)
    const now = new Date()
    const fechaDesde = new Date(now.getFullYear(), now.getMonth() - meses + 1, 1)

    const desdeISO = fechaDesde.toISOString()

    // Facturas pagadas
    const { data: facturas, error: facturasError } = await supabaseAdmin
      .from("facturas")
      .select(`
        id, total, fecha, orden_id,
        ordenes_servicio!inner (
          id, organization_id, tipo_dispositivo, dispositivo,
          tipos_dispositivo:tipo_dispositivo_id(nombre)
        )
      `)
      .eq("ordenes_servicio.organization_id", organizationId!)
      .eq("estado_pago", "PAGADO")
      .gte("fecha", desdeISO)

    if (facturasError) throw facturasError

    // Ventas completadas
    const { data: ventas, error: ventasError } = await supabaseAdmin
      .from("ventas")
      .select("id, total, created_at")
      .eq("organization_id", organizationId!)
      .eq("estado", "COMPLETADA")
      .gte("created_at", desdeISO)

    if (ventasError) throw ventasError

    // Cobros directos a órdenes (sin factura formal)
    const { data: cobros, error: cobrosError } = await supabaseAdmin
      .from("cobros_orden")
      .select(`
        id, monto, created_at, orden_id,
        ordenes_servicio!inner (
          tipo_dispositivo, dispositivo,
          tipos_dispositivo:tipo_dispositivo_id(nombre)
        )
      `)
      .eq("organization_id", organizationId!)
      .neq("anulado", true)
      .gte("created_at", desdeISO)

    if (cobrosError) throw cobrosError

    // Set de órdenes con cobro directo — para excluir factura duplicada
    const ordenesConCobro = new Set((cobros || []).map((c: any) => c.orden_id))

    // Aggregate por mes
    const ingresosPorMes: Record<string, { servicios: number; ventas: number }> = {}
    for (let i = 0; i < meses; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - meses + 1 + i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
      ingresosPorMes[key] = { servicios: 0, ventas: 0 }
    }

    for (const f of facturas || []) {
      if (ordenesConCobro.has(f.orden_id)) continue
      const fecha = new Date(f.fecha)
      const key = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}`
      if (ingresosPorMes[key]) ingresosPorMes[key].servicios += f.total || 0
    }

    for (const c of (cobros || []) as any[]) {
      const fecha = new Date(c.created_at)
      const key = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}`
      if (ingresosPorMes[key]) ingresosPorMes[key].servicios += Number(c.monto || 0)
    }

    for (const v of ventas || []) {
      const fecha = new Date(v.created_at)
      const key = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}`
      if (ingresosPorMes[key]) ingresosPorMes[key].ventas += v.total || 0
    }

    const porMes = Object.entries(ingresosPorMes)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, data]) => {
        const [year, month] = key.split("-")
        const date = new Date(parseInt(year), parseInt(month) - 1)
        return {
          mes: date.toLocaleDateString("es-AR", { month: "short" }),
          mesCompleto: date.toLocaleDateString("es-AR", { month: "long", year: "numeric" }),
          servicios: data.servicios,
          ventas: data.ventas,
          total: data.servicios + data.ventas,
        }
      })

    // Aggregate por tipo de dispositivo (facturas + cobros, dedupe por orden)
    const dispositivoMap = new Map<string, { total: number; cantidad: number }>()

    for (const f of facturas || []) {
      if (ordenesConCobro.has(f.orden_id)) continue
      const orden = f.ordenes_servicio as any
      const tipo = orden?.tipo_dispositivo || "OTRO"
      const tipoDisp = orden?.tipos_dispositivo as any
      const label = getDeviceTypeLabel(tipo, tipoDisp?.nombre)
      const existing = dispositivoMap.get(label) || { total: 0, cantidad: 0 }
      existing.total += f.total || 0
      existing.cantidad++
      dispositivoMap.set(label, existing)
    }

    for (const c of (cobros || []) as any[]) {
      const orden = c.ordenes_servicio as any
      const tipo = orden?.tipo_dispositivo || "OTRO"
      const tipoDisp = orden?.tipos_dispositivo as any
      const label = getDeviceTypeLabel(tipo, tipoDisp?.nombre)
      const existing = dispositivoMap.get(label) || { total: 0, cantidad: 0 }
      existing.total += Number(c.monto || 0)
      existing.cantidad++
      dispositivoMap.set(label, existing)
    }

    const porDispositivo = Array.from(dispositivoMap.entries())
      .map(([tipo, data]) => ({ tipo, total: data.total, cantidad: data.cantidad }))
      .sort((a, b) => b.total - a.total)

    // Totals
    const totalFacturas = (facturas || [])
      .filter((f) => !ordenesConCobro.has(f.orden_id))
      .reduce((sum, f) => sum + (f.total || 0), 0)
    const totalCobros = (cobros || []).reduce((sum: number, c: any) => sum + Number(c.monto || 0), 0)
    const totalServicios = totalFacturas + totalCobros
    const totalVentas = (ventas || []).reduce((sum, v) => sum + (v.total || 0), 0)
    const cantidadFacturasNetas = (facturas || []).filter((f) => !ordenesConCobro.has(f.orden_id)).length

    return NextResponse.json({
      resumen: {
        totalIngresos: totalServicios + totalVentas,
        totalServicios,
        totalVentas,
        cantidadServicios: cantidadFacturasNetas + (cobros?.length || 0),
        cantidadVentas: ventas?.length || 0,
      },
      porMes,
      porDispositivo,
      periodo: {
        desde: fechaDesde.toISOString(),
        hasta: now.toISOString(),
        meses,
      },
    })
  } catch (error) {
    console.error("Error en resumen de ingresos:", error)
    return NextResponse.json(
      { error: "Error al obtener resumen de ingresos" },
      { status: 500 }
    )
  }
}
