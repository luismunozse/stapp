import { NextResponse } from "next/server"
import { requireAdminOrVendedor } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { hasPlanFeature } from "@/lib/subscriptions"

export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireAdminOrVendedor()
    if (error) return error

    const hasFeature = await hasPlanFeature(organizationId!, "advanced_reports")
    if (!hasFeature) {
      return NextResponse.json(
        { error: "Este reporte requiere el plan Profesional", code: "FEATURE_REQUIRED", feature: "advanced_reports" },
        { status: 403 }
      )
    }

    const { searchParams } = new URL(request.url)
    const periodo = searchParams.get("periodo") || "mes" // mes, trimestre, anio

    // Calcular fecha de inicio según período
    const now = new Date()
    let fechaInicio: Date
    switch (periodo) {
      case "trimestre":
        fechaInicio = new Date(now.getFullYear(), now.getMonth() - 3, 1)
        break
      case "anio":
        fechaInicio = new Date(now.getFullYear() - 1, now.getMonth(), 1)
        break
      default: // mes
        fechaInicio = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    }

    // Obtener órdenes completadas con fechas
    const { data: ordenes } = await supabaseAdmin
      .from("ordenes_servicio")
      .select("tipo_dispositivo, fecha_ingreso, fecha_completado")
      .eq("organization_id", organizationId!)
      .not("fecha_completado", "is", null)
      .gte("fecha_completado", fechaInicio.toISOString())
      .in("estado", ["REPARADO", "ENTREGADO"])

    if (!ordenes || ordenes.length === 0) {
      return NextResponse.json({ data: [], promedioGeneral: 0 })
    }

    // Calcular promedio por tipo de dispositivo
    const porTipo: Record<string, { total: number; count: number }> = {}

    for (const orden of ordenes) {
      const tipo = orden.tipo_dispositivo || "OTRO"
      const ingreso = new Date(orden.fecha_ingreso).getTime()
      const completado = new Date(orden.fecha_completado).getTime()
      const horasReparacion = (completado - ingreso) / (1000 * 60 * 60)

      if (!porTipo[tipo]) {
        porTipo[tipo] = { total: 0, count: 0 }
      }
      porTipo[tipo].total += horasReparacion
      porTipo[tipo].count++
    }

    const data = Object.entries(porTipo).map(([tipo, stats]) => ({
      tipoDispositivo: tipo,
      promedioHoras: Math.round((stats.total / stats.count) * 10) / 10,
      promedioDias: Math.round((stats.total / stats.count / 24) * 10) / 10,
      cantidad: stats.count,
    }))

    const totalHoras = Object.values(porTipo).reduce((acc, s) => acc + s.total, 0)
    const totalCount = Object.values(porTipo).reduce((acc, s) => acc + s.count, 0)
    const promedioGeneral = totalCount > 0 ? Math.round((totalHoras / totalCount / 24) * 10) / 10 : 0

    return NextResponse.json({ data, promedioGeneral })
  } catch (err) {
    console.error("Error en reporte tiempo-reparacion:", err)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
