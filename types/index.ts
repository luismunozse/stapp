import { Rol, TipoDispositivo, EstadoOrden, EstadoPago } from "@prisma/client"

export type { Rol, TipoDispositivo, EstadoOrden, EstadoPago }

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
  problemaReportado: string
  estado: EstadoOrden
  presupuesto?: number | null
  costoFinal?: number | null
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

