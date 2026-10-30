export type CommissionDocType = "VENTA" | "ORDEN"
export type CommissionRole = "VENDEDOR" | "TECNICO" | "RECEPCION"
export type CommissionKind = "ORIGINAL" | "AJUSTE_DEVOLUCION" | "AJUSTE_ANULACION" | "AJUSTE_MANUAL"

export type CommissionBaseKind = "MANO_DE_OBRA" | "MONTO_ORDEN"
export type OrderAccrualBlock =
  | "ESPERA_ENTREGA_Y_COBRO"
  | "ESPERA_ENTREGA"
  | "ESPERA_COBRO"
  | "SIN_REPARACION"
  | "NO_COMISIONA"

export interface CommissionRow {
  clave: string
  sucursalId: string | null
  documentoTipo: CommissionDocType | null
  documentoId: string | null
  beneficiarioId: string
  rol: CommissionRole
  tipo: CommissionKind
  ajusteRef: string | null
  base: number | null
  porcentaje: number | null
  monto: number
  fechaDevengo: string | null
  devengada: boolean
  pagoId: string | null
  fechaPago: string | null
  pagado: boolean
  pendiente: number
  documentoCodigo: string | null
  documentoNumero: number | null
  documentoDetalle: string | null
  documentoEstado: string | null
  documentoTotal: number | null
  documentoCostoRepuestos: number | null
  baseTipo: CommissionBaseKind | null
  documentoMonto: number | null
  motivoSinDevengo: OrderAccrualBlock | null
}

export interface PayRowInput {
  clave: string
  monto: number
}

export const COMMISSION_KIND_LABEL: Record<CommissionKind, string | null> = {
  ORIGINAL: null,
  AJUSTE_DEVOLUCION: "Devolución",
  AJUSTE_ANULACION: "Venta anulada",
  AJUSTE_MANUAL: "Ajuste",
}

export const COMMISSION_ROLE_LABEL: Record<CommissionRole, string> = {
  VENDEDOR: "Venta",
  TECNICO: "Técnico",
  RECEPCION: "Recepción",
}

/** An order has no "return": its negative adjustment comes from a credit note. */
export function commissionKindLabel(tipo: CommissionKind, documentoTipo: CommissionDocType | null): string | null {
  if (documentoTipo === "ORDEN" && tipo === "AJUSTE_DEVOLUCION") return "Nota de crédito"
  return COMMISSION_KIND_LABEL[tipo]
}

export const ORDER_ACCRUAL_HINT: Record<OrderAccrualBlock, string> = {
  ESPERA_ENTREGA_Y_COBRO: "Se genera cuando la orden se entrega y queda cobrada por completo.",
  ESPERA_ENTREGA: "Se genera cuando la orden se entrega.",
  ESPERA_COBRO: "Se genera cuando la orden queda cobrada por completo.",
  SIN_REPARACION: "No genera comisión: la orden se entregó sin reparar y el taller no paga comisión en ese caso.",
  NO_COMISIONA: "Esta orden no genera comisión (práctica, cancelada, entregada sin cobro o reingreso por garantía).",
}
