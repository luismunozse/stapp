import { NextResponse } from "next/server"
import { requireIngresosAccess } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { sucursalParaLectura } from "@/lib/sucursal"
import { getDeviceTypeLabel } from "@/lib/device-types"
import { getZonedParts, monthKeyInTimeZone, monthRangeUtc } from "@/lib/timezone"
import { resolverPeriodo, zonaHorariaOrg } from "@/lib/reportes-periodo"
import { traerTodo } from "@/lib/supabase-paginado"
import { nombreMesCivil } from "@/lib/finanzas-period"

/**
 * Resumen de ingresos (solapa Ingresos de Finanzas) — base caja.
 *
 * PERÍODO Y MESES EN LA ZONA DEL TALLER (auditoría contable, punto 1.2)
 *   El rango y el bucket mensual se resuelven en la tz de la org. Antes la tz
 *   se leía pero sólo alimentaba el NOMBRE del mes: los límites y el bucket
 *   salían del reloj del proceso (UTC en Vercel). Resultado: la etiqueta decía
 *   "septiembre" y adentro había cobros del 31/08 a la noche.
 *
 * COMPLETITUD (auditoría contable, punto 1.1)
 *   Las fuentes se leen paginadas, con `.order("id")` para que range() no
 *   repita ni saltee filas.
 */
export async function GET(request: Request) {
  try {
    const { error, organizationId, role, session } = await requireIngresosAccess()
    if (error) return error

    const filtro = await sucursalParaLectura({ role, userSucursalId: session!.user.sucursalId ?? null })

    const { searchParams } = new URL(request.url)
    const desdeParam = searchParams.get("desde")
    const hastaParam = searchParams.get("hasta")
    const meses = Math.max(1, Math.min(24, parseInt(searchParams.get("meses") || "6")))

    const now = new Date()

    // Rango explícito (desde/hasta) tiene prioridad sobre `meses`.
    // Sin rango, se usa la ventana de los últimos N meses (default 6).
    let tz: string
    let desdeISO: string
    let hastaISO: string
    if (desdeParam && hastaParam) {
      ;({ tz, desdeISO, hastaISO } = await resolverPeriodo(organizationId!, desdeParam, hastaParam))
    } else {
      tz = await zonaHorariaOrg(organizationId!)
      const { year, month } = getZonedParts(now, tz)
      desdeISO = monthRangeUtc(year, month - meses + 1, tz).desde.toISOString()
      hastaISO = now.toISOString()
    }

    // Claves de mes (YYYY-MM) que abarca el rango, en el calendario del taller.
    // Tienen que salir de la misma tz que los límites, o el primer y el último
    // mes quedan cortados a medias.
    const monthKeys: string[] = []
    {
      const inicio = getZonedParts(new Date(desdeISO), tz)
      const fin = getZonedParts(new Date(hastaISO), tz)
      const ultimo = fin.year * 12 + (fin.month - 1)
      for (let i = inicio.year * 12 + (inicio.month - 1); i <= ultimo; i++) {
        monthKeys.push(`${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`)
      }
    }

    const fuentesIncompletas: string[] = []
    const marcar = (nombre: string, truncado: boolean) => {
      if (truncado) fuentesIncompletas.push(nombre)
    }

    // Facturas pagadas (branch-filtered via ordenes_servicio!inner)
    const { filas: facturas, truncado: facturasTrunc } = await traerTodo<any>((desde, hasta) => {
      let q = supabaseAdmin
        .from("facturas")
        .select(`
          id, total, subtotal, iva, fecha, orden_id,
          pagos_parciales (monto, metodo_pago),
          ordenes_servicio!inner (
            id, organization_id, sucursal_id, tipo_dispositivo, dispositivo,
            tipos_dispositivo:tipo_dispositivo_id(nombre)
          )
        `)
        .eq("ordenes_servicio.organization_id", organizationId!)
        .eq("estado_pago", "PAGADO")
        .gte("fecha", desdeISO)
        .lte("fecha", hastaISO)
      if (!filtro.verTodas && filtro.sucursalId) {
        q = q.eq("ordenes_servicio.sucursal_id", filtro.sucursalId)
      }
      return q.order("id", { ascending: true }).range(desde, hasta)
    })
    marcar("remitos pagados", facturasTrunc)

    // Ventas completadas (branch-filtered directly)
    const { filas: ventas, truncado: ventasTrunc } = await traerTodo<any>((desde, hasta) => {
      let q = supabaseAdmin
        .from("ventas")
        .select("id, total, iva_neto, iva_monto, metodo_pago, created_at")
        .eq("organization_id", organizationId!)
        .eq("estado", "COMPLETADA")
        .gte("created_at", desdeISO)
        .lte("created_at", hastaISO)
      if (!filtro.verTodas && filtro.sucursalId) {
        q = q.eq("sucursal_id", filtro.sucursalId)
      }
      return q.order("id", { ascending: true }).range(desde, hasta)
    })
    marcar("ventas", ventasTrunc)

    // Cobros directos a órdenes (branch-filtered via ordenes_servicio!inner)
    const { filas: cobros, truncado: cobrosTrunc } = await traerTodo<any>((desde, hasta) => {
      let q = supabaseAdmin
        .from("cobros_orden")
        .select(`
          id, monto, created_at, orden_id, metodo_pago,
          ordenes_servicio!inner (
            organization_id, sucursal_id, tipo_dispositivo, dispositivo,
            tipos_dispositivo:tipo_dispositivo_id(nombre)
          )
        `)
        .eq("organization_id", organizationId!)
        .eq("ordenes_servicio.organization_id", organizationId!)
        .neq("anulado", true)
        .gte("created_at", desdeISO)
        .lte("created_at", hastaISO)
      if (!filtro.verTodas && filtro.sucursalId) {
        q = q.eq("ordenes_servicio.sucursal_id", filtro.sucursalId)
      }
      return q.order("id", { ascending: true }).range(desde, hasta)
    })
    marcar("cobros de ordenes", cobrosTrunc)

    // Set de órdenes con cobro directo — para excluir factura duplicada
    const ordenesConCobro = new Set(cobros.map((c: any) => c.orden_id))

    // Aggregate por mes
    const ingresosPorMes: Record<string, { servicios: number; ventas: number }> = {}
    // Aggregate por mes × método de pago (facturas sin método → SIN_ESPECIFICAR)
    const metodoPorMes: Record<string, Record<string, number>> = {}
    for (const key of monthKeys) {
      ingresosPorMes[key] = { servicios: 0, ventas: 0 }
      metodoPorMes[key] = {}
    }

    const addMetodo = (key: string, metodo: string, monto: number) => {
      if (!metodoPorMes[key]) return
      metodoPorMes[key][metodo] = (metodoPorMes[key][metodo] || 0) + monto
    }

    for (const f of facturas) {
      if (ordenesConCobro.has(f.orden_id)) continue
      const key = monthKeyInTimeZone(f.fecha, tz)
      // NET: subtotal (== total when no IVA — EXENTO no-op)
      const monto = Number((f as any).subtotal || f.total || 0)
      if (ingresosPorMes[key]) ingresosPorMes[key].servicios += monto
      // Método de pago: prorratear el neto según los pagos_parciales (que son brutos).
      // El bruto de referencia es factura.total; si no hay pagos, cae en SIN_ESPECIFICAR.
      const pagos = ((f as any).pagos_parciales || []) as { monto: any; metodo_pago: string }[]
      const brutoTotal = Number(f.total || 0)
      if (pagos.length > 0 && brutoTotal > 0) {
        for (const p of pagos) {
          const share = Number(p.monto || 0) / brutoTotal
          addMetodo(key, p.metodo_pago || "OTRO", monto * share)
        }
      } else {
        addMetodo(key, "SIN_ESPECIFICAR", monto)
      }
    }

    for (const c of cobros as any[]) {
      const key = monthKeyInTimeZone(c.created_at, tz)
      // Direct order payments: no IVA breakdown — kept at gross (face value)
      const monto = Number(c.monto || 0)
      if (ingresosPorMes[key]) ingresosPorMes[key].servicios += monto
      addMetodo(key, c.metodo_pago || "EFECTIVO", monto)
    }

    for (const v of ventas) {
      const key = monthKeyInTimeZone(v.created_at, tz)
      // NET: COALESCE(iva_neto, total) — iva_neto is NULL for EXENTO/legacy (no-op)
      const monto = Number((v as any).iva_neto ?? v.total ?? 0)
      if (ingresosPorMes[key]) ingresosPorMes[key].ventas += monto
      addMetodo(key, (v as any).metodo_pago || "OTRO", monto)
    }

    const porMes = Object.entries(ingresosPorMes)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, data]) => {
        const [year, month] = key.split("-")
        const nombreMes = nombreMesCivil(parseInt(year), parseInt(month), tz)
        return {
          mes: nombreMes.corto,
          mesCompleto: nombreMes.completo,
          servicios: data.servicios,
          ventas: data.ventas,
          total: data.servicios + data.ventas,
        }
      })

    // Desglose mensual por método de pago (para el selector de mes en el frontend)
    const porMetodoPago = Object.entries(metodoPorMes)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, metodos]) => {
        const [year, month] = key.split("-")
        const nombreMes = nombreMesCivil(parseInt(year), parseInt(month), tz)
        const lista = Object.entries(metodos)
          .map(([metodo, monto]) => ({ metodo, monto }))
          .sort((a, b) => b.monto - a.monto)
        return {
          mesKey: key,
          mes: nombreMes.corto,
          mesCompleto: nombreMes.completo,
          total: lista.reduce((sum, m) => sum + m.monto, 0),
          metodos: lista,
        }
      })

    // Aggregate por tipo de dispositivo (facturas + cobros, dedupe por orden)
    const dispositivoMap = new Map<string, { total: number; cantidad: number }>()

    for (const f of facturas) {
      if (ordenesConCobro.has(f.orden_id)) continue
      const orden = f.ordenes_servicio as any
      const tipo = orden?.tipo_dispositivo || "OTRO"
      const tipoDisp = orden?.tipos_dispositivo as any
      const label = getDeviceTypeLabel(tipo, tipoDisp?.nombre)
      const existing = dispositivoMap.get(label) || { total: 0, cantidad: 0 }
      // NET: subtotal (== total when no IVA — EXENTO no-op)
      existing.total += Number((f as any).subtotal || f.total || 0)
      existing.cantidad++
      dispositivoMap.set(label, existing)
    }

    for (const c of cobros as any[]) {
      const orden = c.ordenes_servicio as any
      const tipo = orden?.tipo_dispositivo || "OTRO"
      const tipoDisp = orden?.tipos_dispositivo as any
      const label = getDeviceTypeLabel(tipo, tipoDisp?.nombre)
      const existing = dispositivoMap.get(label) || { total: 0, cantidad: 0 }
      existing.total += Number(c.monto || 0)
      existing.cantidad++
      dispositivoMap.set(label, existing)
    }

    const porDispositivo = Array.from(dispositivoMap.entries())
      .map(([tipo, data]) => ({ tipo, total: data.total, cantidad: data.cantidad }))
      .sort((a, b) => b.total - a.total)

    // NET totals (IVA collected is a fiscal liability, not income)
    const facturasNetas = facturas.filter((f: any) => !ordenesConCobro.has(f.orden_id))
    const totalFacturas = facturasNetas.reduce((sum: number, f: any) => sum + Number(f.subtotal || f.total || 0), 0)
    const totalCobros = cobros.reduce((sum: number, c: any) => sum + Number(c.monto || 0), 0)
    const totalServicios = totalFacturas + totalCobros
    const totalVentas = ventas.reduce(
      (sum: number, v: any) => sum + Number(v.iva_neto ?? v.total ?? 0),
      0
    )
    const cantidadFacturasNetas = facturasNetas.length
    // IVA breakdown: facturas iva + ventas iva_monto; cobros_orden have no breakdown
    const totalIvaFacturas = facturasNetas.reduce((sum: number, f: any) => sum + Number(f.iva || 0), 0)
    const totalIvaVentas = ventas.reduce((sum: number, v: any) => sum + Number(v.iva_monto || 0), 0)
    const totalIva = totalIvaFacturas + totalIvaVentas

    // Notas de crédito — restan del total del período (no por mes, muy complejo)
    const { filas: notasCredito, truncado: ncTrunc } = await traerTodo<any>((desde, hasta) => {
      let q = supabaseAdmin
        .from("notas_credito")
        .select("id, monto")
        .eq("organization_id", organizationId!)
        .eq("anulada", false)
        .gte("fecha", desdeISO)
        .lte("fecha", hastaISO)
      if (!filtro.verTodas && filtro.sucursalId) {
        q = q.eq("sucursal_id", filtro.sucursalId)
      }
      return q.order("id", { ascending: true }).range(desde, hasta)
    })
    marcar("notas de credito", ncTrunc)
    const totalNotasCredito = notasCredito.reduce(
      (sum: number, n: any) => sum + Number(n.monto || 0),
      0
    )

    return NextResponse.json({
      resumen: {
        // NET income (base imponible) after notas de crédito
        totalIngresos: totalServicios + totalVentas - totalNotasCredito,
        totalServicios,
        totalVentas,
        totalIva,
        totalNotasCredito,
        cantidadServicios: cantidadFacturasNetas + cobros.length,
        cantidadVentas: ventas.length,
      },
      porMes,
      porMetodoPago,
      porDispositivo,
      periodo: {
        desde: desdeISO,
        hasta: hastaISO,
        meses: monthKeys.length,
        zonaHoraria: tz,
      },
      meta: {
        // true = el reporte es un piso, no el total real.
        incompleto: fuentesIncompletas.length > 0,
        fuentesIncompletas,
      },
    })
  } catch (error) {
    console.error("Error en resumen de ingresos:", error)
    return NextResponse.json(
      { error: "Error al obtener resumen de ingresos" },
      { status: 500 }
    )
  }
}
