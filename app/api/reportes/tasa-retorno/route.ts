import { NextResponse } from "next/server"
import { requireAdminOrVendedor } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { isPremium } from "@/lib/subscriptions"

export async function GET() {
  try {
    const { error, organizationId } = await requireAdminOrVendedor()
    if (error) return error

    const premium = await isPremium(organizationId!)
    if (!premium) {
      return NextResponse.json({ error: "Requiere plan Premium", code: "PREMIUM_REQUIRED" }, { status: 403 })
    }

    const seisAtras = new Date()
    seisAtras.setMonth(seisAtras.getMonth() - 6)

    // Obtener clientes con cantidad de órdenes
    const { data: clientes } = await supabaseAdmin
      .from("clientes")
      .select("id, nombre, telefono")
      .eq("organization_id", organizationId!)

    if (!clientes || clientes.length === 0) {
      return NextResponse.json({ tasaRetorno: 0, totalClientes: 0, clientesRecurrentes: 0, topClientes: [] })
    }

    // Obtener órdenes de los últimos 6 meses agrupadas por cliente
    const { data: ordenes } = await supabaseAdmin
      .from("ordenes_servicio")
      .select("cliente_id")
      .eq("organization_id", organizationId!)
      .gte("fecha_ingreso", seisAtras.toISOString())

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
