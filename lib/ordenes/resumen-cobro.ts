/**
 * Cómo está el cobro de una orden, en una etiqueta corta para la lista:
 * "Debe $X", "Pagado", "Seña $X" o "Sin cargo". Usa el mismo pendiente que la
 * ficha (`pendienteOrden`, espejo de la función de la base).
 */
import { pendienteOrden } from "@/lib/ordenes/pendiente"

export type TonoCobro = "warning" | "success" | "info" | "neutral"

export interface ResumenCobro {
  tono: TonoCobro
  /** "debe" lleva el monto pendiente; "sena", el monto de la seña. */
  tipo: "debe" | "pagado" | "sena" | "sin_cargo"
  monto?: number
}

interface OrdenCobro {
  estado: string
  costoFinal?: number | null
  sena?: number | null
  totalCobrado?: number | null
  descuentoCobro?: number | null
  aplicadoNotasCredito?: number | null
}

/** Estados en los que no hay nada que cobrar ni que mostrar. */
const SIN_COBRO = new Set(["CANCELADO", "SIN_REPARACION", "ENTREGADO_SIN_REPARACION"])

export function resumenCobroOrden(o: OrdenCobro): ResumenCobro | null {
  if (o.estado === "ENTREGADO_SIN_COBRO") return { tono: "neutral", tipo: "sin_cargo" }
  if (SIN_COBRO.has(o.estado)) return null

  const costoFinal = Number(o.costoFinal ?? 0)
  if (costoFinal > 0) {
    const pendiente = Math.round(
      pendienteOrden({
        costoFinal,
        descuentoCobro: Number(o.descuentoCobro ?? 0),
        totalCobrado: Number(o.totalCobrado ?? 0),
        aplicadoNotasCredito: Number(o.aplicadoNotasCredito ?? 0),
      }) * 100,
    ) / 100
    return pendiente > 0 ? { tono: "warning", tipo: "debe", monto: pendiente } : { tono: "success", tipo: "pagado" }
  }

  const sena = Number(o.sena ?? 0)
  if (sena > 0) return { tono: "info", tipo: "sena", monto: sena }
  return null
}
