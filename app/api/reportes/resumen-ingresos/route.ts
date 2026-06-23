import { NextResponse } from "next/server"
import { requireAdminOrVendedor } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { sucursalParaLectura } from "@/lib/sucursal"
import { getDeviceTypeLabel } from "@/lib/device-types"

export async function GET(request: Request) {
  try {
    const { error, organizationId, role, session } = await requireAdminOrVendedor()
    if (error) return error

    const filtro = await sucursalParaLectura({ role, userSucursalId: session!.user.sucursalId ?? null })

    const { searchParams } = new URL(request.url)
    const meses = parseInt(searchParams.get("meses") || "6")

    // Calculate date range (last N months)
    const now = new Date()
    const fechaDesde = new Date(now.getFullYear(), now.getMonth() - meses + 1, 1)

    const desdeISO = fechaDesde.toISOString()

    // Facturas pagadas (branch-filtered via ordenes_servicio!inner)
    let facturasQuery = supabaseAdmin
      .from("facturas")
      .select(`
        id, total, fecha, orden_id,
        ordenes_servicio!inner (
          id, organization_id, sucursal_id, tipo_dispositivo, dispositivo,
          tipos_dispositivo:tipo_dispositivo_id(nombre)
        )
      `)
      .eq("ordenes_servicio.organization_id", organizationId!)
      .eq("estado_pago", "PAGADO")
      .gte("fecha", desdeISO)
    if (!filtro.verTodas && filtro.sucursalId) {
      facturasQuery = facturasQuery.eq("ordenes_servicio.sucursal_id", filtro.sucursalId)
    }

    const { data: facturas, error: facturasError } = await facturasQuery
    if (facturasError) throw facturasError

    // Ventas completadas (branch-filtered directly)
    let ventasQuery = supabaseAdmin
      .from("ventas")
      .select("id, total, created_at")
      .eq("organization_id", organizationId!)
      .eq("estado", "COMPLETADA")
      .gte("created_at", desdeISO)
    if (!filtro.verTodas && filtro.sucursalId) {
      ventasQuery = ventasQuery.eq("sucursal_id", filtro.sucursalId)
    }

    const { data: ventas, error: ventasError } = await ventasQuery
    if (ventasError) throw ventasError

    // Cobros directos a órdenes (branch-filtered via ordenes_servicio!inner)
    let cobrosQuery = supabaseAdmin
      .from("cobros_orden")
      .select(`
        id, monto, created_at, orden_id,
        ordenes_servicio!inner (
          organization_id, sucursal_id, tipo_dispositivo, dispositivo,
          tipos_dispositivo:tipo_dispositivo_id(nombre)
        )
      `)
      .eq("organization_id", organizationId!)
      .eq("ordenes_servicio.organization_id", organizationId!)
      .neq("anulado", true)
      .gte("created_at", desdeISO)
    if (!filtro.verTodas && filtro.sucursalId) {
      cobrosQuery = cobrosQuery.eq("ordenes_servicio.sucursal_id", filtro.sucursalId)
    }

    const { data: cobros, error: cobrosError } = await cobrosQuery
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

    // Notas de crédito — restan del total del período (no por mes, muy complejo)
    let notasCreditoQuery = supabaseAdmin
      .from("notas_credito")
      .select("monto")
      .eq("organization_id", organizationId!)
      .eq("anulada", false)
      .gte("fecha", desdeISO)
    if (!filtro.verTodas && filtro.sucursalId) {
      notasCreditoQuery = notasCreditoQuery.eq("sucursal_id", filtro.sucursalId)
    }
    const { data: notasCredito } = await notasCreditoQuery
    const totalNotasCredito = (notasCredito || []).reduce(
      (sum: number, n: any) => sum + Number(n.monto || 0),
      0
    )

    return NextResponse.json({
      resumen: {
        totalIngresos: totalServicios + totalVentas - totalNotasCredito,
        totalServicios,
        totalVentas,
        totalNotasCredito,
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
