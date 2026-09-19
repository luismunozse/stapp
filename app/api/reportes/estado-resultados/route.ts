import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { sucursalParaLectura } from "@/lib/sucursal"
import { resolverPeriodo } from "@/lib/reportes-periodo"
import { traerTodo, traerTodoPorLotes } from "@/lib/supabase-paginado"

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
 *   - Costos financieros, comisiones, faltantes de caja
 *   = Ganancia neta
 *
 * Notas:
 *   - Las ventas previas a la migración 090 quedan con costo_unitario_snapshot NULL.
 *     Se cuentan como "costo desconocido" y se reportan aparte para que el usuario
 *     sepa que hay un margen de incertidumbre en el dato histórico.
 *   - "Retiro de socio" y similar (afecta_rentabilidad = false) se excluyen de gastos.
 *
 * PERÍODO (auditoría contable, punto 1.2)
 *   El rango se resuelve en la zona horaria de la ORG, no en la del proceso.
 *   `new Date(desde + "T00:00:00")` lo resolvía el server (UTC en Vercel), así
 *   que para un taller en UTC-3 el mes arrancaba y terminaba a las 21:00 del
 *   día anterior. Ver lib/reportes-periodo.ts.
 *
 * COMPLETITUD (auditoría contable, punto 1.1)
 *   Todas las fuentes se leen paginadas. Antes cada consulta se comía el corte
 *   de 1000 filas de PostgREST sin avisar y el P&L de un taller con volumen
 *   salía corto. Si alguna fuente llega al tope duro, `meta.incompleto` vuelve
 *   en true y la pantalla lo avisa en vez de mostrar un número falso.
 */
export async function GET(request: Request) {
  try {
    const { error, organizationId, role, session } = await requireAdmin()
    if (error) return error

    // Resolve branch filter — applied to every P&L sub-source
    const filtro = await sucursalParaLectura({ role, userSucursalId: session!.user.sucursalId ?? null })
    const sid = !filtro.verTodas && filtro.sucursalId ? filtro.sucursalId : null

    const { searchParams } = new URL(request.url)
    const { tz, desdeISO, hastaISO } = await resolverPeriodo(
      organizationId!,
      searchParams.get("desde"),
      searchParams.get("hasta")
    )

    // Fuentes que llegaron al tope de filas. Si queda alguna, el total es un
    // piso, no el número real, y hay que decirlo.
    const fuentesIncompletas: string[] = []
    const marcar = (nombre: string, truncado: boolean) => {
      if (truncado) fuentesIncompletas.push(nombre)
    }

    // ========================================
    // 1. VENTAS (productos) en el período
    // ========================================
    // `.order("id")` no es cosmético: sin un orden estable, paginar con
    // range() puede repetir o saltear filas entre páginas.
    const { filas: ventas, truncado: ventasTrunc } = await traerTodo<any>((desde, hasta) => {
      let q = supabaseAdmin
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
      if (sid) q = q.eq("sucursal_id", sid)
      return q.order("id", { ascending: true }).range(desde, hasta)
    })
    marcar("ventas", ventasTrunc)

    let ingresosVentas = 0
    let costoProductos = 0
    let comisionVendedores = 0
    let itemsConCostoConocido = 0
    let itemsSinCostoConocido = 0

    for (const v of ventas) {
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

    // Fetch org flag for ENTREGADO_SIN_REPARACION commission behavior
    const { data: orgFlagData } = await supabaseAdmin
      .from("organizations")
      .select("comision_aplica_sin_reparacion")
      .eq("id", organizationId!)
      .single()
    const comisionAplicaSinReparacion = orgFlagData?.comision_aplica_sin_reparacion ?? false

    // ========================================
    // 2. SERVICIOS (órdenes) — modelo HÍBRIDO devengado + cobros adelantados
    // ========================================
    // (A) Órdenes terminales en período: ingreso = costo_final - cobros_previos_al_periodo
    //     (resta lo ya contado como adelanto en períodos anteriores).
    // (B) Cobros en período de órdenes NO terminales en período: ingreso adelanto.
    // Evita doble counting cross-período.
    const { filas: ordenes, truncado: ordenesTrunc } = await traerTodo<any>((desde, hasta) => {
      let q = supabaseAdmin
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
      if (sid) q = q.eq("sucursal_id", sid)
      return q.order("id", { ascending: true }).range(desde, hasta)
    })
    marcar("ordenes", ordenesTrunc)

    // Cobros previos al inicio del período para órdenes terminales en período.
    // Por lotes: la lista de ids ya no está acotada a 1000 y `.in()` viaja en
    // la URL.
    const terminalIds = ordenes.map((o: any) => o.id)
    const cobrosPreviosByOrden = new Map<string, number>()
    if (terminalIds.length > 0) {
      const { filas: cobrosPrev, truncado } = await traerTodoPorLotes<any>(
        terminalIds,
        (lote, desde, hasta) =>
          supabaseAdmin
            .from("cobros_orden")
            .select("id, orden_id, monto")
            .in("orden_id", lote)
            .neq("anulado", true)
            .lt("created_at", desdeISO)
            .order("id", { ascending: true })
            .range(desde, hasta)
      )
      marcar("cobros previos", truncado)
      for (const c of cobrosPrev) {
        cobrosPreviosByOrden.set(c.orden_id, (cobrosPreviosByOrden.get(c.orden_id) || 0) + Number(c.monto))
      }
    }

    let ingresosServicios = 0
    let ingresosAdelantos = 0
    let costoRepuestos = 0
    let comisionTecnicos = 0

    for (const o of ordenes as any[]) {
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
      // ENTREGADO_SIN_REPARACION only generates commission when the org flag is enabled.
      if (o.tecnico_id && costoFinal > 0 && o.estado !== "ENTREGADO_SIN_COBRO" && (o.estado !== "ENTREGADO_SIN_REPARACION" || comisionAplicaSinReparacion)) {
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
    const { filas: cobrosPeriodo, truncado: cobrosPeriodoTrunc } = await traerTodo<any>((desde, hasta) => {
      let q = supabaseAdmin
        .from("cobros_orden")
        .select("id, orden_id, monto, ordenes_servicio!inner(estado, fecha_completado, organization_id, sucursal_id)")
        .eq("ordenes_servicio.organization_id", organizationId!)
        .neq("anulado", true)
        .gte("created_at", desdeISO)
        .lte("created_at", hastaISO)
      if (sid) q = q.eq("ordenes_servicio.sucursal_id", sid)
      return q.order("id", { ascending: true }).range(desde, hasta)
    })
    marcar("cobros del período", cobrosPeriodoTrunc)

    const ESTADOS_NUNCA_DEVENGAN = new Set(["CANCELADO", "SIN_REPARACION", "SIN_FALLA_DETECTADA"])
    const ESTADOS_TERMINALES_DEV = new Set(["REPARADO", "ENTREGADO", "ENTREGADO_SIN_REPARACION", "ENTREGADO_SIN_COBRO"])

    for (const c of cobrosPeriodo as any[]) {
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
    // `anulado = false` (mig 327): un movimiento anulado sigue en la tabla para
    // dejar rastro de quién lo dio de baja, pero no es plata.
    const { filas: movIngresos, truncado: movIngresosTrunc } = await traerTodo<any>((desde, hasta) => {
      let q = supabaseAdmin
        .from("movimientos_caja")
        .select("id, monto, afecta_rentabilidad")
        .eq("organization_id", organizationId!)
        .eq("tipo", "INGRESO")
        .eq("anulado", false)
        .gte("fecha", desdeISO)
        .lte("fecha", hastaISO)
      if (sid) q = q.eq("sucursal_id", sid)
      return q.order("id", { ascending: true }).range(desde, hasta)
    })
    marcar("ingresos manuales", movIngresosTrunc)

    let otrosIngresos = 0
    for (const m of movIngresos) {
      if (m.afecta_rentabilidad !== false) {
        otrosIngresos += parseFloat(m.monto || "0")
      }
    }

    // ========================================
    // 4. COSTOS FINANCIEROS (comisiones de terminales de pago)
    // ========================================
    // Pagos de ventas con costo financiero — scopeado por org + período EN LA
    // PROPIA query (vía ventas!inner). El fetch sin scoping traía filas de todas
    // las orgs y PostgREST lo truncaba a 1000, subestimando el costo financiero
    // de esta org (y sobreestimando la ganancia neta). Espeja tendencia-financiera.
    const { filas: pagosVentaCF, truncado: pagosVentaCFTrunc } = await traerTodo<any>((desde, hasta) => {
      let q = supabaseAdmin
        .from("pagos_venta")
        .select("id, costo_financiero_monto, ventas!inner(organization_id, estado, created_at, sucursal_id)")
        .eq("ventas.organization_id", organizationId!)
        .eq("ventas.estado", "COMPLETADA")
        .not("costo_financiero_monto", "is", null)
        .gt("costo_financiero_monto", 0)
        .gte("ventas.created_at", desdeISO)
        .lte("ventas.created_at", hastaISO)
      if (sid) q = q.eq("ventas.sucursal_id", sid)
      return q.order("id", { ascending: true }).range(desde, hasta)
    })
    marcar("costos financieros de ventas", pagosVentaCFTrunc)

    let costosFinancierosVentas = 0
    for (const p of pagosVentaCF as any[]) {
      costosFinancierosVentas += parseFloat(p.costo_financiero_monto || "0")
    }

    // Pagos de facturas (servicios) con costo financiero — scopeado por org +
    // período en la query vía facturas!inner→ordenes_servicio!inner (alineado por
    // fecha_completado). Mismo bug/fix que pagos_venta arriba.
    const { filas: pagosParcialCF, truncado: pagosParcialCFTrunc } = await traerTodo<any>((desde, hasta) => {
      let q = supabaseAdmin
        .from("pagos_parciales")
        .select("id, costo_financiero_monto, facturas!inner(ordenes_servicio!inner(organization_id, fecha_completado, sucursal_id))")
        .eq("facturas.ordenes_servicio.organization_id", organizationId!)
        .not("costo_financiero_monto", "is", null)
        .gt("costo_financiero_monto", 0)
        .not("facturas.ordenes_servicio.fecha_completado", "is", null)
        .gte("facturas.ordenes_servicio.fecha_completado", desdeISO)
        .lte("facturas.ordenes_servicio.fecha_completado", hastaISO)
      if (sid) q = q.eq("facturas.ordenes_servicio.sucursal_id", sid)
      return q.order("id", { ascending: true }).range(desde, hasta)
    })
    marcar("costos financieros de servicios", pagosParcialCFTrunc)

    let costosFinancierosServicios = 0
    for (const p of pagosParcialCF as any[]) {
      costosFinancierosServicios += parseFloat(p.costo_financiero_monto || "0")
    }

    // CF de cobros directos a orden (sin factura) en período
    const { filas: cobrosCF, truncado: cobrosCFTrunc } = await traerTodo<any>((desde, hasta) => {
      let q = supabaseAdmin
        .from("cobros_orden")
        .select("id, costo_financiero_monto, created_at, ordenes_servicio!inner(organization_id, sucursal_id)")
        .eq("organization_id", organizationId!)
        .eq("ordenes_servicio.organization_id", organizationId!)
        .neq("anulado", true)
        .not("costo_financiero_monto", "is", null)
        .gt("costo_financiero_monto", 0)
        .gte("created_at", desdeISO)
        .lte("created_at", hastaISO)
      if (sid) q = q.eq("ordenes_servicio.sucursal_id", sid)
      return q.order("id", { ascending: true }).range(desde, hasta)
    })
    marcar("costos financieros de cobros", cobrosCFTrunc)

    let costosFinancierosCobrosOrden = 0
    for (const c of cobrosCF as any[]) {
      costosFinancierosCobrosOrden += parseFloat(c.costo_financiero_monto || "0")
    }

    const totalCostosFinancieros = costosFinancierosVentas + costosFinancierosServicios + costosFinancierosCobrosOrden

    // ========================================
    // 4.4 NOTAS DE CRÉDITO en período → restan ingresos
    // ========================================
    const { filas: notasCredito, truncado: ncTrunc } = await traerTodo<any>((desde, hasta) => {
      let q = supabaseAdmin
        .from("notas_credito")
        .select("id, monto, venta_id, orden_id")
        .eq("organization_id", organizationId!)
        .eq("anulada", false)
        .gte("fecha", desdeISO)
        .lte("fecha", hastaISO)
      if (sid) q = q.eq("sucursal_id", sid)
      return q.order("id", { ascending: true }).range(desde, hasta)
    })
    marcar("notas de crédito", ncTrunc)

    let ncVentas = 0
    let ncServicios = 0
    for (const n of notasCredito as any[]) {
      const monto = parseFloat(n.monto || "0")
      if (n.venta_id) ncVentas += monto
      else if (n.orden_id) ncServicios += monto
    }
    const totalNotasCredito = ncVentas + ncServicios

    // ========================================
    // 4.5 MERMAS / AJUSTES DE INVENTARIO (SALIDA con afecta_rentabilidad=true)
    // ========================================
    const { filas: ajustes, truncado: ajustesTrunc } = await traerTodo<any>((desde, hasta) => {
      let q = supabaseAdmin
        .from("ajustes_inventario")
        .select("id, tipo, cantidad, costo_unitario_snapshot, afecta_rentabilidad")
        .eq("organization_id", organizationId!)
        .eq("direccion", "SALIDA")
        .gte("fecha", desdeISO)
        .lte("fecha", hastaISO)
      if (sid) q = q.eq("sucursal_id", sid)
      return q.order("id", { ascending: true }).range(desde, hasta)
    })
    marcar("ajustes de inventario", ajustesTrunc)

    let costoMerma = 0
    const mermaPorTipo: Record<string, number> = {}
    for (const a of ajustes as any[]) {
      if (a.afecta_rentabilidad === false) continue
      const monto = (a.cantidad || 0) * parseFloat(a.costo_unitario_snapshot || "0")
      costoMerma += monto
      mermaPorTipo[a.tipo] = (mermaPorTipo[a.tipo] || 0) + monto
    }

    // ========================================
    // 4.6 FALTANTES Y SOBRANTES DE CAJA (auditoría contable, punto 1.5)
    // ========================================
    // Al cerrar caja se guarda la diferencia entre lo que debería haber y lo
    // que se contó, y hasta ahora ahí quedaba: ningún reporte la miraba. Un
    // faltante de $2.000 por día son $60.000 por mes que desaparecían de la
    // ganancia sin dejar rastro en ninguna pantalla.
    //
    // Signo: `diferencia = conteo_fisico - esperado`. Negativo es faltante
    // (plata que no está: resta) y positivo es sobrante (suma). Se informan
    // por separado porque no se compensan entre sí para el que investiga:
    // un mes con $50.000 de faltantes y $50.000 de sobrantes no es un mes
    // prolijo.
    //
    // Se toman las sesiones CERRADAS por `closed_at` (cuándo se arqueó), no
    // por `fecha`: es el momento en que la diferencia se conoció.
    const { filas: sesionesCerradas, truncado: sesionesTrunc } = await traerTodo<any>((desde, hasta) => {
      let q = supabaseAdmin
        .from("sesiones_caja")
        .select("id, diferencia, closed_at")
        .eq("organization_id", organizationId!)
        .eq("estado", "CERRADA")
        .not("diferencia", "is", null)
        .gte("closed_at", desdeISO)
        .lte("closed_at", hastaISO)
      if (sid) q = q.eq("sucursal_id", sid)
      return q.order("id", { ascending: true }).range(desde, hasta)
    })
    marcar("cierres de caja", sesionesTrunc)

    let faltantesCaja = 0
    let sobrantesCaja = 0
    let cierresConDiferencia = 0
    for (const s of sesionesCerradas as any[]) {
      const dif = parseFloat(s.diferencia || "0")
      if (dif === 0) continue
      cierresConDiferencia++
      if (dif < 0) faltantesCaja += Math.abs(dif)
      else sobrantesCaja += dif
    }
    // Neto con signo contable: negativo resta de la ganancia.
    const netoDiferenciasCaja = sobrantesCaja - faltantesCaja

    // ========================================
    // 5. GASTOS (movimientos manuales tipo EGRESO con afecta_rentabilidad = true)
    // ========================================
    const { filas: movEgresos, truncado: movEgresosTrunc } = await traerTodo<any>((desde, hasta) => {
      let q = supabaseAdmin
        .from("movimientos_caja")
        .select(`
          id, monto, afecta_rentabilidad, categoria_gasto_id,
          categorias_gasto (id, nombre, tipo, color)
        `)
        .eq("organization_id", organizationId!)
        .eq("tipo", "EGRESO")
        .eq("anulado", false)
        .gte("fecha", desdeISO)
        .lte("fecha", hastaISO)
      if (sid) q = q.eq("sucursal_id", sid)
      return q.order("id", { ascending: true }).range(desde, hasta)
    })
    marcar("gastos", movEgresosTrunc)

    let gastosFijos = 0
    let gastosVariables = 0
    let gastosSinCategorizar = 0
    let gastosNoComputables = 0 // afecta_rentabilidad = false (retiros, etc)
    const porCategoria: Record<
      string,
      { id: string; nombre: string; tipo: string; color: string | null; monto: number }
    > = {}

    for (const m of movEgresos) {
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
    const gananciaNeta =
      gananciaBruta - totalGastos - totalCostosFinancieros - totalComisiones + netoDiferenciasCaja

    const margenBruto = totalIngresos > 0 ? (gananciaBruta / totalIngresos) * 100 : 0
    const margenNeto = totalIngresos > 0 ? (gananciaNeta / totalIngresos) * 100 : 0

    return NextResponse.json({
      periodo: {
        desde: desdeISO,
        hasta: hastaISO,
        zonaHoraria: tz,
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
      diferenciasCaja: {
        faltantes: round(faltantesCaja),
        sobrantes: round(sobrantesCaja),
        neto: round(netoDiferenciasCaja),
        cierresConDiferencia,
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
        ventasCount: ventas.length,
        ordenesCount: ordenes.length,
        itemsConCostoConocido,
        itemsSinCostoConocido,
        gastosNoComputables: round(gastosNoComputables),
        movEgresosCount: movEgresos.length,
        movEgresosSinCategoria: movEgresos.filter((m: any) => !m.categorias_gasto && m.afecta_rentabilidad !== false).length,
        // Si esto viene en true el reporte es un PISO, no el total real.
        incompleto: fuentesIncompletas.length > 0,
        fuentesIncompletas,
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
