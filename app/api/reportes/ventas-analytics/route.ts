import {
  requireIngresosAccess,
  hasInventarioAccess,
  resolveVendedoresHabilitados,
} from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { NextResponse } from "next/server"
import { sucursalParaLectura } from "@/lib/sucursal"
import { traerTodas } from "@/lib/supabase-paginar"
import {
  DEFAULT_TIMEZONE,
  dayRangeUtc,
  getZonedParts,
  monthRangeUtc,
  todayInTimeZone,
} from "@/lib/timezone"

/** Día calendario "YYYY-MM-DD" desplazado `dias` desde `fecha`. */
function sumarDias(fecha: string, dias: number): string {
  const [y, m, d] = fecha.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().split("T")[0]
}

/** Lo que quedó vendido de cada venta: total menos lo devuelto. */
function totalNeto(v: any): number {
  const devuelto = ((v.devoluciones_venta || []) as any[]).reduce(
    (s, d) => s + (Number(d.monto_devolucion) || 0),
    0
  )
  return Math.max((Number(v.total) || 0) - devuelto, 0)
}

/** Unidades de un item que no se devolvieron. */
function cantidadNeta(item: any): number {
  const devueltas = ((item.items_devolucion || []) as any[]).reduce((s, d) => s + (d.cantidad || 0), 0)
  return Math.max((item.cantidad || 0) - devueltas, 0)
}

export async function GET() {
  // Mismo permiso que el resto de los reportes de ingresos: un vendedor de una
  // org que apagó "vendedores ven ingresos" veía igual la facturación acá.
  const { error, organizationId, role, session } = await requireIngresosAccess()
  if (error) return error

  try {
    const filtro = await sucursalParaLectura({ role, userSucursalId: session!.user.sucursalId ?? null })
    const sucursalId = !filtro.verTodas && filtro.sucursalId ? filtro.sucursalId : null

    // Días de la organización, no de UTC: a las 22 h de Argentina ya era
    // "mañana" y las ventas de la noche caían en el día siguiente.
    const { data: org } = await supabaseAdmin
      .from("organizations")
      .select("zona_horaria")
      .eq("id", organizationId!)
      .single()
    const tz: string = org?.zona_horaria || DEFAULT_TIMEZONE
    const now = new Date()
    const hoy = todayInTimeZone(tz, now)
    const { year, month, weekday } = getZonedParts(now, tz)
    const hoyDesde = dayRangeUtc(hoy, tz).desde
    const inicioSemana = dayRangeUtc(sumarDias(hoy, -weekday), tz).desde
    const inicioMes = monthRangeUtc(year, month, tz).desde.toISOString()
    const hace30Dias = dayRangeUtc(sumarDias(hoy, -29), tz).desde
    const diaDe = (iso: string) => todayInTimeZone(tz, new Date(iso))

    const ventasMesQuery = () => {
      let q = supabaseAdmin
        .from("ventas")
        .select("id, total, descuento, tipo_descuento, porcentaje_descuento, estado, metodo_pago, vendedor_id, created_at, monto_abonado, estado_pago, devoluciones_venta(monto_devolucion)")
        .eq("organization_id", organizationId!)
        .gte("created_at", inicioMes)
        .order("id")
      if (sucursalId) q = q.eq("sucursal_id", sucursalId)
      return q
    }

    const ventasDiaQuery = () => {
      let q = supabaseAdmin
        .from("ventas")
        .select("id, total, estado, created_at, devoluciones_venta(monto_devolucion)")
        .eq("organization_id", organizationId!)
        .eq("estado", "COMPLETADA")
        .gte("created_at", hace30Dias)
        .order("id")
      if (sucursalId) q = q.eq("sucursal_id", sucursalId)
      return q
    }

    // Items from completed sales this month (for top products), branch-filtered via parent
    const itemsVentaMesQuery = () => {
      let q = supabaseAdmin
        .from("items_venta")
        .select("id, descripcion, cantidad, subtotal, inventario_id, precio_unitario, venta_id, items_devolucion(cantidad), ventas!inner(organization_id, estado, created_at, vendedor_id, sucursal_id)")
        .eq("ventas.organization_id", organizationId!)
        .eq("ventas.estado", "COMPLETADA")
        .gte("ventas.created_at", inicioMes)
        .order("id")
      if (sucursalId) q = q.eq("ventas.sucursal_id", sucursalId)
      return q
    }

    // Margin: items with inventory link for cost calculation, branch-filtered via parent
    // Select costo_unitario_snapshot (cost at sale time) and fallback to inventario.precio_compra
    const margenQuery = () => {
      let q = supabaseAdmin
        .from("items_venta")
        .select("id, cantidad, precio_unitario, subtotal, inventario_id, costo_unitario_snapshot, items_devolucion(cantidad), inventario!inner(precio_compra), ventas!inner(organization_id, estado, created_at, sucursal_id)")
        .eq("ventas.organization_id", organizationId!)
        .eq("ventas.estado", "COMPLETADA")
        .gte("ventas.created_at", inicioMes)
        .not("inventario_id", "is", null)
        .order("id")
      if (sucursalId) q = q.eq("ventas.sucursal_id", sucursalId)
      return q
    }

    const [
      ventasDelMesResult,
      itemsVentaMesResult,
      ventasPorDiaResult,
      margenResult,
    ] = await Promise.all([
      traerTodas(ventasMesQuery),
      traerTodas(itemsVentaMesQuery),
      traerTodas(ventasDiaQuery),
      traerTodas(margenQuery),
    ])

    // Fetch vendedor names
    const ventasMes = ventasDelMesResult.data as any[]
    const vendedorIds = [...new Set(ventasMes.filter(v => v.vendedor_id).map(v => v.vendedor_id))]
    const vendedoresMap: Record<string, string> = {}
    if (vendedorIds.length > 0) {
      const { data: vendedores } = await supabaseAdmin
        .from("users")
        .select("id, nombre")
        .in("id", vendedorIds)
      vendedores?.forEach(v => { vendedoresMap[v.id] = v.nombre })
    }

    // Montos netos de devoluciones en todos los indicadores
    const ventasMesCompletadas = ventasMes.filter(v => v.estado === "COMPLETADA")
    const resumen = (lista: any[]) => ({
      count: lista.length,
      total: lista.reduce((s, v) => s + totalNeto(v), 0),
    })

    // --- Ventas Hoy / Semana / Mes ---
    const ventasHoy = resumen(ventasMesCompletadas.filter(v => v.created_at >= hoyDesde))
    const ventasSemana = resumen(ventasMesCompletadas.filter(v => v.created_at >= inicioSemana))
    const ventasMesData = resumen(ventasMesCompletadas)

    // --- Ticket Promedio ---
    const ticketPromedio = ventasMesCompletadas.length > 0
      ? ventasMesData.total / ventasMesCompletadas.length
      : 0

    // --- Top Productos ---
    const productosMap: Record<string, { descripcion: string; cantidad: number; totalVentas: number }> = {}
    const itemsMes = itemsVentaMesResult.data as any[]
    itemsMes.forEach((item: any) => {
      const neta = cantidadNeta(item)
      if (neta <= 0) return
      const key = item.descripcion || "Sin descripción"
      if (!productosMap[key]) {
        productosMap[key] = { descripcion: key, cantidad: 0, totalVentas: 0 }
      }
      productosMap[key].cantidad += neta
      productosMap[key].totalVentas += (item.subtotal || 0) * (neta / (item.cantidad || 1))
    })
    const topProductos = Object.values(productosMap)
      .sort((a, b) => b.cantidad - a.cantidad)
      .slice(0, 5)

    // --- Top Vendedores ---
    const vendedoresStats: Record<string, { nombre: string; count: number; total: number }> = {}
    ventasMesCompletadas.forEach(v => {
      const vid = v.vendedor_id
      if (!vid) return
      if (!vendedoresStats[vid]) {
        vendedoresStats[vid] = { nombre: vendedoresMap[vid] || "Sin nombre", count: 0, total: 0 }
      }
      vendedoresStats[vid].count++
      vendedoresStats[vid].total += totalNeto(v)
    })
    const topVendedores = Object.values(vendedoresStats)
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)

    // --- Ventas por Método de Pago ---
    const metodosMap: Record<string, { metodo: string; count: number; total: number }> = {}
    ventasMesCompletadas.forEach(v => {
      const m = v.metodo_pago || "OTRO"
      if (!metodosMap[m]) metodosMap[m] = { metodo: m, count: 0, total: 0 }
      metodosMap[m].count++
      metodosMap[m].total += totalNeto(v)
    })
    const ventasPorMetodoPago = Object.values(metodosMap).sort((a, b) => b.total - a.total)

    // --- Ventas por Día (últimos 30 días de la organización) ---
    const diasMap: Record<string, { fecha: string; count: number; total: number }> = {}
    for (let i = 29; i >= 0; i--) {
      const key = sumarDias(hoy, -i)
      diasMap[key] = { fecha: key, count: 0, total: 0 }
    }
    ;(ventasPorDiaResult.data as any[]).forEach((v: any) => {
      const key = v.created_at ? diaDe(v.created_at) : null
      if (key && diasMap[key]) {
        diasMap[key].count++
        diasMap[key].total += totalNeto(v)
      }
    })
    const ventasPorDia = Object.values(diasMap)

    // --- Margen Bruto (sobre lo que quedó vendido) ---
    const margenItems = margenResult.data as any[]
    let totalVentas = 0
    let totalCosto = 0
    margenItems.forEach((item: any) => {
      const neta = cantidadNeta(item)
      if (neta <= 0) return
      totalVentas += (item.subtotal || 0) * (neta / (item.cantidad || 1))
      // Prefer costo_unitario_snapshot (cost captured at sale time) over live precio_compra
      const costoUnitario =
        item.costo_unitario_snapshot != null
          ? item.costo_unitario_snapshot
          : (item.inventario as any)?.precio_compra || 0
      totalCosto += neta * costoUnitario
    })
    // Mismo gate y misma regla que /api/reportes/analisis-inventario: quien no
    // puede ver el costo de compra por item no recibe NINGUNA cifra derivada
    // de precio_compra, a ningún nivel de agregación.
    //
    // totalCosto tiene la misma forma que resumen.valorCompra, que esta rama
    // ya gateó por este motivo: costo_unitario_snapshot es el precio_compra
    // congelado al momento de la venta, y cuando falta se lee
    // inventario.precio_compra en vivo. Con un único item vendido en el mes
    // —o un único SKU en la organización— totalCosto sobre la cantidad ES el
    // costo unitario exacto.
    //
    // margen es totalVentas - totalCosto y totalVentas viaja acá al lado, así
    // que nullear solo totalCosto lo dejaría recuperable por resta; porcentaje
    // es ese margen sobre totalVentas. Los tres caen juntos.
    //
    // totalVentas es facturación, no costo: su tier no cambió y sigue visible.
    const vendedoresHabilitados = role === "VENDEDOR"
      ? await resolveVendedoresHabilitados(organizationId!)
      : false
    const canViewCost = hasInventarioAccess(role, vendedoresHabilitados)

    const margenBruto = {
      totalVentas,
      totalCosto: canViewCost ? totalCosto : null,
      margen: canViewCost ? totalVentas - totalCosto : null,
      porcentaje: canViewCost
        ? (totalVentas > 0 ? ((totalVentas - totalCosto) / totalVentas) * 100 : 0)
        : null,
    }

    // --- Descuentos Otorgados ---
    const ventasConDescuento = ventasMesCompletadas.filter(v => (v.descuento || 0) > 0)
    const totalDescuentos = ventasMesCompletadas.reduce((s, v) => s + (v.descuento || 0), 0)
    // BUG-8 fix: promedioDescuento is the average discount AMOUNT per sale
    // (totalDescuentos / ventasCount), not "discounts as % of total revenue".
    // The old formula (totalDescuentos / ventasMesData.total) * 100 was a revenue-ratio,
    // not a per-sale average, which contradicts the "promedio" label.
    const descuentosOtorgados = {
      totalDescuentos,
      cantidadConDescuento: ventasConDescuento.length,
      promedioDescuento: ventasMesCompletadas.length > 0
        ? totalDescuentos / ventasMesCompletadas.length
        : 0,
    }

    // --- Tasa de Anulación ---
    const anuladas = ventasMes.filter(v => v.estado === "ANULADA").length
    const tasaAnulacion = {
      total: ventasMes.length,
      anuladas,
      porcentaje: ventasMes.length > 0 ? (anuladas / ventasMes.length) * 100 : 0,
    }

    return NextResponse.json({
      ventasHoy,
      ventasSemana,
      ventasMes: ventasMesData,
      ticketPromedio,
      topProductos,
      topVendedores,
      ventasPorMetodoPago,
      ventasPorDia,
      margenBruto,
      descuentosOtorgados,
      tasaAnulacion,
    })
  } catch (err) {
    console.error("Error en ventas-analytics:", err)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
