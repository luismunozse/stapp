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
  costoFinancieroMonto?: number | null
  costoFinancieroPorcentaje?: number | null
}

interface FetchMovimientosOptions {
  metodoPago?: string
  tipo?: string
}

/**
 * Identifica el egreso automático de COGS que `crear_venta_atomica` inserta en
 * `movimientos_caja` por cada venta (concepto "Costo de mercadería - Venta #N",
 * EGRESO/EFECTIVO, afecta_rentabilidad=false).
 *
 * Ese registro es contable (lo consume rentabilidad vía snapshots, no esta tabla)
 * y NO representa efectivo que salió del cajón. Debe excluirse del arqueo de caja
 * para no generar un "sobrante" fantasma igual al COGS del día.
 *
 * La firma es específica a propósito: un "Retiro de socio" también tiene
 * afecta_rentabilidad=false pero SÍ es efectivo real, por lo que no debe matchear.
 */
export function esMovimientoCogsAutomatico(row: {
  tipo?: string | null
  afecta_rentabilidad?: boolean | null
  concepto?: string | null
}): boolean {
  return (
    row.tipo === "EGRESO" &&
    row.afecta_rentabilidad === false &&
    typeof row.concepto === "string" &&
    /^costo de mercader/i.test(row.concepto.trim())
  )
}

/**
 * Obtiene todos los movimientos de caja de un día, unificando las 5 fuentes:
 * cobros_orden, pagos_parciales, pagos_venta, cuenta_corriente, movimientos_caja
 */
export async function fetchMovimientosDia(
  organizationId: string,
  fechaDesde: string,
  fechaHasta: string,
  filters?: FetchMovimientosOptions,
  sucursalId?: string | null,
) {
  // 1. Cobros de órdenes
  let cobrosQuery = supabaseAdmin
    .from("cobros_orden")
    .select("monto, metodo_pago, created_at, orden_id, observaciones, ordenes_servicio:orden_id!inner(numero_orden, sucursal_id)")
    .eq("organization_id", organizationId)
    .gte("created_at", fechaDesde)
    .lte("created_at", fechaHasta)
    .order("created_at", { ascending: false })
  if (sucursalId) {
    cobrosQuery = cobrosQuery.eq("ordenes_servicio.sucursal_id", sucursalId)
  }
  const { data: cobrosOrdenes } = await cobrosQuery

  // 2. Pagos de facturas
  let pagosFacturasQuery = supabaseAdmin
    .from("pagos_parciales")
    .select(`
      monto, metodo_pago, fecha, factura_id, observaciones,
      costo_financiero_porcentaje, costo_financiero_monto,
      facturas!inner(
        id, numero_factura,
        ordenes_servicio!inner(organization_id, numero_orden, sucursal_id)
      )
    `)
    .eq("facturas.ordenes_servicio.organization_id", organizationId)
    .gte("fecha", fechaDesde)
    .lte("fecha", fechaHasta)
    .order("fecha", { ascending: false })
  if (sucursalId) {
    pagosFacturasQuery = pagosFacturasQuery.eq("facturas.ordenes_servicio.sucursal_id", sucursalId)
  }
  const { data: pagosFacturas } = await pagosFacturasQuery

  // 3. Pagos de ventas
  let pagosVentasQuery = supabaseAdmin
    .from("pagos_venta")
    .select(`
      monto, metodo_pago, fecha, venta_id, observaciones,
      costo_financiero_porcentaje, costo_financiero_monto,
      ventas!inner(organization_id, numero_venta, sucursal_id)
    `)
    .eq("ventas.organization_id", organizationId)
    .gte("fecha", fechaDesde)
    .lte("fecha", fechaHasta)
    .order("fecha", { ascending: false })
  if (sucursalId) {
    pagosVentasQuery = pagosVentasQuery.eq("ventas.sucursal_id", sucursalId)
  }
  const { data: pagosVentas } = await pagosVentasQuery

  // 4. Depósitos cuenta corriente
  // cuenta_corriente.sucursal_id (mig 238) permite el arqueo por sucursal: cada
  // depósito queda atribuido a la sucursal donde se registró. Sin sucursalId se
  // incluyen todos los depósitos de la org, como antes.
  let depositosQuery = supabaseAdmin
    .from("cuenta_corriente")
    .select("monto, metodo_pago, created_at, observaciones, cliente_id")
    .eq("organization_id", organizationId)
    .eq("tipo", "DEPOSITO")
    .gte("created_at", fechaDesde)
    .lte("created_at", fechaHasta)
    .order("created_at", { ascending: false })
  if (sucursalId) {
    depositosQuery = depositosQuery.eq("sucursal_id", sucursalId)
  }
  const { data: depositosData } = await depositosQuery

  // 5. Movimientos manuales de caja
  let movimientosQuery = supabaseAdmin
    .from("movimientos_caja")
    .select("id, tipo, monto, metodo_pago, concepto, observaciones, fecha, afecta_rentabilidad")
    .eq("organization_id", organizationId)
    .gte("fecha", fechaDesde)
    .lte("fecha", fechaHasta)
    .order("fecha", { ascending: false })
  if (sucursalId) {
    movimientosQuery = movimientosQuery.eq("sucursal_id", sucursalId)
  }
  const { data: movimientosManuales } = await movimientosQuery

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
      costoFinancieroMonto: p.costo_financiero_monto ? parseFloat(p.costo_financiero_monto) : null,
      costoFinancieroPorcentaje: p.costo_financiero_porcentaje ? parseFloat(p.costo_financiero_porcentaje) : null,
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
      costoFinancieroMonto: p.costo_financiero_monto ? parseFloat(p.costo_financiero_monto) : null,
      costoFinancieroPorcentaje: p.costo_financiero_porcentaje ? parseFloat(p.costo_financiero_porcentaje) : null,
    })
  }

  for (const d of depositosData || []) {
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
    // El egreso automático de COGS no es efectivo real: se excluye del arqueo.
    if (esMovimientoCogsAutomatico(m)) continue
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
export interface TipoDetalle {
  count: number
  total: number
  items: Array<{ referenciaId: string; referenciaNumero?: string | null; monto: number }>
}

export function computeTotales(movimientos: MovimientoUnificado[]) {
  const porMetodo: Record<string, number> = {}
  const porTipo: Record<string, TipoDetalle> = {}
  let totalIngresos = 0
  let totalEgresos = 0
  let totalIngresosEfectivo = 0
  let totalEgresosEfectivo = 0
  let totalCostosFinancieros = 0

  for (const m of movimientos) {
    const montoConSigno = m.esEgreso ? -m.monto : m.monto
    porMetodo[m.metodoPago] = (porMetodo[m.metodoPago] || 0) + montoConSigno

    if (!porTipo[m.tipo]) porTipo[m.tipo] = { count: 0, total: 0, items: [] }
    porTipo[m.tipo].count++
    porTipo[m.tipo].total += m.monto
    porTipo[m.tipo].items.push({
      referenciaId: m.referenciaId,
      referenciaNumero: m.referenciaNumero,
      monto: m.monto,
    })

    if (m.esEgreso) {
      totalEgresos += m.monto
      if (m.metodoPago === "EFECTIVO") totalEgresosEfectivo += m.monto
    } else {
      totalIngresos += m.monto
      if (m.metodoPago === "EFECTIVO") totalIngresosEfectivo += m.monto
    }

    // Acumular costos financieros
    if (m.costoFinancieroMonto && m.costoFinancieroMonto > 0) {
      totalCostosFinancieros += m.costoFinancieroMonto
    }
  }

  const totalDia = totalIngresos - totalEgresos
  const ingresoReal = totalDia - totalCostosFinancieros

  return {
    totalDia,
    porMetodo,
    porTipo,
    totalIngresos,
    totalEgresos,
    totalIngresosEfectivo,
    totalEgresosEfectivo,
    totalCostosFinancieros,
    ingresoReal,
  }
}
