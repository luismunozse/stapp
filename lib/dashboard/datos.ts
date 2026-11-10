import { supabaseAdmin } from "@/lib/supabase"
import { aplicarAlcanceOrdenes, type AlcanceOrdenes } from "@/lib/ordenes/alcance-lectura"

/**
 * Dashboard queries, uncached (the page wraps this in unstable_cache; the
 * `alcance` argument is part of that cache key). The order-derived numbers
 * (counts, estados, recent orders, invoices, collections, warranties) follow
 * the caller's order read scope; ventas and clientes stay org-wide.
 */
export async function consultarDatosDashboard(organizationId: string, alcance: AlcanceOrdenes) {
  // Order-derived queries follow the caller's order read scope. The scope is also
  // part of the cache key of the page's unstable_cache (it is an argument).
  // The builders are deliberately loosely typed: a select string held in a variable
  // cannot be parsed by the typed client, and the call sites cast what they read.
  const ordenesQ = (columnas: string, opciones?: { count: "exact"; head: boolean }): any =>
    aplicarAlcanceOrdenes(
      supabaseAdmin
        .from("ordenes_servicio")
        .select(columnas as any, opciones)
        .eq("organization_id", organizationId),
      alcance
    )
  const viaOrden = (query: any): any =>
    aplicarAlcanceOrdenes(query, alcance, { referencedTable: "ordenes_servicio" })
  // cobros_orden carries no branch of its own: it follows the branch of its order.
  const cobrosQ = (columnas: string): any =>
    alcance.tipo === "todas"
      ? supabaseAdmin.from("cobros_orden").select(columnas as any).eq("organization_id", organizationId)
      : viaOrden(
          supabaseAdmin
            .from("cobros_orden")
            .select(`${columnas}, ordenes_servicio!inner(id)` as any)
            .eq("organization_id", organizationId)
        )
  const hoy = new Date()
  const enSieteDias = new Date()
  enSieteDias.setDate(enSieteDias.getDate() + 7)
  const primerDiaMes = new Date(new Date().setDate(1))
  const hace7Dias = new Date()
  hace7Dias.setDate(hace7Dias.getDate() - 7)
  // Mes anterior (para comparativa)
  const primerDiaMesAnterior = new Date(primerDiaMes)
  primerDiaMesAnterior.setMonth(primerDiaMesAnterior.getMonth() - 1)
  const ultimoDiaMesAnterior = new Date(primerDiaMes.getTime() - 1)

  const [
    totalOrdenesResult,
    ordenesPendientesResult,
    totalClientesResult,
    itemsBajoStockResult,
    ingresosMensualesResult,
    garantiasPorVencerResult,
    ordenesPorEstadoResult,
    ingresosUltimos7DiasResult,
    ordenesRecientesResult,
    ventasHoyResult,
    facturasHoyResult,
    cobrosOrdenHoyResult,
    ventasMesResult,
    ventasUltimos7DiasResult,
    garantiasVentaPorVencerResult,
    ordenesPorTecnicoResult,
    ordenesPendienteCobroResult,
    ordenesFechaVencidaResult,
    cobrosOrdenMesResult,
    cobrosOrdenUltimos7DiasResult,
    // Mes anterior
    ordenesMesAnteriorResult,
    ingresosMesAnteriorResult,
    ventasMesAnteriorResult,
    cobrosMesAnteriorResult,
    clientesMesAnteriorResult,
  ] = await Promise.all([
    ordenesQ("id", { count: "exact", head: true }),
    ordenesQ("id", { count: "exact", head: true })
      .in("estado", ["RECIBIDO", "EN_DIAGNOSTICO", "PRESUPUESTADO", "APROBADO", "EN_REPARACION", "ESPERANDO_REPUESTO"]),
    supabaseAdmin
      .from("clientes")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId),
    supabaseAdmin
      .from("inventario")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .lt("stock", 5),
    viaOrden(supabaseAdmin.from("facturas").select("total, orden_id, ordenes_servicio!inner(organization_id)").eq("ordenes_servicio.organization_id", organizationId))
      .eq("estado_pago", "PAGADO")
      .gte("fecha", primerDiaMes.toISOString()),
    viaOrden(supabaseAdmin.from("garantias").select(`
        id, orden_id, fecha_vencimiento,
        ordenes_servicio!inner (
          id, numero_orden, organization_id,
          clientes (nombre)
        )
      `).eq("ordenes_servicio.organization_id", organizationId))
      .eq("estado", "ACTIVA")
      .gte("fecha_vencimiento", hoy.toISOString())
      .lte("fecha_vencimiento", enSieteDias.toISOString())
      .order("fecha_vencimiento", { ascending: true }),
    ordenesQ("estado"),
    viaOrden(supabaseAdmin.from("facturas").select("total, fecha, orden_id, ordenes_servicio!inner(organization_id)").eq("ordenes_servicio.organization_id", organizationId))
      .eq("estado_pago", "PAGADO")
      .gte("fecha", hace7Dias.toISOString())
      .order("fecha", { ascending: true }),
    ordenesQ(`
        id, numero_orden, codigo_orden, dispositivo, estado, fecha_ingreso,
        clientes (nombre)
      `)
      .order("fecha_ingreso", { ascending: false })
      .limit(5),
    // Ventas de hoy
    supabaseAdmin
      .from("ventas")
      .select("id, total")
      .eq("organization_id", organizationId)
      .eq("estado", "COMPLETADA")
      .gte("created_at", new Date(new Date().setHours(0, 0, 0, 0)).toISOString()),
    // Facturas pagadas hoy
    viaOrden(supabaseAdmin.from("facturas").select("total, orden_id, ordenes_servicio!inner(organization_id)").eq("ordenes_servicio.organization_id", organizationId))
      .eq("estado_pago", "PAGADO")
      .gte("fecha", new Date(new Date().setHours(0, 0, 0, 0)).toISOString()),
    // Cobros directos a órdenes de hoy
    cobrosQ("monto, orden_id")
      .neq("anulado", true)
      .gte("created_at", new Date(new Date().setHours(0, 0, 0, 0)).toISOString()),

    // Ventas del mes
    supabaseAdmin
      .from("ventas")
      .select("id, total")
      .eq("organization_id", organizationId)
      .eq("estado", "COMPLETADA")
      .gte("created_at", primerDiaMes.toISOString()),

    // Ventas últimos 7 días (para gráfica de ingresos)
    supabaseAdmin
      .from("ventas")
      .select("total, created_at")
      .eq("organization_id", organizationId)
      .eq("estado", "COMPLETADA")
      .gte("created_at", hace7Dias.toISOString())
      .order("created_at", { ascending: true }),

    // Garantías de venta por vencer (próximos 7 días)
    supabaseAdmin
      .from("garantias_venta")
      .select("id, numero_garantia, fecha_vencimiento, items_venta!inner(descripcion), ventas!inner(numero_venta, cliente_nombre, organization_id)")
      .eq("organization_id", organizationId)
      .eq("estado", "ACTIVA")
      .gte("fecha_vencimiento", hoy.toISOString())
      .lte("fecha_vencimiento", enSieteDias.toISOString())
      .order("fecha_vencimiento", { ascending: true }),

    ordenesQ(`
        tecnico_id, estado,
        users!ordenes_servicio_tecnico_id_fkey (nombre)
      `)
      .not("tecnico_id", "is", null)
      .in("estado", ["RECIBIDO", "EN_DIAGNOSTICO", "PRESUPUESTADO", "APROBADO", "EN_REPARACION", "ESPERANDO_REPUESTO", "REPARADO", "ENTREGADO", "ENTREGADO_SIN_REPARACION", "ENTREGADO_SIN_COBRO"]),
    // Órdenes con cobro pendiente (para antigüedad de deuda)
    ordenesQ(`
        id, numero_orden, codigo_orden, costo_final, total_cobrado, descuento_cobro,
        estado_cobro, fecha_ingreso, estado,
        clientes (nombre)
      `)
      .in("estado_cobro", ["PENDIENTE", "PARCIAL"])
      .in("estado", ["REPARADO", "ENTREGADO", "ENTREGADO_SIN_REPARACION"])
      .gt("costo_final", 0),
    // Órdenes con fecha prometida vencida
    ordenesQ(`
        id, numero_orden, codigo_orden, dispositivo, estado, fecha_prometida,
        clientes (nombre)
      `)
      .in("estado", ["RECIBIDO", "EN_DIAGNOSTICO", "PRESUPUESTADO", "APROBADO", "EN_REPARACION", "ESPERANDO_REPUESTO"])
      .lt("fecha_prometida", hoy.toISOString())
      .not("fecha_prometida", "is", null),
    // Cobros directos a órdenes (sin factura) del mes actual
    cobrosQ("monto, orden_id")
      .neq("anulado", true)
      .gte("created_at", primerDiaMes.toISOString()),
    // Cobros directos a órdenes últimos 7 días (para gráfica)
    cobrosQ("monto, orden_id, created_at")
      .neq("anulado", true)
      .gte("created_at", hace7Dias.toISOString())
      .order("created_at", { ascending: true }),
    // --- Datos del mes anterior (para comparativa) ---
    // Órdenes pendientes mes anterior
    ordenesQ("id", { count: "exact", head: true })
      .gte("fecha_ingreso", primerDiaMesAnterior.toISOString())
      .lte("fecha_ingreso", ultimoDiaMesAnterior.toISOString()),
    // Ingresos facturas mes anterior
    viaOrden(supabaseAdmin.from("facturas").select("total, orden_id, ordenes_servicio!inner(organization_id)").eq("ordenes_servicio.organization_id", organizationId))
      .eq("estado_pago", "PAGADO")
      .gte("fecha", primerDiaMesAnterior.toISOString())
      .lte("fecha", ultimoDiaMesAnterior.toISOString()),
    // Ventas mes anterior
    supabaseAdmin
      .from("ventas")
      .select("id, total")
      .eq("organization_id", organizationId)
      .eq("estado", "COMPLETADA")
      .gte("created_at", primerDiaMesAnterior.toISOString())
      .lte("created_at", ultimoDiaMesAnterior.toISOString()),
    // Cobros directos mes anterior
    cobrosQ("monto, orden_id")
      .neq("anulado", true)
      .gte("created_at", primerDiaMesAnterior.toISOString())
      .lte("created_at", ultimoDiaMesAnterior.toISOString()),
    // Clientes mes anterior
    supabaseAdmin
      .from("clientes")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .lte("created_at", ultimoDiaMesAnterior.toISOString()),
  ])

  return {
    totalOrdenesResult,
    ordenesPendientesResult,
    totalClientesResult,
    itemsBajoStockResult,
    ingresosMensualesResult,
    garantiasPorVencerResult,
    ordenesPorEstadoResult,
    ingresosUltimos7DiasResult,
    ordenesRecientesResult,
    ventasHoyResult,
    facturasHoyResult,
    cobrosOrdenHoyResult,
    ventasMesResult,
    ventasUltimos7DiasResult,
    garantiasVentaPorVencerResult,
    ordenesPorTecnicoResult,
    ordenesPendienteCobroResult,
    ordenesFechaVencidaResult,
    cobrosOrdenMesResult,
    cobrosOrdenUltimos7DiasResult,
    ordenesMesAnteriorResult,
    ingresosMesAnteriorResult,
    ventasMesAnteriorResult,
    cobrosMesAnteriorResult,
    clientesMesAnteriorResult,
    hace7Dias: hace7Dias.toISOString(),
  }
}

