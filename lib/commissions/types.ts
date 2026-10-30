export type CommissionDocType = "VENTA" | "ORDEN"
export type CommissionRole = "VENDEDOR" | "TECNICO" | "RECEPCION"
export type CommissionKind = "ORIGINAL" | "AJUSTE_DEVOLUCION" | "AJUSTE_ANULACION" | "AJUSTE_MANUAL"

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
