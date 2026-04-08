import { NextRequest, NextResponse } from "next/server"
import { requireAdminOrVendedor } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

interface ClienteTop {
  clienteId: string
  nombre: string
  telefono: string | null
  email: string | null
  totalOrdenes: number
  totalGastado: number
  ultimaVisita: string | null
}

/**
 * GET /api/reportes/top-clientes
 * Top 10 clientes por órdenes o monto gastado
 * Solo usuarios Premium
 */
export async function GET(request: NextRequest) {
  try {
    const { error, organizationId } = await requireAdminOrVendedor()
    if (error) return error

    const searchParams = request.nextUrl.searchParams
    const tipo = searchParams.get("tipo") || "ordenes" // 'ordenes' | 'monto'
    const limite = parseInt(searchParams.get("limite") || "10")

    // Query 1: Get all clientes
    const { data: clientes, error: clientesError } = await supabaseAdmin
      .from("clientes")
      .select("id, nombre, telefono, email")
      .eq("organization_id", organizationId!)

    if (clientesError) throw clientesError

    // Query 2: Get ordenes with facturas (separate queries to avoid nested embed issues)
    const { data: ordenes, error: ordenesError } = await supabaseAdmin
      .from("ordenes_servicio")
      .select("id, cliente_id, fecha_ingreso, facturas(total, estado_pago)")
      .eq("organization_id", organizationId!)

    if (ordenesError) throw ordenesError

    // Aggregate by client
    const metricsMap = new Map<string, { totalOrdenes: number; totalGastado: number; ultimaVisita: string | null }>()

    for (const orden of ordenes || []) {
      if (!orden.cliente_id) continue
      const m = metricsMap.get(orden.cliente_id) || { totalOrdenes: 0, totalGastado: 0, ultimaVisita: null }
      m.totalOrdenes++

      const facturasRaw = (orden as any).facturas
      const facturas = Array.isArray(facturasRaw) ? facturasRaw : facturasRaw ? [facturasRaw] : []
      for (const f of facturas) {
        if (f.estado_pago === "PAGADO") {
          m.totalGastado += Number(f.total) || 0
        }
      }

      if (orden.fecha_ingreso && (!m.ultimaVisita || orden.fecha_ingreso > m.ultimaVisita)) {
        m.ultimaVisita = orden.fecha_ingreso
      }

      metricsMap.set(orden.cliente_id, m)
    }

    // Build final list
    const clientesConMetricas: ClienteTop[] = (clientes || []).map((cliente) => {
      const m = metricsMap.get(cliente.id) || { totalOrdenes: 0, totalGastado: 0, ultimaVisita: null }
      return {
        clienteId: cliente.id,
        nombre: cliente.nombre,
        telefono: cliente.telefono,
        email: cliente.email,
        totalOrdenes: m.totalOrdenes,
        totalGastado: m.totalGastado,
        ultimaVisita: m.ultimaVisita,
      }
    })

    // Filtrar clientes sin actividad
    const clientesActivos = clientesConMetricas.filter(
      (c) => c.totalOrdenes > 0 || c.totalGastado > 0
    )

    // Ordenar según el tipo solicitado
    if (tipo === "monto") {
      clientesActivos.sort((a, b) => b.totalGastado - a.totalGastado)
    } else {
      clientesActivos.sort((a, b) => b.totalOrdenes - a.totalOrdenes)
    }

    // Limitar resultados
    const topClientes = clientesActivos.slice(0, limite)

    // Estadísticas generales
    const estadisticas = {
      totalClientes: clientes?.length || 0,
      clientesActivos: clientesActivos.length,
      totalOrdenes: clientesActivos.reduce((sum, c) => sum + c.totalOrdenes, 0),
      totalIngresos: clientesActivos.reduce((sum, c) => sum + c.totalGastado, 0),
      promedioOrdenesCliente:
        clientesActivos.length > 0
          ? clientesActivos.reduce((sum, c) => sum + c.totalOrdenes, 0) /
            clientesActivos.length
          : 0,
      promedioGastoCliente:
        clientesActivos.length > 0
          ? clientesActivos.reduce((sum, c) => sum + c.totalGastado, 0) /
            clientesActivos.length
          : 0,
    }

    return NextResponse.json({
      clientes: topClientes,
      estadisticas,
      ordenadoPor: tipo,
    })
  } catch (error) {
    console.error("Error en top clientes:", error)
    return NextResponse.json(
      { error: "Error al obtener top clientes" },
      { status: 500 }
    )
  }
}
