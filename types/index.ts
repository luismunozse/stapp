export type Rol = "ADMIN" | "TECNICO" | "VENDEDOR"
export type TipoDispositivo = "CELULAR" | "COMPUTADORA" | "TABLET" | "CONSOLA" | "SMARTWATCH" | "TODOS"
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
  clienteId: string
  tecnicoId?: string | null
  dispositivo: string
  tipoDispositivo: TipoDispositivo
  marca?: string | null
  color?: string | null
  imei?: string | null
  accesorios?: string | null
  passwordDispositivo?: string | null
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
}

export interface Inventario {
  id: string
  codigo: string
  nombre: string
  descripcion?: string | null
  categoria: string
  tipoDispositivo: TipoDispositivo
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

