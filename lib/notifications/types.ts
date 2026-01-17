export type NotificationType =
  | "CAMBIO_ESTADO"
  | "PRESUPUESTO_DEFINIDO"
  | "GARANTIA_CREADA"
  | "RECORDATORIO_RETIRO"

export type NotificationChannel = "EMAIL" | "WHATSAPP"

export type EstadoOrden =
  | "RECIBIDO"
  | "EN_DIAGNOSTICO"
  | "PRESUPUESTADO"
  | "APROBADO"
  | "EN_REPARACION"
  | "ESPERANDO_REPUESTO"
  | "REPARADO"
  | "ENTREGADO"
  | "CANCELADO"
  | "SIN_REPARACION"

export type EstadoVenta = "COMPLETADA" | "ANULADA"
export type MetodoPagoVenta = "EFECTIVO" | "TRANSFERENCIA" | "TARJETA"

export interface NotificationContext {
  organizationId: string
  organizationName: string
  cliente: {
    id: string
    nombre: string
    email?: string | null
    telefono: string
  }
  orden?: {
    id: string
    numeroOrden: number
    dispositivo: string
    estado: EstadoOrden
    estadoAnterior?: EstadoOrden
    presupuesto?: number | null
    fechaCompletado?: Date | null
  }
  venta?: {
    id: string
    numeroVenta: number
    total: number
    metodoPago: MetodoPagoVenta
    estado: EstadoVenta
    items: Array<{
      descripcion: string
      cantidad: number
      diasGarantia: number
    }>
    garantias: Array<{
      numeroGarantia: string
      diasValidez: number
      fechaVencimiento: Date
    }>
  }
  garantia?: {
    id: string
    diasValidez: number
    fechaVencimiento: Date
  }
}

export interface NotificationResult {
  success: boolean
  channel: NotificationChannel
  messageId?: string
  error?: string
  whatsappUrl?: string
}

export interface NotificationConfig {
  emailEnabled: boolean
  whatsappEnabled: boolean
  diasRecordatorio: number
}
