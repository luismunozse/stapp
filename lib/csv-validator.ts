import { z } from 'zod'
import type { ParsedRow } from './csv-parser'

// Cliente validation schema (matches existing API schema)
const clienteRowSchema = z.object({
  nombre: z.string().min(1, 'El nombre es requerido'),
  telefono: z.string()
    .min(1, 'El teléfono es requerido')
    .regex(/^\d{10}$/, 'El teléfono debe tener exactamente 10 dígitos'),
  email: z.string().email('Email inválido').optional().or(z.literal('')).or(z.null()),
  direccion: z.string().optional().or(z.null()).or(z.literal('')),
  dni: z.string().optional().or(z.null()).or(z.literal('')),
})

// Inventario validation schema (matches existing API schema)
// Note: CSV values come as strings, so we need to transform them
const inventarioRowSchema = z.object({
  codigo: z.string().min(1, 'El código es requerido'),
  nombre: z.string().min(1, 'El nombre es requerido'),
  descripcion: z.string().optional().or(z.null()).or(z.literal('')),
  categoria: z.string().min(1, 'La categoría es requerida'),
  tipoDispositivo: z.enum(['CELULAR', 'COMPUTADORA', 'TABLET', 'CONSOLA', 'SMARTWATCH', 'TODOS'], {
    errorMap: () => ({ message: 'Tipo de dispositivo inválido. Debe ser: CELULAR, COMPUTADORA, TABLET, CONSOLA, SMARTWATCH o TODOS' })
  }),
  stock: z.union([
    z.number().int().min(0, 'El stock debe ser mayor o igual a 0'),
    z.string().transform((val) => {
      const num = parseInt(val, 10)
      if (isNaN(num) || num < 0) throw new Error('Stock inválido. Debe ser un número entero mayor o igual a 0')
      return num
    })
  ]),
  precioCompra: z.union([
    z.number().min(0, 'El precio de compra debe ser mayor o igual a 0'),
    z.string().transform((val) => {
      const num = parseFloat(val)
      if (isNaN(num) || num < 0) throw new Error('Precio de compra inválido. Debe ser un número mayor o igual a 0')
      return num
    })
  ]),
  precioVenta: z.union([
    z.number().min(0, 'El precio de venta debe ser mayor o igual a 0'),
    z.string().transform((val) => {
      const num = parseFloat(val)
      if (isNaN(num) || num < 0) throw new Error('Precio de venta inválido. Debe ser un número mayor o igual a 0')
      return num
    })
  ]),
  proveedor: z.string().optional().or(z.null()).or(z.literal('')),
})

export interface ValidationResult {
  valid: boolean
  data?: any
  error?: string
}

export function validateClienteRow(row: ParsedRow, rowIndex: number): ValidationResult {
  try {
    const data = clienteRowSchema.parse(row)
    return { valid: true, data }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        valid: false,
        error: `Fila ${rowIndex + 2}: ${error.errors[0].message}`,
      }
    }
    return {
      valid: false,
      error: `Fila ${rowIndex + 2}: Error de validación`,
    }
  }
}

export function validateInventarioRow(row: ParsedRow, rowIndex: number): ValidationResult {
  try {
    const data = inventarioRowSchema.parse(row)
    return { valid: true, data }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        valid: false,
        error: `Fila ${rowIndex + 2}: ${error.errors[0].message}`,
      }
    }
    return {
      valid: false,
      error: `Fila ${rowIndex + 2}: Error de validación`,
    }
  }
}

export function validateCSVHeaders(
  headers: string[],
  entityType: 'CLIENTES' | 'INVENTARIO'
): { valid: boolean; error?: string } {
  const requiredHeaders = entityType === 'CLIENTES'
    ? ['nombre', 'telefono']
    : ['codigo', 'nombre', 'categoria', 'tipoDispositivo', 'stock', 'precioCompra', 'precioVenta']

  const missingHeaders = requiredHeaders.filter(h => !headers.includes(h))

  if (missingHeaders.length > 0) {
    return {
      valid: false,
      error: `Faltan columnas requeridas: ${missingHeaders.join(', ')}`,
    }
  }

  return { valid: true }
}
