export type NotificationType =
  | "CAMBIO_ESTADO"
  | "PRESUPUESTO_DEFINIDO"
  | "GARANTIA_CREADA"
  | "RECORDATORIO_RETIRO"
  // Pre-venta y captación
  | "BIENVENIDA_CLIENTE"
  | "RESPUESTA_CONSULTA"
  // Cobranza y pagos
  | "RECORDATORIO_PAGO"
  | "CONFIRMACION_PAGO"
  | "LINK_PAGO"
  // Retención y fidelización
  | "MANTENIMIENTO_PREVENTIVO"
  | "PROMOCION"
  | "ENCUESTA_SATISFACCION"
  | "FELICITACION"
  // Operativo avanzado
  | "SOLICITUD_INFO"
  | "REPUESTO_DISPONIBLE"
  | "REPUESTO_NO_DISPONIBLE"
  | "AVISO_DEMORA"
  | "REINGRESO_GARANTIA"
  // Recuperación
  | "CLIENTE_INACTIVO"
  | "SEGUIMIENTO_PRESUPUESTO_RECHAZADO"

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
  | "ENTREGADO_SIN_REPARACION"
  | "ENTREGADO_SIN_COBRO"
  | "CANCELADO"
  | "SIN_REPARACION"

export type EstadoVenta = "COMPLETADA" | "ANULADA"
export type MetodoPagoVenta = "EFECTIVO" | "TRANSFERENCIA" | "TARJETA" | "TARJETA_DEBITO" | "TARJETA_CREDITO" | "MERCADOPAGO" | "CUENTA_CORRIENTE" | "OTRO"

export interface NotificationContext {
  organizationId: string
  organizationName: string
  organizationSlug?: string
  moneda?: string
  zonaHoraria?: string
  cliente: {
    id: string
    nombre: string
    email?: string | null
    telefono: string
    telefonoContacto?: string | null
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
      id: string
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
  // Contexto extendido para nuevas plantillas
  pago?: {
    monto: number
    metodoPago?: MetodoPagoVenta
    fechaPago?: Date
    saldoPendiente?: number
    linkPago?: string
  }
  mantenimiento?: {
    ultimoServicio?: Date
    tipoServicio?: string
  }
  promocion?: {
    titulo: string
    descripcion: string
    descuento?: string
    validoHasta?: Date
  }
  demora?: {
    motivo: string
    nuevaFechaEstimada?: Date
  }
  repuesto?: {
    nombre: string
    disponible: boolean
  }
  encuestaUrl?: string
  solicitudInfo?: string
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
