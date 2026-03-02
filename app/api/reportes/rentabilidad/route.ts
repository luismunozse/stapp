import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { isPremium } from "@/lib/subscriptions"

export async function GET() {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const premium = await isPremium(organizationId!)
    if (!premium) {
      return NextResponse.json({ error: "Requiere plan Premium", code: "PREMIUM_REQUIRED" }, { status: 403 })
    }

    // Obtener órdenes completadas con costo final y repuestos
    const { data: ordenes } = await supabaseAdmin
      .from("ordenes_servicio")
      .select(`
        id, tipo_dispositivo, costo_final,
        repuestos_orden (cantidad, precio_unitario)
      `)
      .eq("organization_id", organizationId!)
      .not("costo_final", "is", null)
      .in("estado", ["REPARADO", "ENTREGADO"])

    if (!ordenes || ordenes.length === 0) {
      return NextResponse.json({ data: [], margenPromedio: 0 })
    }

    // Calcular rentabilidad por tipo de dispositivo
    const porTipo: Record<string, { ingresos: number; costos: number; count: number }> = {}

    for (const orden of ordenes) {
      const tipo = orden.tipo_dispositivo || "OTRO"
      const ingreso = orden.costo_final || 0

      // Sumar costo de repuestos
      const repuestos = orden.repuestos_orden as Array<{ cantidad: number; precio_unitario: number }> || []
      const costoRepuestos = repuestos.reduce(
        (acc, r) => acc + (r.cantidad * r.precio_unitario), 0
      )

      if (!porTipo[tipo]) {
        porTipo[tipo] = { ingresos: 0, costos: 0, count: 0 }
      }
      porTipo[tipo].ingresos += ingreso
      porTipo[tipo].costos += costoRepuestos
      porTipo[tipo].count++
    }

    const data = Object.entries(porTipo).map(([tipo, stats]) => {
      const ganancia = stats.ingresos - stats.costos
      const margen = stats.ingresos > 0 ? Math.round((ganancia / stats.ingresos) * 100) : 0

      return {
        tipoDispositivo: tipo,
        ingresos: Math.round(stats.ingresos),
        costos: Math.round(stats.costos),
        ganancia: Math.round(ganancia),
        margen,
        cantidad: stats.count,
      }
    }).sort((a, b) => b.ganancia - a.ganancia)

    const totalIngresos = data.reduce((acc, d) => acc + d.ingresos, 0)
    const totalCostos = data.reduce((acc, d) => acc + d.costos, 0)
    const margenPromedio = totalIngresos > 0
      ? Math.round(((totalIngresos - totalCostos) / totalIngresos) * 100)
      : 0

    return NextResponse.json({ data, margenPromedio })
  } catch (err) {
    console.error("Error en reporte rentabilidad:", err)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
