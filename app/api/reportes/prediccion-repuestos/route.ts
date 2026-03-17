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

    // Obtener inventario actual
    const { data: inventario } = await supabaseAdmin
      .from("inventario")
      .select("id, nombre, codigo, stock, precio_compra")
      .eq("organization_id", organizationId!)

    if (!inventario || inventario.length === 0) {
      return NextResponse.json({ data: [] })
    }

    // Obtener uso de repuestos en los últimos 3 meses
    const tresAtras = new Date()
    tresAtras.setMonth(tresAtras.getMonth() - 3)

    const { data: usoRepuestos } = await supabaseAdmin
      .from("repuestos_orden")
      .select(`
        inventario_id,
        cantidad,
        ordenes_servicio!inner (
          organization_id,
          fecha_ingreso
        )
      `)
      .eq("ordenes_servicio.organization_id", organizationId!)
      .gte("ordenes_servicio.fecha_ingreso", tresAtras.toISOString())

    // Calcular uso mensual promedio por repuesto
    const usoPorRepuesto: Record<string, number> = {}
    if (usoRepuestos) {
      for (const r of usoRepuestos) {
        const id = r.inventario_id
        usoPorRepuesto[id] = (usoPorRepuesto[id] || 0) + r.cantidad
      }
    }

    const mesesAnalizados = 3
    const data = inventario.map((item) => {
      const usoTotal = usoPorRepuesto[item.id] || 0
      const usoMensual = usoTotal / mesesAnalizados
      const semanasHastaAgotamiento = usoMensual > 0
        ? Math.round((item.stock / (usoMensual / 4.33)) * 10) / 10
        : null

      let urgencia: "CRITICO" | "BAJO" | "NORMAL" | "SIN_USO"
      if (usoMensual === 0) urgencia = "SIN_USO"
      else if (semanasHastaAgotamiento !== null && semanasHastaAgotamiento <= 2) urgencia = "CRITICO"
      else if (semanasHastaAgotamiento !== null && semanasHastaAgotamiento <= 4) urgencia = "BAJO"
      else urgencia = "NORMAL"

      return {
        id: item.id,
        nombre: item.nombre,
        codigo: item.codigo,
        stockActual: item.stock,
        usoTotal,
        usoMensualPromedio: Math.round(usoMensual * 10) / 10,
        semanasHastaAgotamiento,
        urgencia,
        costoReposicion: Math.round(usoMensual * item.precio_compra),
      }
    })
      .filter((d) => d.usoTotal > 0 || d.stockActual > 0)
      .sort((a, b) => {
        const urgenciaOrder = { CRITICO: 0, BAJO: 1, NORMAL: 2, SIN_USO: 3 }
        return urgenciaOrder[a.urgencia] - urgenciaOrder[b.urgencia]
      })

    return NextResponse.json({ data })
  } catch (err) {
    console.error("Error en reporte prediccion-repuestos:", err)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
