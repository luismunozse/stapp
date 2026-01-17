import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { isPremium } from "@/lib/subscriptions"
import { supabaseAdmin } from "@/lib/supabase"

/**
 * GET /api/reportes/comparativa-ingresos
 * Compara ingresos del mes actual vs mes anterior
 * Solo usuarios Premium
 */
export async function GET() {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    // Verificar Premium
    const premium = await isPremium(organizationId!)
    if (!premium) {
      return NextResponse.json(
        { error: "Requiere plan Premium", code: "PREMIUM_REQUIRED" },
        { status: 403 }
      )
    }

    const now = new Date()
    const primerDiaMesActual = new Date(now.getFullYear(), now.getMonth(), 1)
    const primerDiaMesAnterior = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const ultimoDiaMesAnterior = new Date(now.getFullYear(), now.getMonth(), 0)

    // Ingresos mes actual
    const { data: ingresosActual, error: errorActual } = await supabaseAdmin
      .from("facturas")
      .select("total, orden:ordenes_servicio!inner(organization_id)")
      .eq("estado_pago", "PAGADO")
      .eq("orden.organization_id", organizationId!)
      .gte("fecha", primerDiaMesActual.toISOString())

    if (errorActual) throw errorActual

    // Ingresos mes anterior
    const { data: ingresosAnterior, error: errorAnterior } = await supabaseAdmin
      .from("facturas")
      .select("total, orden:ordenes_servicio!inner(organization_id)")
      .eq("estado_pago", "PAGADO")
      .eq("orden.organization_id", organizationId!)
      .gte("fecha", primerDiaMesAnterior.toISOString())
      .lte("fecha", ultimoDiaMesAnterior.toISOString())

    if (errorAnterior) throw errorAnterior

    // Calcular totales
    const totalActual = (ingresosActual || []).reduce(
      (sum, f) => sum + (f.total || 0),
      0
    )
    const cantidadActual = ingresosActual?.length || 0
    const promedioActual = cantidadActual > 0 ? totalActual / cantidadActual : 0

    const totalAnterior = (ingresosAnterior || []).reduce(
      (sum, f) => sum + (f.total || 0),
      0
    )
    const cantidadAnterior = ingresosAnterior?.length || 0
    const promedioAnterior = cantidadAnterior > 0 ? totalAnterior / cantidadAnterior : 0

    // Calcular cambio porcentual
    let porcentajeCambio = 0
    let direccion: "up" | "down" | "neutral" = "neutral"

    if (totalAnterior > 0) {
      porcentajeCambio = ((totalActual - totalAnterior) / totalAnterior) * 100
      direccion = porcentajeCambio > 0 ? "up" : porcentajeCambio < 0 ? "down" : "neutral"
    } else if (totalActual > 0) {
      porcentajeCambio = 100
      direccion = "up"
    }

    return NextResponse.json({
      mesActual: {
        nombre: obtenerNombreMes(now),
        total: totalActual,
        cantidad: cantidadActual,
        promedio: promedioActual,
      },
      mesAnterior: {
        nombre: obtenerNombreMes(new Date(now.getFullYear(), now.getMonth() - 1)),
        total: totalAnterior,
        cantidad: cantidadAnterior,
        promedio: promedioAnterior,
      },
      cambio: {
        porcentaje: Math.round(porcentajeCambio * 10) / 10,
        direccion,
        diferencia: totalActual - totalAnterior,
      },
    })
  } catch (error) {
    console.error("Error en comparativa de ingresos:", error)
    return NextResponse.json(
      { error: "Error al obtener comparativa de ingresos" },
      { status: 500 }
    )
  }
}

function obtenerNombreMes(fecha: Date): string {
  return fecha.toLocaleDateString("es-AR", { month: "long", year: "numeric" })
}
