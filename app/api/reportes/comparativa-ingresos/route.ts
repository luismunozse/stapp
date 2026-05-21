import { NextResponse } from "next/server"
import { requireAdminOrVendedor } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

/**
 * GET /api/reportes/comparativa-ingresos
 * Compara ingresos del mes actual vs mes anterior (cash basis).
 * Suma: ventas COMPLETADA + facturas PAGADO + cobros_orden no anulados.
 * Dedupe: si la orden tiene cobros directos en el período, no se cuenta su factura.
 */
export async function GET() {
  try {
    const { error, organizationId } = await requireAdminOrVendedor()
    if (error) return error

    const now = new Date()
    const inicioActual = new Date(now.getFullYear(), now.getMonth(), 1)
    const inicioAnterior = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const finAnterior = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59)

    const sumarPeriodo = async (desde: Date, hasta?: Date) => {
      const desdeISO = desde.toISOString()
      const hastaISO = hasta?.toISOString()

      const ventasQuery = supabaseAdmin
        .from("ventas")
        .select("id, total")
        .eq("organization_id", organizationId!)
        .eq("estado", "COMPLETADA")
        .gte("created_at", desdeISO)
      if (hastaISO) ventasQuery.lte("created_at", hastaISO)

      const facturasQuery = supabaseAdmin
        .from("facturas")
        .select("id, total, orden_id, ordenes_servicio!inner(organization_id)")
        .eq("ordenes_servicio.organization_id", organizationId!)
        .eq("estado_pago", "PAGADO")
        .gte("fecha", desdeISO)
      if (hastaISO) facturasQuery.lte("fecha", hastaISO)

      const cobrosQuery = supabaseAdmin
        .from("cobros_orden")
        .select("id, monto, orden_id")
        .eq("organization_id", organizationId!)
        .neq("anulado", true)
        .gte("created_at", desdeISO)
      if (hastaISO) cobrosQuery.lte("created_at", hastaISO)

      const [ventasR, facturasR, cobrosR] = await Promise.all([ventasQuery, facturasQuery, cobrosQuery])

      const ventas = (ventasR.data || []) as { id: string; total: number }[]
      const facturas = (facturasR.data || []) as { id: string; total: number; orden_id: string }[]
      const cobros = (cobrosR.data || []) as { id: string; monto: number; orden_id: string }[]

      const ordenesConCobro = new Set(cobros.map((c) => c.orden_id))
      const totalVentas = ventas.reduce((s, v) => s + Number(v.total || 0), 0)
      const totalFacturas = facturas
        .filter((f) => !ordenesConCobro.has(f.orden_id))
        .reduce((s, f) => s + Number(f.total || 0), 0)
      const totalCobros = cobros.reduce((s, c) => s + Number(c.monto || 0), 0)

      const total = totalVentas + totalFacturas + totalCobros
      const cantidad = ventas.length + facturas.length + cobros.length

      return { total, cantidad }
    }

    const [actual, anterior] = await Promise.all([
      sumarPeriodo(inicioActual),
      sumarPeriodo(inicioAnterior, finAnterior),
    ])

    const promedioActual = actual.cantidad > 0 ? actual.total / actual.cantidad : 0
    const promedioAnterior = anterior.cantidad > 0 ? anterior.total / anterior.cantidad : 0

    let porcentajeCambio = 0
    let direccion: "up" | "down" | "neutral" = "neutral"
    if (anterior.total > 0) {
      porcentajeCambio = ((actual.total - anterior.total) / anterior.total) * 100
      direccion = porcentajeCambio > 0 ? "up" : porcentajeCambio < 0 ? "down" : "neutral"
    } else if (actual.total > 0) {
      porcentajeCambio = 100
      direccion = "up"
    }

    return NextResponse.json({
      mesActual: {
        nombre: obtenerNombreMes(now),
        total: actual.total,
        cantidad: actual.cantidad,
        promedio: promedioActual,
      },
      mesAnterior: {
        nombre: obtenerNombreMes(new Date(now.getFullYear(), now.getMonth() - 1)),
        total: anterior.total,
        cantidad: anterior.cantidad,
        promedio: promedioAnterior,
      },
      cambio: {
        porcentaje: Math.round(porcentajeCambio * 10) / 10,
        direccion,
        diferencia: actual.total - anterior.total,
      },
    })
  } catch (error) {
    console.error("Error en comparativa de ingresos:", error)
    return NextResponse.json(
      { error: "Error al obtener comparativa de ingresos" },
      { status: 500 }
    )
  }
}

function obtenerNombreMes(fecha: Date): string {
  return fecha.toLocaleDateString("es-AR", { month: "long", year: "numeric" })
}
