import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

const LABELS_DISPOSITIVO: Record<string, string> = {
  CELULAR: "Celular",
  COMPUTADORA: "Computadora",
  TABLET: "Tablet",
  CONSOLA: "Consola",
  SMARTWATCH: "Smartwatch",
  ACCESORIOS: "Accesorios",
}

export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const meses = parseInt(searchParams.get("meses") || "6")

    // Calculate date range (last N months)
    const now = new Date()
    const fechaDesde = new Date(now.getFullYear(), now.getMonth() - meses + 1, 1)

    // Query 1: Facturas pagadas (ingresos por servicio técnico)
    const { data: facturas, error: facturasError } = await supabaseAdmin
      .from("facturas")
      .select(`
        id, total, fecha,
        ordenes_servicio!inner (
          id, organization_id, tipo_dispositivo, dispositivo
        )
      `)
      .eq("ordenes_servicio.organization_id", organizationId!)
      .eq("estado_pago", "PAGADO")
      .gte("fecha", fechaDesde.toISOString())

    if (facturasError) throw facturasError

    // Query 2: Ventas completadas (ingresos por venta de productos)
    const { data: ventas, error: ventasError } = await supabaseAdmin
      .from("ventas")
      .select("id, total, created_at")
      .eq("organization_id", organizationId!)
      .eq("estado", "COMPLETADA")
      .gte("created_at", fechaDesde.toISOString())

    if (ventasError) throw ventasError

    // Aggregate: income by month
    const ingresosPorMes: Record<string, { servicios: number; ventas: number }> = {}

    // Initialize all months
    for (let i = 0; i < meses; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - meses + 1 + i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
      ingresosPorMes[key] = { servicios: 0, ventas: 0 }
    }

    // Sum facturas by month
    for (const f of facturas || []) {
      const fecha = new Date(f.fecha)
      const key = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}`
      if (ingresosPorMes[key]) {
        ingresosPorMes[key].servicios += f.total || 0
      }
    }

    // Sum ventas by month
    for (const v of ventas || []) {
      const fecha = new Date(v.created_at)
      const key = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}`
      if (ingresosPorMes[key]) {
        ingresosPorMes[key].ventas += v.total || 0
      }
    }

    // Build monthly chart data
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

    // Aggregate: income by device type (only from servicios/facturas)
    const dispositivoMap = new Map<string, { total: number; cantidad: number }>()

    for (const f of facturas || []) {
      const orden = f.ordenes_servicio as any
      const tipo = orden?.tipo_dispositivo || "OTRO"
      const label = LABELS_DISPOSITIVO[tipo] || tipo
      const existing = dispositivoMap.get(label) || { total: 0, cantidad: 0 }
      existing.total += f.total || 0
      existing.cantidad++
      dispositivoMap.set(label, existing)
    }

    const porDispositivo = Array.from(dispositivoMap.entries())
      .map(([tipo, data]) => ({ tipo, total: data.total, cantidad: data.cantidad }))
      .sort((a, b) => b.total - a.total)

    // Totals
    const totalServicios = (facturas || []).reduce((sum, f) => sum + (f.total || 0), 0)
    const totalVentas = (ventas || []).reduce((sum, v) => sum + (v.total || 0), 0)

    return NextResponse.json({
      resumen: {
        totalIngresos: totalServicios + totalVentas,
        totalServicios,
        totalVentas,
        cantidadServicios: facturas?.length || 0,
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
