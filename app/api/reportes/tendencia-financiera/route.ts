import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

/**
 * Tendencia financiera mensual — últimos N meses.
 *
 * Por cada mes devuelve:
 *   - ingresos: ventas + servicios + otros ingresos manuales
 *   - costos: COGS (items_venta.costo_unitario_snapshot) + repuestos en órdenes
 *   - gastos: gastos operativos (movimientos_caja EGRESO con afecta_rentabilidad=true)
 *   - gananciaBruta: ingresos - costos
 *   - gananciaNeta: gananciaBruta - gastos
 *
 * Se alinea con el cálculo del estado-resultados para que los números coincidan.
 */
export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const meses = Math.max(1, Math.min(24, parseInt(searchParams.get("meses") || "6")))

    const now = new Date()
    const fechaDesde = new Date(now.getFullYear(), now.getMonth() - meses + 1, 1)
    const fechaHasta = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)

    const desdeISO = fechaDesde.toISOString()
    const hastaISO = fechaHasta.toISOString()

    // Inicializar todos los meses en cero
    type Bucket = {
      mes: string
      mesCompleto: string
      ingresos: number
      ingresosVentas: number
      ingresosServicios: number
      ingresosOtros: number
      costos: number
      costoProductos: number
      costoRepuestos: number
      gastos: number
      costosFinancieros: number
      gananciaBruta: number
      gananciaNeta: number
    }

    const buckets: Record<string, Bucket> = {}
    for (let i = 0; i < meses; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - meses + 1 + i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
      buckets[key] = {
        mes: d.toLocaleDateString("es-AR", { month: "short" }),
        mesCompleto: d.toLocaleDateString("es-AR", { month: "long", year: "numeric" }),
        ingresos: 0,
        ingresosVentas: 0,
        ingresosServicios: 0,
        ingresosOtros: 0,
        costos: 0,
        costoProductos: 0,
        costoRepuestos: 0,
        gastos: 0,
        costosFinancieros: 0,
        gananciaBruta: 0,
        gananciaNeta: 0,
      }
    }

    const keyFor = (iso: string) => {
      const d = new Date(iso)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    }

    // 1. Ventas (ingresos por ventas + costo de mercadería)
    const { data: ventas } = await supabaseAdmin
      .from("ventas")
      .select(`
        id, total, created_at, estado,
        items_venta (cantidad, costo_unitario_snapshot)
      `)
      .eq("organization_id", organizationId!)
      .neq("estado", "ANULADA")
      .gte("created_at", desdeISO)
      .lte("created_at", hastaISO)

    for (const v of ventas || []) {
      const key = keyFor(v.created_at)
      const bucket = buckets[key]
      if (!bucket) continue
      bucket.ingresosVentas += parseFloat(v.total || "0")
      const items = (v.items_venta || []) as any[]
      for (const it of items) {
        const cantidad = it.cantidad || 0
        if (it.costo_unitario_snapshot != null) {
          bucket.costoProductos += cantidad * parseFloat(it.costo_unitario_snapshot)
        }
      }
    }

    // 2. Servicios/órdenes (ingresos por reparación + costo de repuestos)
    const { data: ordenes } = await supabaseAdmin
      .from("ordenes_servicio")
      .select(`
        id, costo_final, created_at, estado,
        repuestos_orden (cantidad, precio_unitario)
      `)
      .eq("organization_id", organizationId!)
      .in("estado", ["REPARADO", "ENTREGADO", "ENTREGADO_SIN_REPARACION"])
      .not("costo_final", "is", null)
      .gt("costo_final", 0)
      .gte("created_at", desdeISO)
      .lte("created_at", hastaISO)

    for (const o of ordenes || []) {
      const key = keyFor(o.created_at)
      const bucket = buckets[key]
      if (!bucket) continue
      bucket.ingresosServicios += parseFloat(o.costo_final || "0")
      const reps = (o.repuestos_orden || []) as any[]
      for (const r of reps) {
        bucket.costoRepuestos += (r.cantidad || 0) * parseFloat(r.precio_unitario || "0")
      }
    }

    // 3. Movimientos manuales de caja (otros ingresos + gastos operativos)
    const { data: movimientos } = await supabaseAdmin
      .from("movimientos_caja")
      .select("tipo, monto, fecha, afecta_rentabilidad")
      .eq("organization_id", organizationId!)
      .gte("fecha", desdeISO)
      .lte("fecha", hastaISO)

    for (const m of movimientos || []) {
      if (m.afecta_rentabilidad === false) continue
      const key = keyFor(m.fecha)
      const bucket = buckets[key]
      if (!bucket) continue
      const monto = parseFloat(m.monto || "0")
      if (m.tipo === "INGRESO") {
        bucket.ingresosOtros += monto
      } else if (m.tipo === "EGRESO") {
        bucket.gastos += monto
      }
    }

    // 4. Costos financieros (comisiones de terminales)
    const { data: pagosVentaCF } = await supabaseAdmin
      .from("pagos_venta")
      .select("costo_financiero_monto, fecha, ventas!inner(organization_id)")
      .eq("ventas.organization_id", organizationId!)
      .not("costo_financiero_monto", "is", null)
      .gt("costo_financiero_monto", 0)
      .gte("fecha", desdeISO)
      .lte("fecha", hastaISO)

    for (const p of pagosVentaCF || []) {
      const key = keyFor(p.fecha)
      const bucket = buckets[key]
      if (!bucket) continue
      bucket.costosFinancieros += parseFloat(p.costo_financiero_monto || "0")
    }

    const { data: pagosParcialCF } = await supabaseAdmin
      .from("pagos_parciales")
      .select("costo_financiero_monto, fecha, facturas!inner(ordenes_servicio!inner(organization_id))")
      .eq("facturas.ordenes_servicio.organization_id", organizationId!)
      .not("costo_financiero_monto", "is", null)
      .gt("costo_financiero_monto", 0)
      .gte("fecha", desdeISO)
      .lte("fecha", hastaISO)

    for (const p of pagosParcialCF || []) {
      const key = keyFor(p.fecha)
      const bucket = buckets[key]
      if (!bucket) continue
      bucket.costosFinancieros += parseFloat(p.costo_financiero_monto || "0")
    }

    // Calcular totales derivados por mes
    const porMes = Object.entries(buckets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, b]) => {
        b.ingresos = b.ingresosVentas + b.ingresosServicios + b.ingresosOtros
        b.costos = b.costoProductos + b.costoRepuestos
        b.gananciaBruta = b.ingresos - b.costos
        b.gananciaNeta = b.gananciaBruta - b.gastos - b.costosFinancieros
        return {
          mes: b.mes,
          mesCompleto: b.mesCompleto,
          ingresos: round(b.ingresos),
          ingresosVentas: round(b.ingresosVentas),
          ingresosServicios: round(b.ingresosServicios),
          ingresosOtros: round(b.ingresosOtros),
          costos: round(b.costos),
          costoProductos: round(b.costoProductos),
          costoRepuestos: round(b.costoRepuestos),
          gastos: round(b.gastos),
          gananciaBruta: round(b.gananciaBruta),
          gananciaNeta: round(b.gananciaNeta),
        }
      })

    // Totales acumulados del período
    const totales = porMes.reduce(
      (acc, m) => ({
        ingresos: acc.ingresos + m.ingresos,
        costos: acc.costos + m.costos,
        gastos: acc.gastos + m.gastos,
        gananciaBruta: acc.gananciaBruta + m.gananciaBruta,
        gananciaNeta: acc.gananciaNeta + m.gananciaNeta,
      }),
      { ingresos: 0, costos: 0, gastos: 0, gananciaBruta: 0, gananciaNeta: 0 }
    )

    return NextResponse.json({
      periodo: {
        desde: fechaDesde.toISOString(),
        hasta: fechaHasta.toISOString(),
        meses,
      },
      porMes,
      totales: {
        ingresos: round(totales.ingresos),
        costos: round(totales.costos),
        gastos: round(totales.gastos),
        gananciaBruta: round(totales.gananciaBruta),
        gananciaNeta: round(totales.gananciaNeta),
      },
    })
  } catch (err) {
    console.error("Error en tendencia-financiera:", err)
    return NextResponse.json(
      { error: "Error al calcular tendencia financiera" },
      { status: 500 }
    )
  }
}

function round(n: number, decimals = 2): number {
  const f = Math.pow(10, decimals)
  return Math.round(n * f) / f
}
