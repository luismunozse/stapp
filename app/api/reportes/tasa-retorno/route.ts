import { NextResponse } from "next/server"
import { requireAdminOrVendedor } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { hasPlanFeature } from "@/lib/subscriptions"
import { sucursalParaLectura } from "@/lib/sucursal"

export async function GET() {
  try {
    const { error, organizationId, role, session } = await requireAdminOrVendedor()
    if (error) return error

    const hasFeature = await hasPlanFeature(organizationId!, "advanced_reports")
    if (!hasFeature) {
      return NextResponse.json(
        { error: "Este reporte requiere el plan Profesional", code: "FEATURE_REQUIRED", feature: "advanced_reports" },
        { status: 403 }
      )
    }

    const seisAtras = new Date()
    seisAtras.setMonth(seisAtras.getMonth() - 6)

    const filtro = await sucursalParaLectura({ role, userSucursalId: session!.user.sucursalId ?? null })

    // Obtener clientes con cantidad de órdenes
    const { data: clientes } = await supabaseAdmin
      .from("clientes")
      .select("id, nombre, telefono")
      .eq("organization_id", organizationId!)

    if (!clientes || clientes.length === 0) {
      return NextResponse.json({ tasaRetorno: 0, totalClientes: 0, clientesRecurrentes: 0, topClientes: [] })
    }

    // Obtener órdenes de los últimos 6 meses agrupadas por cliente
    // Exclude CANCELADO: cancelled orders should not count toward return-rate calculation
    let ordenesQuery = supabaseAdmin
      .from("ordenes_servicio")
      .select("cliente_id")
      .eq("organization_id", organizationId!)
      .gte("fecha_ingreso", seisAtras.toISOString())
      .neq("estado", "CANCELADO")

    if (!filtro.verTodas && filtro.sucursalId) {
      ordenesQuery = ordenesQuery.eq("sucursal_id", filtro.sucursalId)
    }

    const { data: ordenes } = await ordenesQuery

    if (!ordenes || ordenes.length === 0) {
      return NextResponse.json({ tasaRetorno: 0, totalClientes: clientes.length, clientesRecurrentes: 0, topClientes: [] })
    }

    // Contar órdenes por cliente
    const conteo: Record<string, number> = {}
    for (const o of ordenes) {
      conteo[o.cliente_id] = (conteo[o.cliente_id] || 0) + 1
    }

    const clientesConOrdenes = Object.keys(conteo).length
    const clientesRecurrentes = Object.values(conteo).filter((c) => c > 1).length
    const tasaRetorno = clientesConOrdenes > 0
      ? Math.round((clientesRecurrentes / clientesConOrdenes) * 100)
      : 0

    // Top 10 clientes recurrentes
    const topClientes = Object.entries(conteo)
      .filter(([, count]) => count > 1)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([clienteId, ordenes]) => {
        const cliente = clientes.find((c) => c.id === clienteId)
        return {
          id: clienteId,
          nombre: cliente?.nombre || "Desconocido",
          telefono: cliente?.telefono || "",
          ordenes,
        }
      })

    return NextResponse.json({
      tasaRetorno,
      totalClientes: clientes.length,
      clientesConOrdenes,
      clientesRecurrentes,
      topClientes,
    })
  } catch (err) {
    console.error("Error en reporte tasa-retorno:", err)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
