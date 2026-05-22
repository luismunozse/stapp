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
      comisiones: number
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
        comisiones: 0,
        gananciaBruta: 0,
        gananciaNeta: 0,
      }
    }

    const keyFor = (iso: string) => {
      const d = new Date(iso)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    }

    // 1. Ventas (ingresos por ventas + costo de mercadería + comisión vendedor)
    const { data: ventas } = await supabaseAdmin
      .from("ventas")
      .select(`
        id, total, created_at, estado,
        porcentaje_comision, vendedor_id,
        items_venta (cantidad, costo_unitario_snapshot)
      `)
      .eq("organization_id", organizationId!)
      .eq("estado", "COMPLETADA")
      .gte("created_at", desdeISO)
      .lte("created_at", hastaISO)

    for (const v of ventas || []) {
      const key = keyFor(v.created_at)
      const bucket = buckets[key]
      if (!bucket) continue
      const total = parseFloat(v.total || "0")
      bucket.ingresosVentas += total
      const items = (v.items_venta || []) as any[]
      for (const it of items) {
        const cantidad = it.cantidad || 0
        if (it.costo_unitario_snapshot != null) {
          bucket.costoProductos += cantidad * parseFloat(it.costo_unitario_snapshot)
        }
      }
      if (v.vendedor_id) {
        const pct = parseFloat(v.porcentaje_comision || "0")
        if (pct > 0) bucket.comisiones += (total * pct) / 100
      }
    }

    // 2. Servicios/órdenes — devengado por fecha_completado
    //    Incluye estados terminales con ingreso o costo de repuestos.
    const { data: ordenes } = await supabaseAdmin
      .from("ordenes_servicio")
      .select(`
        id, costo_final, fecha_completado, estado,
        porcentaje_comision, tecnico_id,
        repuestos_orden (cantidad, precio_unitario),
        cotizaciones (
          estado, deleted_at,
          items_cotizacion (cantidad, inventario:inventario_id(precio_compra))
        )
      `)
      .eq("organization_id", organizationId!)
      .in("estado", ["REPARADO", "ENTREGADO", "ENTREGADO_SIN_REPARACION", "ENTREGADO_SIN_COBRO"])
      .not("fecha_completado", "is", null)
      .gte("fecha_completado", desdeISO)
      .lte("fecha_completado", hastaISO)

    for (const o of (ordenes || []) as any[]) {
      const key = keyFor(o.fecha_completado)
      const bucket = buckets[key]
      if (!bucket) continue
      const ingreso = o.estado === "ENTREGADO_SIN_COBRO" ? 0 : parseFloat(o.costo_final || "0")
      bucket.ingresosServicios += ingreso

      let costoRepO = 0
      for (const r of (o.repuestos_orden || [])) {
        costoRepO += (r.cantidad || 0) * parseFloat(r.precio_unitario || "0")
      }
      for (const c of (o.cotizaciones || [])) {
        if (c.deleted_at || c.estado !== "ACEPTADA") continue
        for (const it of (c.items_cotizacion || [])) {
          if (!it.inventario) continue
          costoRepO += (it.cantidad || 0) * parseFloat(it.inventario.precio_compra || "0")
        }
      }
      bucket.costoRepuestos += costoRepO

      if (o.tecnico_id && ingreso > 0) {
        const pct = parseFloat(o.porcentaje_comision || "0")
        if (pct > 0) {
          const ganancia = Math.max(0, ingreso - costoRepO)
          bucket.comisiones += (ganancia * pct) / 100
        }
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
    //    Bucketing por fecha de devengado del parent (created_at venta / fecha_completado orden)
    //    para alinear con ingresos.
    const { data: pagosVentaCF } = await supabaseAdmin
      .from("pagos_venta")
      .select("costo_financiero_monto, ventas!inner(organization_id, estado, created_at)")
      .eq("ventas.organization_id", organizationId!)
      .eq("ventas.estado", "COMPLETADA")
      .not("costo_financiero_monto", "is", null)
      .gt("costo_financiero_monto", 0)
      .gte("ventas.created_at", desdeISO)
      .lte("ventas.created_at", hastaISO)

    for (const p of (pagosVentaCF || []) as any[]) {
      const ventaCreated = p.ventas?.created_at
      if (!ventaCreated) continue
      const key = keyFor(ventaCreated)
      const bucket = buckets[key]
      if (!bucket) continue
      bucket.costosFinancieros += parseFloat(p.costo_financiero_monto || "0")
    }

    const { data: pagosParcialCF } = await supabaseAdmin
      .from("pagos_parciales")
      .select("costo_financiero_monto, facturas!inner(ordenes_servicio!inner(organization_id, fecha_completado))")
      .eq("facturas.ordenes_servicio.organization_id", organizationId!)
      .not("costo_financiero_monto", "is", null)
      .gt("costo_financiero_monto", 0)
      .not("facturas.ordenes_servicio.fecha_completado", "is", null)
      .gte("facturas.ordenes_servicio.fecha_completado", desdeISO)
      .lte("facturas.ordenes_servicio.fecha_completado", hastaISO)

    for (const p of (pagosParcialCF || []) as any[]) {
      const fc = p.facturas?.ordenes_servicio?.fecha_completado
      if (!fc) continue
      const key = keyFor(fc)
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
        b.gananciaNeta = b.gananciaBruta - b.gastos - b.costosFinancieros - b.comisiones
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
          comisiones: round(b.comisiones),
          costosFinancieros: round(b.costosFinancieros),
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
        comisiones: acc.comisiones + m.comisiones,
        costosFinancieros: acc.costosFinancieros + m.costosFinancieros,
        gananciaBruta: acc.gananciaBruta + m.gananciaBruta,
        gananciaNeta: acc.gananciaNeta + m.gananciaNeta,
      }),
      { ingresos: 0, costos: 0, gastos: 0, comisiones: 0, costosFinancieros: 0, gananciaBruta: 0, gananciaNeta: 0 }
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
        comisiones: round(totales.comisiones),
        costosFinancieros: round(totales.costosFinancieros),
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
