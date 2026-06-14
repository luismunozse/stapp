import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { sucursalParaLectura } from "@/lib/sucursal"

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
 * GET /api/reportes/performance-vendedores?desde=ISO&hasta=ISO
 * Métricas de rendimiento por vendedor en un rango de fechas.
 * Si desde/hasta no se envían, usa el mes actual.
 */
export async function GET(request: Request) {
  try {
    const { error, organizationId, role } = await requireAdmin()
    if (error) return error

    // Resolve branch filter — filtro wired in PR2; RPC param wiring lands in PR3b
    const filtro = await sucursalParaLectura({ role, userSucursalId: null })
    // TODO(PR3b): pass filtro.sucursalId as p_sucursal_id to get_vendedores_stats RPC

    const { searchParams } = new URL(request.url)
    const desdeParam = searchParams.get("desde")
    const hastaParam = searchParams.get("hasta")

    let desde: Date
    let hasta: Date

    if (desdeParam) {
      desde = new Date(desdeParam)
      if (Number.isNaN(desde.getTime())) {
        return NextResponse.json({ error: "Parámetro 'desde' inválido" }, { status: 400 })
      }
    } else {
      desde = new Date()
      desde.setDate(1)
      desde.setHours(0, 0, 0, 0)
    }

    if (hastaParam) {
      hasta = new Date(hastaParam)
      if (Number.isNaN(hasta.getTime())) {
        return NextResponse.json({ error: "Parámetro 'hasta' inválido" }, { status: 400 })
      }
    } else {
      hasta = new Date()
    }

    if (desde > hasta) {
      return NextResponse.json({ error: "'desde' no puede ser posterior a 'hasta'" }, { status: 400 })
    }

    const [vendedoresRes, statsRes] = await Promise.all([
      supabaseAdmin
        .from("users")
        .select("id, nombre")
        .eq("organization_id", organizationId!)
        .eq("rol", "VENDEDOR"),
      supabaseAdmin.rpc("get_vendedores_stats", {
        p_org_id: organizationId!,
        p_desde: desde.toISOString(),
        p_hasta: hasta.toISOString(),
      }),
    ])

    if (vendedoresRes.error) throw vendedoresRes.error
    if (statsRes.error) throw statsRes.error

    const statsByVendedor = new Map<string, any>()
    for (const row of statsRes.data || []) {
      statsByVendedor.set(row.vendedor_id, row)
    }

    const performance: VendedorPerformance[] = (vendedoresRes.data || []).map((vendedor) => {
      const stats = statsByVendedor.get(vendedor.id)
      const completadas = Number(stats?.ventas_completadas ?? 0)
      const anuladas = Number(stats?.ventas_anuladas ?? 0)
      const totalVentas = Number(stats?.ventas_total ?? 0)
      const montoTotal = Number(stats?.monto_total ?? 0)
      const ticketPromedio = stats?.ticket_promedio !== null && stats?.ticket_promedio !== undefined
        ? Number(stats.ticket_promedio)
        : null

      return {
        vendedorId: vendedor.id,
        nombre: vendedor.nombre,
        ventasCompletadas: completadas,
        ventasAnuladas: anuladas,
        montoTotal: Math.round(montoTotal * 100) / 100,
        ticketPromedio: ticketPromedio !== null
          ? Math.round(ticketPromedio * 100) / 100
          : null,
        tasaCompletado: totalVentas > 0
          ? Math.round((completadas / totalVentas) * 100)
          : 0,
      }
    })

    performance.sort((a, b) => b.montoTotal - a.montoTotal)

    const vendedoresConVentas = performance.filter((v) => v.ticketPromedio !== null)
    const totales = {
      totalVentas: performance.reduce((sum, v) => sum + v.ventasCompletadas + v.ventasAnuladas, 0),
      totalCompletadas: performance.reduce((sum, v) => sum + v.ventasCompletadas, 0),
      totalAnuladas: performance.reduce((sum, v) => sum + v.ventasAnuladas, 0),
      montoTotal: performance.reduce((sum, v) => sum + v.montoTotal, 0),
      ticketPromedioGeneral: vendedoresConVentas.length > 0
        ? vendedoresConVentas.reduce((sum, v) => sum + (v.ticketPromedio || 0), 0) / vendedoresConVentas.length
        : null,
    }

    return NextResponse.json({
      vendedores: performance,
      totales,
      periodo: {
        desde: desde.toISOString(),
        hasta: hasta.toISOString(),
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
