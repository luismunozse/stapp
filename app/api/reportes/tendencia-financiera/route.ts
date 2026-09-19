import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { sucursalParaLectura } from "@/lib/sucursal"
import { monthKeyInTimeZone, monthRangeUtc } from "@/lib/timezone"
import { resolverVentanaMeses } from "@/lib/reportes-periodo"
import { traerTodo, traerTodoPorLotes } from "@/lib/supabase-paginado"
import { nombreMesCivil } from "@/lib/finanzas-period"

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
 *
 * MESES EN LA ZONA DEL TALLER (auditoría contable, punto 1.2)
 *   Tanto los límites de la ventana como el bucket de cada fila se resuelven
 *   en la tz de la org. Antes `new Date(iso).getMonth()` corría con el reloj
 *   del proceso (UTC en Vercel), así que una venta del 30/09 a las 22:00 de
 *   Argentina caía en el bucket de octubre. El nombre del mes sí usaba la tz
 *   de la org, de modo que la etiqueta y el contenido no coincidían.
 *
 * COMPLETITUD (auditoría contable, punto 1.1)
 *   Las fuentes se leen paginadas. Este reporte es el que más sufría el corte
 *   de 1000 filas de PostgREST: mira entre 6 y 24 meses de una, así que
 *   cualquier taller con movimiento perdía los meses viejos.
 */
export async function GET(request: Request) {
  try {
    const { error, organizationId, role, session } = await requireAdmin()
    if (error) return error

    // Resolve branch filter — applied to every P&L sub-source
    const filtro = await sucursalParaLectura({ role, userSucursalId: session!.user.sucursalId ?? null })
    const sid = !filtro.verTodas && filtro.sucursalId ? filtro.sucursalId : null

    const { searchParams } = new URL(request.url)
    const meses = Math.max(1, Math.min(24, parseInt(searchParams.get("meses") || "6")))

    const { tz, desdeISO, hastaISO, claves } = await resolverVentanaMeses(
      organizationId!,
      meses
    )

    const fuentesIncompletas: string[] = []
    const marcar = (nombre: string, truncado: boolean) => {
      if (truncado) fuentesIncompletas.push(nombre)
    }

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
      costoMerma: number
      gastos: number
      costosFinancieros: number
      comisiones: number
      faltantesCaja: number
      sobrantesCaja: number
      gananciaBruta: number
      gananciaNeta: number
    }

    // Las claves salen del mismo calendario que los límites de la ventana
    // (ver resolverVentanaMeses): si se calcularan aparte, el primer y el
    // último mes quedarían cortados a medias.
    const buckets: Record<string, Bucket> = {}
    for (const key of claves) {
      const [anioMes, mesMes] = key.split("-").map(Number)
      const nombreMes = nombreMesCivil(anioMes, mesMes, tz)
      buckets[key] = {
        mes: nombreMes.corto,
        mesCompleto: nombreMes.completo,
        ingresos: 0,
        ingresosVentas: 0,
        ingresosServicios: 0,
        ingresosOtros: 0,
        costos: 0,
        costoProductos: 0,
        costoRepuestos: 0,
        costoMerma: 0,
        gastos: 0,
        costosFinancieros: 0,
        comisiones: 0,
        faltantesCaja: 0,
        sobrantesCaja: 0,
        gananciaBruta: 0,
        gananciaNeta: 0,
      }
    }

    // En qué mes cayó el instante PARA EL TALLER. Con el reloj del proceso,
    // una venta del último día del mes a la noche se iba al mes siguiente.
    const keyFor = (iso: string) => monthKeyInTimeZone(iso, tz)

    // 1. Ventas (ingresos por ventas + costo de mercadería + comisión vendedor)
    // `.order("id")` es obligatorio al paginar: sin un orden estable, range()
    // puede repetir o saltear filas entre páginas.
    const { filas: ventas, truncado: ventasTrunc } = await traerTodo<any>((desde, hasta) => {
      let q = supabaseAdmin
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
      if (sid) q = q.eq("sucursal_id", sid)
      return q.order("id", { ascending: true }).range(desde, hasta)
    })
    marcar("ventas", ventasTrunc)

    for (const v of ventas) {
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
    // (A) Órdenes terminales por fecha_completado.
    //     Para el bucket mensual, ingreso = costo_final - cobros_previos_al_mes.
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

    // Cobros previos por orden (estrictamente antes del inicio de cada mes destino).
    // Para simplificar: agrupar cobros por orden_id ordenados por fecha,
    // y al procesar cada orden sumar cobros con fecha < inicio del mes de fecha_completado.
    const terminalIds = ordenes.map((o: any) => o.id)
    const cobrosByOrden = new Map<string, Array<{ fecha: string; monto: number }>>()
    if (terminalIds.length > 0) {
      // Por lotes: la lista de ids ya no está acotada a 1000 y `.in()` viaja
      // en la query string.
      const { filas: cobrosTerm, truncado } = await traerTodoPorLotes<any>(
        terminalIds,
        (lote, desde, hasta) =>
          supabaseAdmin
            .from("cobros_orden")
            .select("id, orden_id, monto, created_at")
            .in("orden_id", lote)
            .neq("anulado", true)
            .order("id", { ascending: true })
            .range(desde, hasta)
      )
      marcar("cobros de ordenes", truncado)
      for (const c of cobrosTerm as any[]) {
        const list = cobrosByOrden.get(c.orden_id) || []
        list.push({ fecha: c.created_at, monto: parseFloat(c.monto || "0") })
        cobrosByOrden.set(c.orden_id, list)
      }
    }

    // Medianoche local del día 1 del mes de la clave. Derivarlo de la clave
    // —y no de `new Date(iso).getMonth()`— mantiene el corte de "cobro previo
    // al mes" en el mismo calendario que el bucket.
    const inicioMesDeClave = (key: string) => {
      const [anio, mes] = key.split("-").map(Number)
      return monthRangeUtc(anio, mes, tz).desde.toISOString()
    }

    for (const o of ordenes as any[]) {
      const key = keyFor(o.fecha_completado)
      const bucket = buckets[key]
      if (!bucket) continue

      const inicioMes = inicioMesDeClave(key)
      const cobrosPrev = (cobrosByOrden.get(o.id) || [])
        .filter((c) => c.fecha < inicioMes)
        .reduce((s, c) => s + c.monto, 0)

      const costoFinal = parseFloat(o.costo_final || "0")
      const ingreso = o.estado === "ENTREGADO_SIN_COBRO" ? 0 : Math.max(0, costoFinal - cobrosPrev)
      bucket.ingresosServicios += ingreso

      let costoRepO = 0
      for (const r of (o.repuestos_orden || [])) {
        costoRepO += (r.cantidad || 0) * parseFloat(r.precio_unitario || "0")
      }
      for (const c of (o.cotizaciones || [])) {
        if (c.deleted_at || c.estado !== "ACEPTADA") continue
        for (const it of (c.items_cotizacion || [])) {
          const costo = it.costo_unitario != null
            ? parseFloat(it.costo_unitario)
            : (it.inventario ? parseFloat(it.inventario.precio_compra || "0") : 0)
          if (costo <= 0) continue
          costoRepO += (it.cantidad || 0) * costo
        }
      }
      bucket.costoRepuestos += costoRepO

      // Comisión técnico sobre ganancia bruta devengada (costo_final completo, no neto).
      if (o.tecnico_id && costoFinal > 0 && o.estado !== "ENTREGADO_SIN_COBRO") {
        const pct = parseFloat(o.porcentaje_comision || "0")
        if (pct > 0) {
          const ganancia = Math.max(0, costoFinal - costoRepO)
          bucket.comisiones += (ganancia * pct) / 100
        }
      }
    }

    // (B) Cobros adelantados por mes.
    //     Excluye:
    //       - Cobro del mismo mes que completó la orden (ya en (A))
    //       - Orden CANCELADO / SIN_REPARACION (nunca devengará)
    //       - Cobro POSTERIOR al mes de completado (ya devengó full en su mes)
    const { filas: cobrosPeriodo, truncado: cobrosPeriodoTrunc } = await traerTodo<any>((desde, hasta) => {
      let q = supabaseAdmin
        .from("cobros_orden")
        .select("id, orden_id, monto, created_at, ordenes_servicio!inner(estado, fecha_completado, organization_id, sucursal_id)")
        .eq("ordenes_servicio.organization_id", organizationId!)
        .neq("anulado", true)
        .gte("created_at", desdeISO)
        .lte("created_at", hastaISO)
      if (sid) q = q.eq("ordenes_servicio.sucursal_id", sid)
      return q.order("id", { ascending: true }).range(desde, hasta)
    })
    marcar("cobros del periodo", cobrosPeriodoTrunc)

    const ESTADOS_NUNCA_DEVENGAN = new Set(["CANCELADO", "SIN_REPARACION", "SIN_FALLA_DETECTADA"])
    const ESTADOS_TERMINALES_DEV = new Set(["REPARADO", "ENTREGADO", "ENTREGADO_SIN_REPARACION", "ENTREGADO_SIN_COBRO"])

    for (const c of cobrosPeriodo as any[]) {
      const key = keyFor(c.created_at)
      const bucket = buckets[key]
      if (!bucket) continue
      const os = c.ordenes_servicio
      if (!os) continue
      if (ESTADOS_NUNCA_DEVENGAN.has(os.estado)) continue

      if (ESTADOS_TERMINALES_DEV.has(os.estado) && os.fecha_completado) {
        const mesCompletado = keyFor(os.fecha_completado)
        // Cobro mismo mes que completed: ya parte de costo_final en (A)
        if (key === mesCompletado) continue
        // Cobro posterior al mes de completed: ya devengado full → no contar
        if (key > mesCompletado) continue
        // Cobro previo al mes de completed: contar como adelanto en su mes
      }
      bucket.ingresosServicios += parseFloat(c.monto || "0")
    }

    // 3. Movimientos manuales de caja (otros ingresos + gastos operativos)
    // `anulado = false` (mig 327): la fila anulada queda para dejar rastro,
    // pero no es plata.
    const { filas: movimientos, truncado: movTrunc } = await traerTodo<any>((desde, hasta) => {
      let q = supabaseAdmin
        .from("movimientos_caja")
        .select("id, tipo, monto, fecha, afecta_rentabilidad")
        .eq("organization_id", organizationId!)
        .eq("anulado", false)
        .gte("fecha", desdeISO)
        .lte("fecha", hastaISO)
      if (sid) q = q.eq("sucursal_id", sid)
      return q.order("id", { ascending: true }).range(desde, hasta)
    })
    marcar("movimientos de caja", movTrunc)

    for (const m of movimientos) {
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

    for (const p of pagosVentaCF as any[]) {
      const ventaCreated = p.ventas?.created_at
      if (!ventaCreated) continue
      const key = keyFor(ventaCreated)
      const bucket = buckets[key]
      if (!bucket) continue
      bucket.costosFinancieros += parseFloat(p.costo_financiero_monto || "0")
    }

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

    for (const p of pagosParcialCF as any[]) {
      const fc = p.facturas?.ordenes_servicio?.fecha_completado
      if (!fc) continue
      const key = keyFor(fc)
      const bucket = buckets[key]
      if (!bucket) continue
      bucket.costosFinancieros += parseFloat(p.costo_financiero_monto || "0")
    }

    // CF de cobros directos a orden (sin factura)
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

    for (const c of cobrosCF as any[]) {
      const key = keyFor(c.created_at)
      const bucket = buckets[key]
      if (!bucket) continue
      bucket.costosFinancieros += parseFloat(c.costo_financiero_monto || "0")
    }

    // 4.5 Notas de crédito (restan ingresos del mes)
    const { filas: notasCredito, truncado: ncTrunc } = await traerTodo<any>((desde, hasta) => {
      let q = supabaseAdmin
        .from("notas_credito")
        .select("id, monto, fecha, venta_id, orden_id")
        .eq("organization_id", organizationId!)
        .eq("anulada", false)
        .gte("fecha", desdeISO)
        .lte("fecha", hastaISO)
      if (sid) q = q.eq("sucursal_id", sid)
      return q.order("id", { ascending: true }).range(desde, hasta)
    })
    marcar("notas de credito", ncTrunc)

    for (const n of notasCredito as any[]) {
      const key = keyFor(n.fecha)
      const bucket = buckets[key]
      if (!bucket) continue
      const monto = parseFloat(n.monto || "0")
      if (n.venta_id) bucket.ingresosVentas = Math.max(0, bucket.ingresosVentas - monto)
      else if (n.orden_id) bucket.ingresosServicios = Math.max(0, bucket.ingresosServicios - monto)
    }

    // 5. Mermas / ajustes de inventario por mes
    const { filas: ajustes, truncado: ajustesTrunc } = await traerTodo<any>((desde, hasta) => {
      let q = supabaseAdmin
        .from("ajustes_inventario")
        .select("id, cantidad, costo_unitario_snapshot, fecha, afecta_rentabilidad")
        .eq("organization_id", organizationId!)
        .eq("direccion", "SALIDA")
        .gte("fecha", desdeISO)
        .lte("fecha", hastaISO)
      if (sid) q = q.eq("sucursal_id", sid)
      return q.order("id", { ascending: true }).range(desde, hasta)
    })
    marcar("ajustes de inventario", ajustesTrunc)

    for (const a of ajustes as any[]) {
      if (a.afecta_rentabilidad === false) continue
      const key = keyFor(a.fecha)
      const bucket = buckets[key]
      if (!bucket) continue
      bucket.costoMerma += (a.cantidad || 0) * parseFloat(a.costo_unitario_snapshot || "0")
    }

    // 6. Faltantes y sobrantes de arqueo por mes (auditoría contable, 1.5)
    //    La diferencia del cierre se guardaba y no la leía ningún reporte:
    //    un faltante sistemático desaparecía de la ganancia. Se bucketea por
    //    `closed_at` (cuándo se arqueó), que es cuando la diferencia se supo.
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

    for (const ses of sesionesCerradas as any[]) {
      if (!ses.closed_at) continue
      const bucket = buckets[keyFor(ses.closed_at)]
      if (!bucket) continue
      const dif = parseFloat(ses.diferencia || "0")
      if (dif < 0) bucket.faltantesCaja += Math.abs(dif)
      else if (dif > 0) bucket.sobrantesCaja += dif
    }

    // Calcular totales derivados por mes
    const porMes = Object.entries(buckets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, b]) => {
        b.ingresos = b.ingresosVentas + b.ingresosServicios + b.ingresosOtros
        b.costos = b.costoProductos + b.costoRepuestos + b.costoMerma
        b.gananciaBruta = b.ingresos - b.costos
        // El faltante de caja resta y el sobrante suma, igual que en el
        // Estado de Resultados (los dos tienen que dar el mismo número).
        b.gananciaNeta =
          b.gananciaBruta - b.gastos - b.costosFinancieros - b.comisiones
          + b.sobrantesCaja - b.faltantesCaja
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
          costoMerma: round(b.costoMerma),
          gastos: round(b.gastos),
          comisiones: round(b.comisiones),
          costosFinancieros: round(b.costosFinancieros),
          faltantesCaja: round(b.faltantesCaja),
          sobrantesCaja: round(b.sobrantesCaja),
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
        faltantesCaja: acc.faltantesCaja + m.faltantesCaja,
        sobrantesCaja: acc.sobrantesCaja + m.sobrantesCaja,
        gananciaBruta: acc.gananciaBruta + m.gananciaBruta,
        gananciaNeta: acc.gananciaNeta + m.gananciaNeta,
      }),
      {
        ingresos: 0, costos: 0, gastos: 0, comisiones: 0, costosFinancieros: 0,
        faltantesCaja: 0, sobrantesCaja: 0, gananciaBruta: 0, gananciaNeta: 0,
      }
    )

    return NextResponse.json({
      periodo: {
        desde: desdeISO,
        hasta: hastaISO,
        meses,
        zonaHoraria: tz,
      },
      porMes,
      totales: {
        ingresos: round(totales.ingresos),
        costos: round(totales.costos),
        gastos: round(totales.gastos),
        comisiones: round(totales.comisiones),
        costosFinancieros: round(totales.costosFinancieros),
        faltantesCaja: round(totales.faltantesCaja),
        sobrantesCaja: round(totales.sobrantesCaja),
        gananciaBruta: round(totales.gananciaBruta),
        gananciaNeta: round(totales.gananciaNeta),
      },
      meta: {
        // true = el reporte es un piso, no el total real.
        incompleto: fuentesIncompletas.length > 0,
        fuentesIncompletas,
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
