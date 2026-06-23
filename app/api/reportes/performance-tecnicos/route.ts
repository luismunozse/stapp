import { NextResponse } from "next/server"
import { requireAdminOrVendedor } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { ESTADOS_ACTIVOS, ESTADOS_COMPLETADOS } from "@/lib/order-states"
import { sucursalParaLectura } from "@/lib/sucursal"

interface TecnicoPerformance {
  tecnicoId: string
  nombre: string
  ordenesCompletadas: number
  ordenesEnProceso: number
  tiempoPromedioReparacion: number | null
  tasaCompletado: number
}

/**
 * GET /api/reportes/performance-tecnicos
 * Métricas de rendimiento por técnico
 */
export async function GET() {
  try {
    const { error, organizationId, role, session } = await requireAdminOrVendedor()
    if (error) return error

    // Obtener técnicos de la organización
    const { data: tecnicos, error: tecnicosError } = await supabaseAdmin
      .from("users")
      .select("id, nombre")
      .eq("organization_id", organizationId!)
      .eq("rol", "TECNICO")

    if (tecnicosError) throw tecnicosError

    // Obtener todas las órdenes asignadas del mes actual
    const primerDiaMes = new Date()
    primerDiaMes.setDate(1)
    primerDiaMes.setHours(0, 0, 0, 0)

    const filtro = await sucursalParaLectura({ role, userSucursalId: session!.user.sucursalId ?? null })

    let ordenesQuery = supabaseAdmin
      .from("ordenes_servicio")
      .select("tecnico_id, estado, fecha_ingreso, fecha_completado")
      .eq("organization_id", organizationId!)
      .not("tecnico_id", "is", null)
      .gte("fecha_ingreso", primerDiaMes.toISOString())

    if (!filtro.verTodas && filtro.sucursalId) {
      ordenesQuery = ordenesQuery.eq("sucursal_id", filtro.sucursalId)
    }

    const { data: ordenes, error: ordenesError } = await ordenesQuery

    if (ordenesError) throw ordenesError

    // Calcular métricas por técnico
    const performance: TecnicoPerformance[] = (tecnicos || []).map((tecnico) => {
      const ordenesTecnico = (ordenes || []).filter(
        (o) => o.tecnico_id === tecnico.id
      )

      // Numerator: REPARADO | ENTREGADO (classic success) + ENTREGADO_SIN_REPARACION
      // (tech diagnosed and returned device — work done, not a failure)
      const ESTADOS_COMPLETADOS_TECNICO = [...ESTADOS_COMPLETADOS, "ENTREGADO_SIN_REPARACION"] as string[]
      const completadas = ordenesTecnico.filter((o) =>
        ESTADOS_COMPLETADOS_TECNICO.includes(o.estado)
      )
      const enProceso = ordenesTecnico.filter((o) =>
        ESTADOS_ACTIVOS.includes(o.estado)
      )

      // Calcular tiempo promedio de reparación (solo para completadas con fechas)
      const tiemposReparacion = completadas
        .filter((o) => o.fecha_completado && o.fecha_ingreso)
        .map((o) => {
          const inicio = new Date(o.fecha_ingreso)
          const fin = new Date(o.fecha_completado!)
          return (fin.getTime() - inicio.getTime()) / (1000 * 60 * 60 * 24) // días
        })

      const tiempoPromedio =
        tiemposReparacion.length > 0
          ? tiemposReparacion.reduce((a, b) => a + b, 0) / tiemposReparacion.length
          : null

      // Tasa de completado:
      // Denominator excludes CANCELADO (cancellation is not the tech's failure to complete)
      const totalOrdenes = ordenesTecnico.filter((o) => o.estado !== "CANCELADO").length
      const tasaCompletado =
        totalOrdenes > 0 ? (completadas.length / totalOrdenes) * 100 : 0

      return {
        tecnicoId: tecnico.id,
        nombre: tecnico.nombre,
        ordenesCompletadas: completadas.length,
        ordenesEnProceso: enProceso.length,
        tiempoPromedioReparacion: tiempoPromedio
          ? Math.round(tiempoPromedio * 10) / 10
          : null,
        tasaCompletado: Math.round(tasaCompletado),
      }
    })

    // Ordenar por órdenes completadas
    performance.sort((a, b) => b.ordenesCompletadas - a.ordenesCompletadas)

    // Calcular totales
    const totales = {
      totalOrdenes: (ordenes || []).length,
      totalCompletadas: performance.reduce((sum, t) => sum + t.ordenesCompletadas, 0),
      totalEnProceso: performance.reduce((sum, t) => sum + t.ordenesEnProceso, 0),
      promedioTiempo:
        performance.filter((t) => t.tiempoPromedioReparacion !== null).length > 0
          ? performance
              .filter((t) => t.tiempoPromedioReparacion !== null)
              .reduce((sum, t) => sum + (t.tiempoPromedioReparacion || 0), 0) /
            performance.filter((t) => t.tiempoPromedioReparacion !== null).length
          : null,
    }

    return NextResponse.json({
      tecnicos: performance,
      totales,
      periodo: {
        desde: primerDiaMes.toISOString(),
        hasta: new Date().toISOString(),
      },
    })
  } catch (error) {
    console.error("Error en performance técnicos:", error)
    return NextResponse.json(
      { error: "Error al obtener performance de técnicos" },
      { status: 500 }
    )
  }
}
