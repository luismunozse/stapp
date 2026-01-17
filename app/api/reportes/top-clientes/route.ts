import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { isPremium } from "@/lib/subscriptions"
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

    const searchParams = request.nextUrl.searchParams
    const tipo = searchParams.get("tipo") || "ordenes" // 'ordenes' | 'monto'
    const limite = parseInt(searchParams.get("limite") || "10")

    // Obtener clientes con sus órdenes y facturas
    const { data: clientes, error: clientesError } = await supabaseAdmin
      .from("clientes")
      .select(
        `
        id,
        nombre,
        telefono,
        email,
        ordenes:ordenes_servicio(
          id,
          fecha_ingreso,
          facturas(total, estado_pago)
        )
      `
      )
      .eq("organization_id", organizationId!)

    if (clientesError) throw clientesError

    // Procesar datos
    const clientesConMetricas: ClienteTop[] = (clientes || []).map((cliente) => {
      const ordenes = cliente.ordenes || []
      const totalOrdenes = ordenes.length

      // Calcular total gastado (solo facturas pagadas)
      let totalGastado = 0
      ordenes.forEach((orden: any) => {
        const facturas = orden.facturas || []
        facturas.forEach((factura: any) => {
          if (factura.estado_pago === "PAGADO") {
            totalGastado += factura.total || 0
          }
        })
      })

      // Última visita (orden más reciente)
      const fechasIngreso = ordenes
        .map((o: any) => o.fecha_ingreso)
        .filter(Boolean)
        .sort()
        .reverse()
      const ultimaVisita = fechasIngreso[0] || null

      return {
        clienteId: cliente.id,
        nombre: cliente.nombre,
        telefono: cliente.telefono,
        email: cliente.email,
        totalOrdenes,
        totalGastado,
        ultimaVisita,
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
