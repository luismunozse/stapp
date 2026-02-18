export type Rol = "ADMIN" | "TECNICO" | "VENDEDOR"
export type TipoDispositivo = "CELULAR" | "COMPUTADORA" | "TABLET" | "CONSOLA" | "SMARTWATCH" | "ACCESORIOS" | "TODOS"

export interface TipoDispositivoCustom {
  id: string
  codigo: string
  nombre: string
  prefijoOrden: string
  icono?: string | null
  activo: boolean
  esBase: boolean
  orden: number
}
export type EstadoOrden =
  | "RECIBIDO"           // Equipo recién ingresado
  | "EN_DIAGNOSTICO"     // Técnico evaluando el problema
  | "PRESUPUESTADO"      // Esperando respuesta del cliente
  | "APROBADO"           // Cliente aprobó el presupuesto
  | "EN_REPARACION"      // Técnico trabajando
  | "ESPERANDO_REPUESTO" // Pausado por falta de repuesto
  | "REPARADO"           // Reparación completada
  | "ENTREGADO"          // Cliente retiró el equipo
  | "CANCELADO"          // Orden cancelada
  | "SIN_REPARACION"     // No se puede reparar o rechazado
export type EstadoPago = "PENDIENTE" | "PAGADO_PARCIAL" | "PAGADO" | "ANULADA"

export interface User {
  id: string
  email: string
  nombre: string
  rol: Rol
}

export interface Cliente {
  id: string
  nombre: string
  telefono: string
  email?: string | null
  direccion?: string | null
  dni?: string | null
  createdAt: Date
  updatedAt: Date
}

export interface OrdenServicio {
  id: string
  numeroOrden: number
  codigoOrden?: string
  clienteId: string
  tecnicoId?: string | null
  dispositivo: string
  tipoDispositivo: TipoDispositivo
  tipoDispositivoId?: string | null
  tipoDispositivoCustom?: TipoDispositivoCustom | null
  marca?: string | null
  color?: string | null
  imei?: string | null
  accesorios?: string | null
  codigoAccesoDispositivo?: string | null
  problemaReportado: string
  estado: EstadoOrden
  presupuesto?: number | null
  costoFinal?: number | null
  sena?: number
  fechaIngreso: Date
  fechaPrometida?: Date | null
  fechaCompletado?: Date | null
  observaciones?: string | null
  diagnostico?: string | null
  cliente?: Cliente
  tecnico?: User | null
  // Campos de recepcion (firma)
  firmaClienteRecepcion?: string | null
  firmaClienteRecepcionMime?: string | null
  // Campos de entrega
  fechaEntrega?: Date | null
  firmaClienteEntrega?: string | null
  firmaClienteEntregaMime?: string | null
  firmaEncargadoEntrega?: string | null
  firmaEncargadoEntregaMime?: string | null
  entregadoPorUserId?: string | null
  entregadoPor?: User | null
  notasEntrega?: string | null
}

export interface Inventario {
  id: string
  codigo: string
  nombre: string
  descripcion?: string | null
  categoria: string
  tipoDispositivo: TipoDispositivo
  tipoDispositivoId?: string | null
  tipoDispositivoCustom?: TipoDispositivoCustom | null
  stock: number
  precioCompra: number
  precioVenta: number
  proveedor?: string | null
}

export interface Factura {
  id: string
  ordenId: string
  numeroFactura: string
  fecha: Date
  subtotal: number
  iva: number
  total: number
  estadoPago: EstadoPago
}

export type EntityImportType = "CLIENTES" | "INVENTARIO"

export interface Importacion {
  id: string
  organizationId: string
  userId: string
  entityType: EntityImportType
  filename: string
  filePath: string
  fileSize: number
  totalRows: number
  successCount: number
  skippedCount: number
  errorCount: number
  errorsDetail: Array<{
    row: number
    error?: string
    reason?: string
    data: any
  }>
  createdAt: Date
  user?: User
}

// ========================================
// VENTAS
// ========================================

export type MetodoPagoVenta = "EFECTIVO" | "TRANSFERENCIA" | "TARJETA" | "TARJETA_DEBITO" | "TARJETA_CREDITO" | "MERCADOPAGO" | "OTRO"
export type EstadoVenta = "COMPLETADA" | "ANULADA"
export type EstadoGarantiaVenta = "ACTIVA" | "VENCIDA" | "RECLAMADA"

export interface ItemVentaInput {
  inventarioId?: string | null
  descripcion: string
  cantidad: number
  precioUnitario: number
  diasGarantia: number
}

export interface Venta {
  id: string
  numeroVenta: number
  clienteId?: string | null
  clienteNombre: string
  clienteTelefono?: string | null
  vendedor: User
  items: ItemVentaConDetalles[]
  subtotal: number
  descuento: number
  total: number
  metodoPago: MetodoPagoVenta
  estado: EstadoVenta
  observaciones?: string | null
  garantias: GarantiaVentaCompleta[]
  createdAt: Date
}

export interface ItemVentaConDetalles {
  id: string
  inventario?: Inventario | null
  descripcion: string
  cantidad: number
  precioUnitario: number
  subtotal: number
  diasGarantia: number
}

export interface GarantiaVentaCompleta {
  id: string
  numeroGarantia: string
  item: ItemVentaConDetalles
  diasValidez: number
  fechaInicio: Date
  fechaVencimiento: Date
  estado: EstadoGarantiaVenta
}

// ========================================
// SOPORTE
// ========================================

export type TipoTicket = "BUG" | "SUGERENCIA" | "PREGUNTA"
export type PrioridadTicket = "BAJA" | "MEDIA" | "ALTA"
export type EstadoTicket = "ABIERTO" | "EN_PROCESO" | "RESUELTO" | "CERRADO"

export interface SupportTicket {
  id: string
  organizationId: string
  userId: string
  tipo: TipoTicket
  prioridad: PrioridadTicket
  asunto: string
  descripcion: string
  estado: EstadoTicket
  createdAt: string
  updatedAt: string
  usuario?: { nombre: string; email: string }
  organizacion?: { nombre: string; slug: string }
  mensajes?: SupportTicketMessage[]
  adjuntos?: SupportTicketAttachment[]
  totalMensajes?: number
}

export interface SupportTicketMessage {
  id: string
  ticketId: string
  autorTipo: "USUARIO" | "SUPERADMIN"
  autorId: string
  autorNombre: string
  contenido: string
  createdAt: string
  adjuntos?: SupportTicketAttachment[]
}

export interface SupportTicketAttachment {
  id: string
  ticketId: string
  messageId?: string | null
  url: string
  nombreArchivo?: string | null
  createdAt: string
}

