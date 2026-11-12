/**
 * Estado de cobro y saldo de una orden para la lista de órdenes.
 *
 * El saldo sale de `pendienteOrden()` (el mismo cálculo que el encabezado del
 * detalle de la orden): costo final − descuento de cobro − lo cobrado − lo que
 * bajaron las notas de crédito activas. Se calcula en el servidor con la fila
 * que ya trae la query de la lista (embed de NC incluido): sin un SELECT por
 * orden.
 */
import type { EstadoPagoNormalizado } from "@/lib/estado-pago-ui"
import { aplicadoNotasCreditoDeOrden, pendienteOrden } from "@/lib/ordenes/pendiente"

/** Estados en los que no se le cobra nada al cliente (el detalle tampoco muestra saldo). */
const ESTADOS_SIN_CARGO = new Set(["CANCELADO", "SIN_REPARACION", "ENTREGADO_SIN_COBRO"])

/** Estados cerrados: si llegaron sin precio y sin cobros, no hay nada que cobrar. */
const ESTADOS_CERRADOS = new Set(["ENTREGADO", "ENTREGADO_SIN_REPARACION", "SIN_FALLA_DETECTADA"])

export interface MontosCobroOrden {
  estado: string
  costoFinal: number | null
  descuentoCobro: number
  totalCobrado: number
  aplicadoNotasCredito: number
}

export interface ResumenCobroOrden {
  /** `null`: orden en curso sin precio final ni plata a cuenta (no hay nada que mostrar). */
  estadoPago: EstadoPagoNormalizado | null
  /** Lo que falta cobrar, redondeado a centavos y nunca negativo. */
  saldoPendiente: number
}

const redondear = (n: number) => Math.round(n * 100) / 100

export function resumenCobroOrden(m: MontosCobroOrden): ResumenCobroOrden {
  if (ESTADOS_SIN_CARGO.has(m.estado)) return { estadoPago: "SIN_CARGO", saldoPendiente: 0 }

  const cubierto = redondear(m.totalCobrado + m.aplicadoNotasCredito)

  if (m.costoFinal == null) {
    if (cubierto > 0) return { estadoPago: "SENA", saldoPendiente: 0 }
    return { estadoPago: ESTADOS_CERRADOS.has(m.estado) ? "SIN_CARGO" : null, saldoPendiente: 0 }
  }

  if (redondear(m.costoFinal - m.descuentoCobro) <= 0) {
    return { estadoPago: cubierto > 0 ? "PAGADO" : "SIN_CARGO", saldoPendiente: 0 }
  }

  const saldo = redondear(
    pendienteOrden({
      costoFinal: m.costoFinal,
      descuentoCobro: m.descuentoCobro,
      totalCobrado: m.totalCobrado,
      aplicadoNotasCredito: m.aplicadoNotasCredito,
    })
  )
  if (saldo <= 0) return { estadoPago: "PAGADO", saldoPendiente: 0 }
  return { estadoPago: cubierto > 0 ? "PARCIAL" : "SIN_COBRAR", saldoPendiente: saldo }
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""))
  return Number.isFinite(n) ? n : 0
}

/**
 * Lo mismo, desde una fila cruda de `ordenes_servicio` leída con
 * `NOTAS_CREDITO_APLICADO_EMBED`.
 */
export function resumenCobroDeFila(fila: {
  estado?: string | null
  costo_final?: string | number | null
  descuento_cobro?: string | number | null
  total_cobrado?: string | number | null
  notas_credito?: ReadonlyArray<{ monto_aplicado_deuda: string | number | null; anulada: boolean | null }> | null
}): ResumenCobroOrden {
  return resumenCobroOrden({
    estado: fila.estado ?? "",
    costoFinal: fila.costo_final == null || fila.costo_final === "" ? null : num(fila.costo_final),
    descuentoCobro: num(fila.descuento_cobro),
    totalCobrado: num(fila.total_cobrado),
    aplicadoNotasCredito: aplicadoNotasCreditoDeOrden(fila),
  })
}
