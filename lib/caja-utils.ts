import { supabaseAdmin } from "@/lib/supabase"

export interface MovimientoUnificado {
  tipo: string
  monto: number
  metodoPago: string
  fecha: string
  referencia: string
  referenciaId: string
  referenciaNumero?: string | null
  observaciones: string | null
  esEgreso?: boolean
}

interface FetchMovimientosOptions {
  metodoPago?: string
  tipo?: string
}

/**
 * Obtiene todos los movimientos de caja de un día, unificando las 5 fuentes:
 * cobros_orden, pagos_parciales, pagos_venta, cuenta_corriente, movimientos_caja
 */
export async function fetchMovimientosDia(
  organizationId: string,
  fechaDesde: string,
  fechaHasta: string,
  filters?: FetchMovimientosOptions
) {
  // 1. Cobros de órdenes
  const { data: cobrosOrdenes } = await supabaseAdmin
    .from("cobros_orden")
    .select("monto, metodo_pago, created_at, orden_id, observaciones, ordenes_servicio:orden_id(numero_orden)")
    .eq("organization_id", organizationId)
    .gte("created_at", fechaDesde)
    .lte("created_at", fechaHasta)
    .order("created_at", { ascending: false })

  // 2. Pagos de facturas
  const { data: pagosFacturas } = await supabaseAdmin
    .from("pagos_parciales")
    .select(`
      monto, metodo_pago, fecha, factura_id, observaciones,
      facturas!inner(
        id, numero_factura,
        ordenes_servicio!inner(organization_id, numero_orden)
      )
    `)
    .eq("facturas.ordenes_servicio.organization_id", organizationId)
    .gte("fecha", fechaDesde)
    .lte("fecha", fechaHasta)
    .order("fecha", { ascending: false })

  // 3. Pagos de ventas
  const { data: pagosVentas } = await supabaseAdmin
    .from("pagos_venta")
    .select(`
      monto, metodo_pago, fecha, venta_id, observaciones,
      ventas!inner(organization_id, numero_venta)
    `)
    .eq("ventas.organization_id", organizationId)
    .gte("fecha", fechaDesde)
    .lte("fecha", fechaHasta)
    .order("fecha", { ascending: false })

  // 4. Depósitos cuenta corriente
  const { data: depositos } = await supabaseAdmin
    .from("cuenta_corriente")
    .select("monto, metodo_pago, created_at, observaciones, cliente_id")
    .eq("organization_id", organizationId)
    .eq("tipo", "DEPOSITO")
    .gte("created_at", fechaDesde)
    .lte("created_at", fechaHasta)
    .order("created_at", { ascending: false })

  // 5. Movimientos manuales de caja
  const { data: movimientosManuales } = await supabaseAdmin
    .from("movimientos_caja")
    .select("id, tipo, monto, metodo_pago, concepto, observaciones, fecha")
    .eq("organization_id", organizationId)
    .gte("fecha", fechaDesde)
    .lte("fecha", fechaHasta)
    .order("fecha", { ascending: false })

  // Construir lista unificada
  const movimientos: MovimientoUnificado[] = []

  for (const c of cobrosOrdenes || []) {
    const ordenNum = (c as any).ordenes_servicio?.numero_orden
    movimientos.push({
      tipo: "COBRO_ORDEN",
      monto: parseFloat(c.monto),
      metodoPago: c.metodo_pago,
      fecha: c.created_at,
      referencia: "Orden",
      referenciaId: c.orden_id,
      referenciaNumero: ordenNum ? `ORD-${String(ordenNum).padStart(4, "0")}` : null,
      observaciones: c.observaciones,
    })
  }

  for (const p of pagosFacturas || []) {
    const factura = (p as any).facturas
    const numFactura = factura?.numero_factura
    const numOrden = factura?.ordenes_servicio?.numero_orden
    movimientos.push({
      tipo: "PAGO_FACTURA",
      monto: parseFloat(p.monto),
      metodoPago: p.metodo_pago,
      fecha: p.fecha,
      referencia: "Factura",
      referenciaId: p.factura_id,
      referenciaNumero: numFactura || (numOrden ? `ORD-${String(numOrden).padStart(4, "0")}` : null),
      observaciones: p.observaciones,
    })
  }

  for (const p of pagosVentas || []) {
    const numVenta = (p as any).ventas?.numero_venta
    movimientos.push({
      tipo: "PAGO_VENTA",
      monto: parseFloat(p.monto),
      metodoPago: p.metodo_pago,
      fecha: p.fecha,
      referencia: "Venta",
      referenciaId: p.venta_id,
      referenciaNumero: numVenta ? `V-${String(numVenta).padStart(4, "0")}` : null,
      observaciones: p.observaciones,
    })
  }

  for (const d of depositos || []) {
    movimientos.push({
      tipo: "DEPOSITO_CUENTA",
      monto: parseFloat(d.monto),
      metodoPago: d.metodo_pago,
      fecha: d.created_at,
      referencia: "Depósito a cuenta",
      referenciaId: d.cliente_id,
      observaciones: d.observaciones,
    })
  }

  for (const m of movimientosManuales || []) {
    movimientos.push({
      tipo: m.tipo === "INGRESO" ? "INGRESO_MANUAL" : "EGRESO_MANUAL",
      monto: parseFloat(m.monto),
      metodoPago: m.metodo_pago,
      fecha: m.fecha,
      referencia: m.concepto,
      referenciaId: m.id,
      observaciones: m.observaciones,
      esEgreso: m.tipo === "EGRESO",
    })
  }

  // Aplicar filtros
  let filtrados = movimientos
  if (filters?.metodoPago) {
    filtrados = filtrados.filter((m) => m.metodoPago === filters.metodoPago)
  }
  if (filters?.tipo) {
    filtrados = filtrados.filter((m) => m.tipo === filters.tipo)
  }

  // Ordenar por fecha desc
  filtrados.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())

  return filtrados
}

/**
 * Calcula totales a partir de una lista de movimientos unificados
 */
export function computeTotales(movimientos: MovimientoUnificado[]) {
  const porMetodo: Record<string, number> = {}
  const porTipo: Record<string, { count: number; total: number }> = {}
  let totalIngresos = 0
  let totalEgresos = 0
  let totalIngresosEfectivo = 0
  let totalEgresosEfectivo = 0

  for (const m of movimientos) {
    const montoConSigno = m.esEgreso ? -m.monto : m.monto
    porMetodo[m.metodoPago] = (porMetodo[m.metodoPago] || 0) + montoConSigno

    if (!porTipo[m.tipo]) porTipo[m.tipo] = { count: 0, total: 0 }
    porTipo[m.tipo].count++
    porTipo[m.tipo].total += m.monto

    if (m.esEgreso) {
      totalEgresos += m.monto
      if (m.metodoPago === "EFECTIVO") totalEgresosEfectivo += m.monto
    } else {
      totalIngresos += m.monto
      if (m.metodoPago === "EFECTIVO") totalIngresosEfectivo += m.monto
    }
  }

  const totalDia = totalIngresos - totalEgresos

  return {
    totalDia,
    porMetodo,
    porTipo,
    totalIngresos,
    totalEgresos,
    totalIngresosEfectivo,
    totalEgresosEfectivo,
  }
}
