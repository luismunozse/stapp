import { supabaseAdmin } from "@/lib/supabase"

/**
 * Historial de pagos del remito de una orden.
 *
 * La plata de una orden puede estar en dos libros: cobros_orden (el cobro de
 * la orden y, desde la migración 417, el pago registrado desde el remito) y
 * pagos_parciales (pagos viejos hechos desde el remito, más la copia de la
 * seña). Lo pagado del remito sale de total_cobrado_orden (345), que es el
 * MAYOR de los dos libros, porque en parte registran la misma plata (la seña
 * espejada, órdenes cargadas dos veces). Mostrar los dos libros duplicaría
 * esos pagos; el historial muestra el mismo libro que eligió esa regla, así
 * la suma de la lista coincide con lo pagado.
 */
export interface PagoRemito {
  id: string
  monto: number
  metodoPago: string
  referencia: string | null
  fecha: string
  notas: string | null
  cuotas: number | null
  recargoPorcentaje: number | null
  montoOriginal: number | null
}

const num = (v: unknown): number | null =>
  v === null || v === undefined || v === "" ? null : Number(v)

export function pagoParcialARemito(p: any): PagoRemito {
  return {
    id: p.id,
    monto: Number(p.monto),
    metodoPago: p.metodo_pago,
    referencia: p.numero_referencia ?? null,
    fecha: p.fecha,
    notas: p.observaciones ?? null,
    cuotas: p.cuotas ?? null,
    recargoPorcentaje: num(p.recargo_porcentaje),
    montoOriginal: num(p.monto_original),
  }
}

export function cobroOrdenARemito(c: any): PagoRemito {
  return {
    id: c.id,
    monto: Number(c.monto),
    metodoPago: c.metodo_pago,
    referencia: c.numero_referencia ?? null,
    fecha: c.created_at,
    notas: c.observaciones ?? null,
    cuotas: c.cuotas ?? null,
    recargoPorcentaje: num(c.recargo_porcentaje),
    montoOriginal: num(c.monto_original),
  }
}

/** Elige el libro que manda (el de mayor suma; empate → cobros de la orden). */
export function pagosDeRemitoOrden(pagosParciales: any[] | null | undefined, cobrosOrden: any[] | null | undefined): PagoRemito[] {
  const parciales = (pagosParciales || []).map(pagoParcialARemito)
  const cobros = (cobrosOrden || []).filter((c) => !c.anulado).map(cobroOrdenARemito)
  const suma = (xs: PagoRemito[]) => xs.reduce((s, p) => s + p.monto, 0)
  return suma(cobros) >= suma(parciales) && cobros.length > 0 ? cobros : parciales
}

export const porFechaDesc = (a: PagoRemito, b: PagoRemito) =>
  new Date(b.fecha).getTime() - new Date(a.fecha).getTime()

/** Cobros no anulados de varias órdenes, agrupados por orden (una sola consulta). */
export async function cobrosDeOrdenes(ordenIds: string[]): Promise<Map<string, any[]>> {
  const porOrden = new Map<string, any[]>()
  const ids = Array.from(new Set(ordenIds.filter(Boolean)))
  if (ids.length === 0) return porOrden
  const { data, error } = await supabaseAdmin
    .from("cobros_orden")
    .select("id, orden_id, monto, metodo_pago, numero_referencia, observaciones, cuotas, recargo_porcentaje, monto_original, created_at, anulado")
    .in("orden_id", ids)
    .eq("anulado", false)
  // Sin los cobros el historial cae a los pagos del remito, como antes.
  if (error || !data) return porOrden
  for (const c of data as any[]) {
    const lista = porOrden.get(c.orden_id) ?? []
    lista.push(c)
    porOrden.set(c.orden_id, lista)
  }
  return porOrden
}
