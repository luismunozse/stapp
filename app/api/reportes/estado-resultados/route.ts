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
        porcentaje_comision, vendedor_id,
        items_venta (cantidad, precio_unitario, costo_unitario_snapshot)
      `)
      .eq("organization_id", organizationId!)
      .eq("estado", "COMPLETADA")
      .gte("created_at", desdeISO)
      .lte("created_at", hastaISO)

    let ingresosVentas = 0
    let costoProductos = 0
    let comisionVendedores = 0
    let itemsConCostoConocido = 0
    let itemsSinCostoConocido = 0

    for (const v of ventas || []) {
      const total = parseFloat(v.total || "0")
      ingresosVentas += total
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

      // Comisión vendedor devengada: total * pct / 100
      if (v.vendedor_id) {
        const pct = parseFloat(v.porcentaje_comision || "0")
        if (pct > 0) {
          comisionVendedores += (total * pct) / 100
        }
      }
    }

    // ========================================
    // 2. SERVICIOS (órdenes) — modelo HÍBRIDO devengado + cobros adelantados
    // ========================================
    // (A) Órdenes terminales en período: ingreso = costo_final - cobros_previos_al_periodo
    //     (resta lo ya contado como adelanto en períodos anteriores).
    // (B) Cobros en período de órdenes NO terminales en período: ingreso adelanto.
    // Evita doble counting cross-período.
    const { data: ordenes } = await supabaseAdmin
      .from("ordenes_servicio")
      .select(`
        id, costo_final, fecha_completado, estado,
        porcentaje_comision, tecnico_id,
        repuestos_orden (cantidad, precio_unitario),
        cotizaciones (
          estado, deleted_at,
          items_cotizacion (cantidad, costo_unitario, inventario:inventario_id(precio_compra))
        )
      `)
      .eq("organization_id", organizationId!)
      .in("estado", ["REPARADO", "ENTREGADO", "ENTREGADO_SIN_REPARACION", "ENTREGADO_SIN_COBRO"])
      .not("fecha_completado", "is", null)
      .gte("fecha_completado", desdeISO)
      .lte("fecha_completado", hastaISO)

    // Cobros previos al inicio del período para órdenes terminales en período
    const terminalIds = (ordenes || []).map((o: any) => o.id)
    const cobrosPreviosByOrden = new Map<string, number>()
    if (terminalIds.length > 0) {
      const { data: cobrosPrev } = await supabaseAdmin
        .from("cobros_orden")
        .select("orden_id, monto")
        .in("orden_id", terminalIds)
        .neq("anulado", true)
        .lt("created_at", desdeISO)
      for (const c of (cobrosPrev || []) as any[]) {
        cobrosPreviosByOrden.set(c.orden_id, (cobrosPreviosByOrden.get(c.orden_id) || 0) + Number(c.monto))
      }
    }

    let ingresosServicios = 0
    let ingresosAdelantos = 0
    let costoRepuestos = 0
    let comisionTecnicos = 0

    for (const o of (ordenes || []) as any[]) {
      const cobrosPrev = cobrosPreviosByOrden.get(o.id) || 0
      const costoFinal = parseFloat(o.costo_final || "0")
      const ingreso = o.estado === "ENTREGADO_SIN_COBRO" ? 0 : Math.max(0, costoFinal - cobrosPrev)
      ingresosServicios += ingreso

      let costoRepO = 0
      for (const r of (o.repuestos_orden || [])) {
        costoRepO += (r.cantidad || 0) * parseFloat(r.precio_unitario || "0")
      }
      for (const c of (o.cotizaciones || [])) {
        if (c.deleted_at || c.estado !== "ACEPTADA") continue
        for (const it of (c.items_cotizacion || [])) {
          // Preferir snapshot (costo_unitario). Fallback: inventario.precio_compra actual.
          const costo = it.costo_unitario != null
            ? parseFloat(it.costo_unitario)
            : (it.inventario ? parseFloat(it.inventario.precio_compra || "0") : 0)
          if (costo <= 0) continue
          costoRepO += (it.cantidad || 0) * costo
        }
      }
      costoRepuestos += costoRepO

      // Comisión técnico sobre ganancia devengada (costo_final completo, no neto).
      // El % es contractual y se devenga con el trabajo, no con el cobro.
      if (o.tecnico_id && costoFinal > 0 && o.estado !== "ENTREGADO_SIN_COBRO") {
        const pct = parseFloat(o.porcentaje_comision || "0")
        if (pct > 0) {
          const ganancia = Math.max(0, costoFinal - costoRepO)
          comisionTecnicos += (ganancia * pct) / 100
        }
      }
    }

    // (B) Cobros adelantados: cobros en período de órdenes NO completadas y NO canceladas.
    //     Excluye:
    //       - Terminales del período actual (ya en (A))
    //       - Terminales con fecha_completado <= hasta (ya devengaron full costo_final en su mes)
    //       - CANCELADO / SIN_REPARACION (nunca devengarán)
    const terminalIdsSet = new Set(terminalIds)
    const { data: cobrosPeriodo } = await supabaseAdmin
      .from("cobros_orden")
      .select("orden_id, monto, ordenes_servicio!inner(estado, fecha_completado, organization_id)")
      .eq("ordenes_servicio.organization_id", organizationId!)
      .neq("anulado", true)
      .gte("created_at", desdeISO)
      .lte("created_at", hastaISO)

    const ESTADOS_NUNCA_DEVENGAN = new Set(["CANCELADO", "SIN_REPARACION"])
    const ESTADOS_TERMINALES_DEV = new Set(["REPARADO", "ENTREGADO", "ENTREGADO_SIN_REPARACION", "ENTREGADO_SIN_COBRO"])

    for (const c of (cobrosPeriodo || []) as any[]) {
      if (terminalIdsSet.has(c.orden_id)) continue // ya contado en (A) del período actual
      const os = c.ordenes_servicio
      if (!os) continue
      if (ESTADOS_NUNCA_DEVENGAN.has(os.estado)) continue // nunca devengará
      // Órdenes ya terminales con devengado en período anterior:
      if (ESTADOS_TERMINALES_DEV.has(os.estado) && os.fecha_completado && os.fecha_completado <= hastaISO) {
        continue
      }
      ingresosAdelantos += parseFloat(c.monto || "0")
    }

    ingresosServicios += ingresosAdelantos

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
    // 4. COSTOS FINANCIEROS (comisiones de terminales de pago)
    // ========================================
    // Pagos de ventas con costo financiero
    const { data: pagosVentaCF } = await supabaseAdmin
      .from("pagos_venta")
      .select("costo_financiero_monto, venta_id")
      .not("costo_financiero_monto", "is", null)
      .gt("costo_financiero_monto", 0)

    // Filtrar por ventas COMPLETADAS de esta org y período (alineado con sec 1)
    let costosFinancierosVentas = 0
    if (pagosVentaCF && pagosVentaCF.length > 0) {
      const ventaIds = [...new Set(pagosVentaCF.map(p => p.venta_id))]
      const { data: ventasValidas } = await supabaseAdmin
        .from("ventas")
        .select("id")
        .eq("organization_id", organizationId!)
        .eq("estado", "COMPLETADA")
        .gte("created_at", desdeISO)
        .lte("created_at", hastaISO)
        .in("id", ventaIds)

      const ventaIdsValidos = new Set((ventasValidas || []).map(v => v.id))
      for (const p of pagosVentaCF) {
        if (ventaIdsValidos.has(p.venta_id)) {
          costosFinancierosVentas += parseFloat(p.costo_financiero_monto || "0")
        }
      }
    }

    // Pagos de facturas (servicios) con costo financiero — alineado por fecha_completado de la orden
    const { data: pagosParcialCF } = await supabaseAdmin
      .from("pagos_parciales")
      .select("costo_financiero_monto, factura_id")
      .not("costo_financiero_monto", "is", null)
      .gt("costo_financiero_monto", 0)

    let costosFinancierosServicios = 0
    if (pagosParcialCF && pagosParcialCF.length > 0) {
      const facturaIds = [...new Set(pagosParcialCF.map(p => p.factura_id))]
      const { data: facturasValidas } = await supabaseAdmin
        .from("facturas")
        .select("id, ordenes_servicio!inner(organization_id, fecha_completado, estado)")
        .in("id", facturaIds)

      const facturaIdsValidos = new Set(
        (facturasValidas || [])
          .filter(f => {
            const os = (f.ordenes_servicio as any)
            if (!os || os.organization_id !== organizationId) return false
            if (!os.fecha_completado) return false
            const fc = new Date(os.fecha_completado).toISOString()
            return fc >= desdeISO && fc <= hastaISO
          })
          .map(f => f.id)
      )
      for (const p of pagosParcialCF) {
        if (facturaIdsValidos.has(p.factura_id)) {
          costosFinancierosServicios += parseFloat(p.costo_financiero_monto || "0")
        }
      }
    }

    // CF de cobros directos a orden (sin factura) en período
    const { data: cobrosCF } = await supabaseAdmin
      .from("cobros_orden")
      .select("costo_financiero_monto, created_at")
      .eq("organization_id", organizationId!)
      .neq("anulado", true)
      .not("costo_financiero_monto", "is", null)
      .gt("costo_financiero_monto", 0)
      .gte("created_at", desdeISO)
      .lte("created_at", hastaISO)

    let costosFinancierosCobrosOrden = 0
    for (const c of (cobrosCF || []) as any[]) {
      costosFinancierosCobrosOrden += parseFloat(c.costo_financiero_monto || "0")
    }

    const totalCostosFinancieros = costosFinancierosVentas + costosFinancierosServicios + costosFinancierosCobrosOrden

    // ========================================
    // 4.4 NOTAS DE CRÉDITO en período → restan ingresos
    // ========================================
    const { data: notasCredito } = await supabaseAdmin
      .from("notas_credito")
      .select("monto, venta_id, orden_id")
      .eq("organization_id", organizationId!)
      .eq("anulada", false)
      .gte("fecha", desdeISO)
      .lte("fecha", hastaISO)

    let ncVentas = 0
    let ncServicios = 0
    for (const n of (notasCredito || []) as any[]) {
      const monto = parseFloat(n.monto || "0")
      if (n.venta_id) ncVentas += monto
      else if (n.orden_id) ncServicios += monto
    }
    const totalNotasCredito = ncVentas + ncServicios

    // ========================================
    // 4.5 MERMAS / AJUSTES DE INVENTARIO (SALIDA con afecta_rentabilidad=true)
    // ========================================
    const { data: ajustes } = await supabaseAdmin
      .from("ajustes_inventario")
      .select("tipo, cantidad, costo_unitario_snapshot, afecta_rentabilidad")
      .eq("organization_id", organizationId!)
      .eq("direccion", "SALIDA")
      .gte("fecha", desdeISO)
      .lte("fecha", hastaISO)

    let costoMerma = 0
    const mermaPorTipo: Record<string, number> = {}
    for (const a of (ajustes || []) as any[]) {
      if (a.afecta_rentabilidad === false) continue
      const monto = (a.cantidad || 0) * parseFloat(a.costo_unitario_snapshot || "0")
      costoMerma += monto
      mermaPorTipo[a.tipo] = (mermaPorTipo[a.tipo] || 0) + monto
    }

    // ========================================
    // 5. GASTOS (movimientos manuales tipo EGRESO con afecta_rentabilidad = true)
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
    const ingresosVentasNeto = Math.max(0, ingresosVentas - ncVentas)
    const ingresosServiciosNeto = Math.max(0, ingresosServicios - ncServicios)
    const totalIngresos = ingresosVentasNeto + ingresosServiciosNeto + otrosIngresos
    const totalCostos = costoProductos + costoRepuestos + costoMerma
    const gananciaBruta = totalIngresos - totalCostos
    const totalComisiones = comisionTecnicos + comisionVendedores
    const totalGastos = gastosFijos + gastosVariables
    const gananciaNeta = gananciaBruta - totalGastos - totalCostosFinancieros - totalComisiones

    const margenBruto = totalIngresos > 0 ? (gananciaBruta / totalIngresos) * 100 : 0
    const margenNeto = totalIngresos > 0 ? (gananciaNeta / totalIngresos) * 100 : 0

    return NextResponse.json({
      periodo: {
        desde: fechaDesde.toISOString(),
        hasta: fechaHasta.toISOString(),
      },
      ingresos: {
        ventas: round(ingresosVentasNeto),
        ventasBruto: round(ingresosVentas),
        servicios: round(ingresosServiciosNeto),
        serviciosBruto: round(ingresosServicios),
        serviciosAdelantos: round(ingresosAdelantos),
        otros: round(otrosIngresos),
        total: round(totalIngresos),
      },
      notasCredito: {
        ventas: round(ncVentas),
        servicios: round(ncServicios),
        total: round(totalNotasCredito),
      },
      costos: {
        productos: round(costoProductos),
        repuestos: round(costoRepuestos),
        merma: round(costoMerma),
        mermaPorTipo: Object.fromEntries(
          Object.entries(mermaPorTipo).map(([k, v]) => [k, round(v)])
        ),
        total: round(totalCostos),
      },
      gananciaBruta: round(gananciaBruta),
      margenBruto: round(margenBruto, 1),
      costosFinancieros: {
        ventas: round(costosFinancierosVentas),
        servicios: round(costosFinancierosServicios),
        cobrosOrden: round(costosFinancierosCobrosOrden),
        total: round(totalCostosFinancieros),
      },
      comisiones: {
        tecnicos: round(comisionTecnicos),
        vendedores: round(comisionVendedores),
        total: round(totalComisiones),
      },
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
