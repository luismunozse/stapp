import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

/**
 * Estado de Resultados (P&L) — devengado
 *
 * Estructura:
 *   Ingresos
 *     - Ventas (productos)
 *     - Servicios (órdenes reparadas/entregadas)
 *     - Otros ingresos (movimientos manuales tipo INGRESO)
 *   - Costos
 *     - Costo de productos vendidos (items_venta.costo_unitario_snapshot)
 *     - Costo de repuestos en servicios
 *   = Ganancia bruta
 *   - Gastos operativos (movimientos_caja EGRESO con afecta_rentabilidad = true)
 *   = Ganancia neta
 *
 * Notas:
 *   - Las ventas previas a la migración 090 quedan con costo_unitario_snapshot NULL.
 *     Se cuentan como "costo desconocido" y se reportan aparte para que el usuario
 *     sepa que hay un margen de incertidumbre en el dato histórico.
 *   - "Retiro de socio" y similar (afecta_rentabilidad = false) se excluyen de gastos.
 */
export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const desdeParam = searchParams.get("desde")
    const hastaParam = searchParams.get("hasta")

    // Default: mes actual
    const now = new Date()
    const fechaDesde = desdeParam
      ? new Date(desdeParam + "T00:00:00")
      : new Date(now.getFullYear(), now.getMonth(), 1)
    const fechaHasta = hastaParam
      ? new Date(hastaParam + "T23:59:59")
      : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)

    const desdeISO = fechaDesde.toISOString()
    const hastaISO = fechaHasta.toISOString()

    // ========================================
    // 1. VENTAS (productos) en el período
    // ========================================
    const { data: ventas } = await supabaseAdmin
      .from("ventas")
      .select(`
        id, total, created_at, estado,
        items_venta (cantidad, precio_unitario, costo_unitario_snapshot)
      `)
      .eq("organization_id", organizationId!)
      .neq("estado", "ANULADA")
      .gte("created_at", desdeISO)
      .lte("created_at", hastaISO)

    let ingresosVentas = 0
    let costoProductos = 0
    let itemsConCostoConocido = 0
    let itemsSinCostoConocido = 0

    for (const v of ventas || []) {
      ingresosVentas += parseFloat(v.total || "0")
      const items = (v.items_venta || []) as any[]
      for (const it of items) {
        const cantidad = it.cantidad || 0
        if (it.costo_unitario_snapshot != null) {
          costoProductos += cantidad * parseFloat(it.costo_unitario_snapshot)
          itemsConCostoConocido++
        } else {
          itemsSinCostoConocido++
        }
      }
    }

    // ========================================
    // 2. SERVICIOS (órdenes) en el período
    // ========================================
    const { data: ordenes } = await supabaseAdmin
      .from("ordenes_servicio")
      .select(`
        id, costo_final, created_at, estado,
        repuestos_orden (cantidad, precio_unitario)
      `)
      .eq("organization_id", organizationId!)
      .in("estado", ["REPARADO", "ENTREGADO"])
      .not("costo_final", "is", null)
      .gt("costo_final", 0)
      .gte("created_at", desdeISO)
      .lte("created_at", hastaISO)

    let ingresosServicios = 0
    let costoRepuestos = 0
    for (const o of ordenes || []) {
      ingresosServicios += parseFloat(o.costo_final || "0")
      const reps = (o.repuestos_orden || []) as any[]
      for (const r of reps) {
        costoRepuestos += (r.cantidad || 0) * parseFloat(r.precio_unitario || "0")
      }
    }

    // ========================================
    // 3. OTROS INGRESOS (movimientos manuales tipo INGRESO)
    // ========================================
    const { data: movIngresos } = await supabaseAdmin
      .from("movimientos_caja")
      .select("monto, afecta_rentabilidad")
      .eq("organization_id", organizationId!)
      .eq("tipo", "INGRESO")
      .gte("fecha", desdeISO)
      .lte("fecha", hastaISO)

    let otrosIngresos = 0
    for (const m of movIngresos || []) {
      if (m.afecta_rentabilidad !== false) {
        otrosIngresos += parseFloat(m.monto || "0")
      }
    }

    // ========================================
    // 4. GASTOS (movimientos manuales tipo EGRESO con afecta_rentabilidad = true)
    // ========================================
    const { data: movEgresos } = await supabaseAdmin
      .from("movimientos_caja")
      .select(`
        monto, afecta_rentabilidad, categoria_gasto_id,
        categorias_gasto (id, nombre, tipo, color)
      `)
      .eq("organization_id", organizationId!)
      .eq("tipo", "EGRESO")
      .gte("fecha", desdeISO)
      .lte("fecha", hastaISO)

    let gastosFijos = 0
    let gastosVariables = 0
    let gastosSinCategorizar = 0
    let gastosNoComputables = 0 // afecta_rentabilidad = false (retiros, etc)
    const porCategoria: Record<
      string,
      { id: string; nombre: string; tipo: string; color: string | null; monto: number }
    > = {}

    for (const m of movEgresos || []) {
      const monto = parseFloat(m.monto || "0")
      if (m.afecta_rentabilidad === false) {
        gastosNoComputables += monto
        continue
      }
      const cat = (m.categorias_gasto as any) || null
      if (!cat) {
        gastosSinCategorizar += monto
        continue
      }
      if (cat.tipo === "FIJO") gastosFijos += monto
      else gastosVariables += monto

      if (!porCategoria[cat.id]) {
        porCategoria[cat.id] = {
          id: cat.id,
          nombre: cat.nombre,
          tipo: cat.tipo,
          color: cat.color,
          monto: 0,
        }
      }
      porCategoria[cat.id].monto += monto
    }

    if (gastosSinCategorizar > 0) {
      porCategoria["_sin_categorizar"] = {
        id: "_sin_categorizar",
        nombre: "Sin categorizar",
        tipo: "VARIABLE",
        color: "#94a3b8",
        monto: gastosSinCategorizar,
      }
      gastosVariables += gastosSinCategorizar
    }

    // ========================================
    // Cálculos finales
    // ========================================
    const totalIngresos = ingresosVentas + ingresosServicios + otrosIngresos
    const totalCostos = costoProductos + costoRepuestos
    const gananciaBruta = totalIngresos - totalCostos
    const totalGastos = gastosFijos + gastosVariables
    const gananciaNeta = gananciaBruta - totalGastos

    const margenBruto = totalIngresos > 0 ? (gananciaBruta / totalIngresos) * 100 : 0
    const margenNeto = totalIngresos > 0 ? (gananciaNeta / totalIngresos) * 100 : 0

    return NextResponse.json({
      periodo: {
        desde: fechaDesde.toISOString(),
        hasta: fechaHasta.toISOString(),
      },
      ingresos: {
        ventas: round(ingresosVentas),
        servicios: round(ingresosServicios),
        otros: round(otrosIngresos),
        total: round(totalIngresos),
      },
      costos: {
        productos: round(costoProductos),
        repuestos: round(costoRepuestos),
        total: round(totalCostos),
      },
      gananciaBruta: round(gananciaBruta),
      margenBruto: round(margenBruto, 1),
      gastos: {
        fijos: round(gastosFijos),
        variables: round(gastosVariables),
        total: round(totalGastos),
        porCategoria: Object.values(porCategoria)
          .map((c) => ({
            ...c,
            monto: round(c.monto),
            porcentaje: totalGastos > 0 ? round((c.monto / totalGastos) * 100, 1) : 0,
          }))
          .sort((a, b) => b.monto - a.monto),
      },
      gananciaNeta: round(gananciaNeta),
      margenNeto: round(margenNeto, 1),
      // Datos auxiliares
      meta: {
        ventasCount: ventas?.length || 0,
        ordenesCount: ordenes?.length || 0,
        itemsConCostoConocido,
        itemsSinCostoConocido,
        gastosNoComputables: round(gastosNoComputables),
      },
    })
  } catch (err) {
    console.error("Error en estado-resultados:", err)
    return NextResponse.json(
      { error: "Error al calcular estado de resultados" },
      { status: 500 }
    )
  }
}

function round(n: number, decimals = 2): number {
  const f = Math.pow(10, decimals)
  return Math.round(n * f) / f
}
