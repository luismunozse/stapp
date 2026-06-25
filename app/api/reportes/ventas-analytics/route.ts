import { requireAdminOrVendedor } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { NextResponse } from "next/server"
import { sucursalParaLectura } from "@/lib/sucursal"

export async function GET() {
  const { error, organizationId, role, session } = await requireAdminOrVendedor()
  if (error) return error

  const now = new Date()
  const hoy = now.toISOString().split("T")[0]
  const inicioSemana = new Date(now)
  inicioSemana.setDate(now.getDate() - now.getDay())
  const inicioMes = new Date(now.getFullYear(), now.getMonth(), 1)
  const hace30Dias = new Date(now)
  hace30Dias.setDate(now.getDate() - 30)

  try {
    const filtro = await sucursalParaLectura({ role, userSucursalId: session!.user.sucursalId ?? null })

    // Base ventas query for this month, with optional branch filter
    let ventasMesBaseQuery = supabaseAdmin
      .from("ventas")
      .select("id, total, descuento, tipo_descuento, porcentaje_descuento, estado, metodo_pago, vendedor_id, created_at, monto_abonado, estado_pago")
      .eq("organization_id", organizationId!)
      .gte("created_at", inicioMes.toISOString())

    if (!filtro.verTodas && filtro.sucursalId) {
      ventasMesBaseQuery = ventasMesBaseQuery.eq("sucursal_id", filtro.sucursalId)
    }

    let ventasDiaBaseQuery = supabaseAdmin
      .from("ventas")
      .select("total, estado, created_at")
      .eq("organization_id", organizationId!)
      .eq("estado", "COMPLETADA")
      .gte("created_at", hace30Dias.toISOString())

    if (!filtro.verTodas && filtro.sucursalId) {
      ventasDiaBaseQuery = ventasDiaBaseQuery.eq("sucursal_id", filtro.sucursalId)
    }

    // Items from completed sales this month (for top products), branch-filtered via parent
    let itemsVentaMesQuery = supabaseAdmin
      .from("items_venta")
      .select("descripcion, cantidad, subtotal, inventario_id, precio_unitario, venta_id, ventas!inner(organization_id, estado, created_at, vendedor_id, sucursal_id)")
      .eq("ventas.organization_id", organizationId!)
      .eq("ventas.estado", "COMPLETADA")
      .gte("ventas.created_at", inicioMes.toISOString())

    if (!filtro.verTodas && filtro.sucursalId) {
      itemsVentaMesQuery = itemsVentaMesQuery.eq("ventas.sucursal_id", filtro.sucursalId)
    }

    // Margin: items with inventory link for cost calculation, branch-filtered via parent
    // Select costo_unitario_snapshot (cost at sale time) and fallback to inventario.precio_compra
    let margenQuery = supabaseAdmin
      .from("items_venta")
      .select("cantidad, precio_unitario, subtotal, inventario_id, costo_unitario_snapshot, inventario!inner(precio_compra), ventas!inner(organization_id, estado, created_at, sucursal_id)")
      .eq("ventas.organization_id", organizationId!)
      .eq("ventas.estado", "COMPLETADA")
      .gte("ventas.created_at", inicioMes.toISOString())
      .not("inventario_id", "is", null)

    if (!filtro.verTodas && filtro.sucursalId) {
      margenQuery = margenQuery.eq("ventas.sucursal_id", filtro.sucursalId)
    }

    const [
      ventasDelMesResult,
      itemsVentaMesResult,
      ventasPorDiaResult,
      margenResult,
    ] = await Promise.all([
      ventasMesBaseQuery,
      itemsVentaMesQuery,
      ventasDiaBaseQuery,
      margenQuery,
    ])

    // Fetch vendedor names
    const ventasMes = ventasDelMesResult.data || []
    const vendedorIds = [...new Set(ventasMes.filter(v => v.vendedor_id).map(v => v.vendedor_id))]
    let vendedoresMap: Record<string, string> = {}
    if (vendedorIds.length > 0) {
      const { data: vendedores } = await supabaseAdmin
        .from("users")
        .select("id, nombre")
        .in("id", vendedorIds)
      vendedores?.forEach(v => { vendedoresMap[v.id] = v.nombre })
    }

    // --- Ventas Hoy ---
    const ventasHoyList = ventasMes.filter(v => v.estado === "COMPLETADA" && v.created_at?.startsWith(hoy))
    const ventasHoy = {
      count: ventasHoyList.length,
      total: ventasHoyList.reduce((s, v) => s + (v.total || 0), 0),
    }

    // --- Ventas Semana ---
    const inicioSemanaStr = inicioSemana.toISOString()
    const ventasSemanaList = ventasMes.filter(v => v.estado === "COMPLETADA" && v.created_at >= inicioSemanaStr)
    const ventasSemana = {
      count: ventasSemanaList.length,
      total: ventasSemanaList.reduce((s, v) => s + (v.total || 0), 0),
    }

    // --- Ventas Mes ---
    const ventasMesCompletadas = ventasMes.filter(v => v.estado === "COMPLETADA")
    const ventasMesData = {
      count: ventasMesCompletadas.length,
      total: ventasMesCompletadas.reduce((s, v) => s + (v.total || 0), 0),
    }

    // --- Ticket Promedio ---
    const ticketPromedio = ventasMesCompletadas.length > 0
      ? ventasMesData.total / ventasMesCompletadas.length
      : 0

    // --- Top Productos ---
    const productosMap: Record<string, { descripcion: string; cantidad: number; totalVentas: number }> = {}
    const itemsMes = itemsVentaMesResult.data || []
    itemsMes.forEach((item: any) => {
      const key = item.descripcion || "Sin descripción"
      if (!productosMap[key]) {
        productosMap[key] = { descripcion: key, cantidad: 0, totalVentas: 0 }
      }
      productosMap[key].cantidad += item.cantidad || 0
      productosMap[key].totalVentas += item.subtotal || 0
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
      vendedoresStats[vid].total += v.total || 0
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
      metodosMap[m].total += v.total || 0
    })
    const ventasPorMetodoPago = Object.values(metodosMap).sort((a, b) => b.total - a.total)

    // --- Ventas por Día (últimos 30 días) ---
    const diasMap: Record<string, { fecha: string; count: number; total: number }> = {}
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(now.getDate() - i)
      const key = d.toISOString().split("T")[0]
      diasMap[key] = { fecha: key, count: 0, total: 0 }
    }
    const ventasDia = ventasPorDiaResult.data || []
    ventasDia.forEach((v: any) => {
      const key = v.created_at?.split("T")[0]
      if (key && diasMap[key]) {
        diasMap[key].count++
        diasMap[key].total += v.total || 0
      }
    })
    const ventasPorDia = Object.values(diasMap)

    // --- Margen Bruto ---
    const margenItems = margenResult.data || []
    let totalVentas = 0
    let totalCosto = 0
    margenItems.forEach((item: any) => {
      totalVentas += item.subtotal || 0
      // Prefer costo_unitario_snapshot (cost captured at sale time) over live precio_compra
      const costoUnitario =
        item.costo_unitario_snapshot != null
          ? item.costo_unitario_snapshot
          : (item.inventario as any)?.precio_compra || 0
      totalCosto += (item.cantidad || 0) * costoUnitario
    })
    const margenBruto = {
      totalVentas,
      totalCosto,
      margen: totalVentas - totalCosto,
      porcentaje: totalVentas > 0 ? ((totalVentas - totalCosto) / totalVentas) * 100 : 0,
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
