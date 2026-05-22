import { NextResponse } from "next/server"
import { requireAdminOrVendedor } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { hasPlanFeature } from "@/lib/subscriptions"

export async function GET() {
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

    // Obtener órdenes completadas con costo final y repuestos
    const { data: ordenes } = await supabaseAdmin
      .from("ordenes_servicio")
      .select(`
        id, tipo_dispositivo, costo_final,
        porcentaje_comision, tecnico_id,
        repuestos_orden (cantidad, precio_unitario),
        cotizaciones (
          estado, deleted_at,
          items_cotizacion (cantidad, inventario:inventario_id(precio_compra))
        )
      `)
      .eq("organization_id", organizationId!)
      .not("costo_final", "is", null)
      .in("estado", ["REPARADO", "ENTREGADO", "ENTREGADO_SIN_REPARACION"])

    if (!ordenes || ordenes.length === 0) {
      return NextResponse.json({ data: [], margenPromedio: 0 })
    }

    // Calcular rentabilidad por tipo de dispositivo
    // Costos incluyen: repuestos consumidos + cotizaciones aceptadas (inv) + comisión técnico.
    const porTipo: Record<string, { ingresos: number; costos: number; count: number }> = {}

    for (const orden of ordenes as any[]) {
      const tipo = orden.tipo_dispositivo || "OTRO"
      const ingreso = parseFloat(orden.costo_final || "0")

      let costoRepuestos = 0
      for (const r of (orden.repuestos_orden || [])) {
        costoRepuestos += (r.cantidad || 0) * parseFloat(r.precio_unitario || "0")
      }
      for (const c of (orden.cotizaciones || [])) {
        if (c.deleted_at || c.estado !== "ACEPTADA") continue
        for (const it of (c.items_cotizacion || [])) {
          if (!it.inventario) continue
          costoRepuestos += (it.cantidad || 0) * parseFloat(it.inventario.precio_compra || "0")
        }
      }

      let comision = 0
      if (orden.tecnico_id && ingreso > 0) {
        const pct = parseFloat(orden.porcentaje_comision || "0")
        if (pct > 0) {
          const ganancia = Math.max(0, ingreso - costoRepuestos)
          comision = (ganancia * pct) / 100
        }
      }

      if (!porTipo[tipo]) {
        porTipo[tipo] = { ingresos: 0, costos: 0, count: 0 }
      }
      porTipo[tipo].ingresos += ingreso
      porTipo[tipo].costos += costoRepuestos + comision
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
