import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

interface VendedorPerformance {
  vendedorId: string
  nombre: string
  ventasCompletadas: number
  ventasAnuladas: number
  montoTotal: number
  ticketPromedio: number | null
  tasaCompletado: number
}

/**
 * GET /api/reportes/performance-vendedores
 * Métricas de rendimiento por vendedor
 */
export async function GET() {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    // Obtener vendedores de la organización
    const { data: vendedores, error: vendedoresError } = await supabaseAdmin
      .from("users")
      .select("id, nombre")
      .eq("organization_id", organizationId!)
      .eq("rol", "VENDEDOR")

    if (vendedoresError) throw vendedoresError

    // Obtener todas las ventas del mes actual
    const primerDiaMes = new Date()
    primerDiaMes.setDate(1)
    primerDiaMes.setHours(0, 0, 0, 0)

    const { data: ventas, error: ventasError } = await supabaseAdmin
      .from("ventas")
      .select("vendedor_id, estado, total, created_at")
      .eq("organization_id", organizationId!)
      .gte("created_at", primerDiaMes.toISOString())

    if (ventasError) throw ventasError

    // Calcular métricas por vendedor
    const performance: VendedorPerformance[] = (vendedores || []).map((vendedor) => {
      const ventasVendedor = (ventas || []).filter(
        (v) => v.vendedor_id === vendedor.id
      )

      const completadas = ventasVendedor.filter((v) => v.estado === "COMPLETADA")
      const anuladas = ventasVendedor.filter((v) => v.estado === "ANULADA")

      const montoTotal = completadas.reduce(
        (sum, v) => sum + parseFloat(v.total || "0"),
        0
      )

      const ticketPromedio =
        completadas.length > 0 ? montoTotal / completadas.length : null

      const totalVentas = ventasVendedor.length
      const tasaCompletado =
        totalVentas > 0 ? (completadas.length / totalVentas) * 100 : 0

      return {
        vendedorId: vendedor.id,
        nombre: vendedor.nombre,
        ventasCompletadas: completadas.length,
        ventasAnuladas: anuladas.length,
        montoTotal: Math.round(montoTotal * 100) / 100,
        ticketPromedio: ticketPromedio
          ? Math.round(ticketPromedio * 100) / 100
          : null,
        tasaCompletado: Math.round(tasaCompletado),
      }
    })

    // Ordenar por monto total
    performance.sort((a, b) => b.montoTotal - a.montoTotal)

    // Calcular totales
    const totales = {
      totalVentas: (ventas || []).length,
      totalCompletadas: performance.reduce((sum, v) => sum + v.ventasCompletadas, 0),
      totalAnuladas: performance.reduce((sum, v) => sum + v.ventasAnuladas, 0),
      montoTotal: performance.reduce((sum, v) => sum + v.montoTotal, 0),
      ticketPromedioGeneral:
        performance.filter((v) => v.ticketPromedio !== null).length > 0
          ? performance
              .filter((v) => v.ticketPromedio !== null)
              .reduce((sum, v) => sum + (v.ticketPromedio || 0), 0) /
            performance.filter((v) => v.ticketPromedio !== null).length
          : null,
    }

    return NextResponse.json({
      vendedores: performance,
      totales,
      periodo: {
        desde: primerDiaMes.toISOString(),
        hasta: new Date().toISOString(),
      },
    })
  } catch (error) {
    console.error("Error en performance vendedores:", error)
    return NextResponse.json(
      { error: "Error al obtener performance de vendedores" },
      { status: 500 }
    )
  }
}
