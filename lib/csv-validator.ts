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
const optionalNonNegNumber = (label: string) =>
  z.preprocess((val) => {
    if (val === null || val === undefined || val === '') return undefined
    if (typeof val === 'number') return val
    if (typeof val === 'string') {
      const cleaned = val.replace(/[^\d.,-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')
      const num = parseFloat(cleaned)
      if (isNaN(num)) throw new Error(`${label} inválido. Debe ser un número.`)
      return num
    }
    return val
  }, z.number().min(0, `${label} debe ser mayor o igual a 0`).optional())

const inventarioRowSchema = z.object({
  codigo: z.string().optional().or(z.null()).or(z.literal('')),
  nombre: z.string().min(1, 'El nombre es requerido'),
  descripcion: z.string().optional().or(z.null()).or(z.literal('')),
  categoria: z.string().optional().or(z.null()).or(z.literal('')),
  tipoDispositivo: z.string().optional().or(z.null()).or(z.literal('')),
  stock: z.preprocess((val) => {
    if (val === null || val === undefined || val === '') return 0
    if (typeof val === 'number') return val
    if (typeof val === 'string') {
      const num = parseInt(val.replace(/[^\d-]/g, ''), 10)
      if (isNaN(num)) throw new Error('Stock inválido. Debe ser un número entero mayor o igual a 0')
      return num
    }
    return val
  }, z.number().int().min(0, 'El stock debe ser mayor o igual a 0')),
  precioCompra: optionalNonNegNumber('Precio de compra'),
  precioVenta: z.preprocess((val) => {
    if (val === null || val === undefined || val === '') {
      throw new Error('Precio de venta es requerido')
    }
    if (typeof val === 'number') return val
    if (typeof val === 'string') {
      const cleaned = val.replace(/[^\d.,-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')
      const num = parseFloat(cleaned)
      if (isNaN(num)) throw new Error('Precio de venta inválido. Debe ser un número mayor o igual a 0')
      return num
    }
    return val
  }, z.number().min(0, 'El precio de venta debe ser mayor o igual a 0')),
  proveedor: z.string().optional().or(z.null()).or(z.literal('')),
  marca: z.string().optional().or(z.null()).or(z.literal('')),
})

// Tipo dispositivo enum del schema. Importaciones libres usan 'TODOS' por default.
const TIPOS_DISPOSITIVO_VALIDOS = new Set(['CELULAR', 'COMPUTADORA', 'TABLET', 'CONSOLA', 'SMARTWATCH', 'TODOS'])

export function generateCodigo(_nombre?: string): string {
  // 7 chars alfanum. ~78B combinaciones, colisión despreciable por org.
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // sin 0/O/1/I para legibilidad
  let out = ''
  for (let i = 0; i < 7; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

export function resolveTipoDispositivo(raw: unknown): string {
  if (typeof raw !== 'string') return 'TODOS'
  const up = raw.trim().toUpperCase()
  if (!up) return 'TODOS'
  if (TIPOS_DISPOSITIVO_VALIDOS.has(up)) return up
  if (up.startsWith('CEL') || up.includes('PHONE')) return 'CELULAR'
  if (up.startsWith('COMP') || up.includes('NOTEBOOK') || up.includes('LAPTOP') || up.includes('PC')) return 'COMPUTADORA'
  if (up.startsWith('TAB')) return 'TABLET'
  if (up.startsWith('CONS')) return 'CONSOLA'
  if (up.startsWith('SMART') || up.includes('WATCH') || up.includes('RELOJ')) return 'SMARTWATCH'
  return 'TODOS'
}

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

// Aliases comunes -> nombre canonical. Lookup por header normalizado
// (lowercase, sin acentos, sin espacios/guiones/underscores).
const HEADER_ALIASES_INVENTARIO: Record<string, string> = {
  codigo: 'codigo', code: 'codigo', sku: 'codigo', cod: 'codigo', referencia: 'codigo', ref: 'codigo',
  nombre: 'nombre', name: 'nombre', producto: 'nombre', item: 'nombre', articulo: 'nombre', descripcioncorta: 'nombre',
  descripcion: 'descripcion', description: 'descripcion', desc: 'descripcion', detalle: 'descripcion', detalles: 'descripcion',
  categoria: 'categoria', category: 'categoria', rubro: 'categoria', familia: 'categoria',
  tipodispositivo: 'tipoDispositivo', tipo: 'tipoDispositivo', dispositivo: 'tipoDispositivo', tipoequipo: 'tipoDispositivo',
  stock: 'stock', cantidad: 'stock', qty: 'stock', existencia: 'stock', existencias: 'stock', unidades: 'stock', cant: 'stock',
  preciocompra: 'precioCompra', costo: 'precioCompra', cost: 'precioCompra', preciocosto: 'precioCompra', preciodecompra: 'precioCompra', pcompra: 'precioCompra', pc: 'precioCompra',
  precioventa: 'precioVenta', precio: 'precioVenta', price: 'precioVenta', pvp: 'precioVenta', preciodeventa: 'precioVenta', preciopublico: 'precioVenta', pventa: 'precioVenta', pv: 'precioVenta',
  proveedor: 'proveedor', provider: 'proveedor', supplier: 'proveedor', vendor: 'proveedor',
  marca: 'marca', brand: 'marca', fabricante: 'marca',
}

const HEADER_ALIASES_CLIENTES: Record<string, string> = {
  nombre: 'nombre', name: 'nombre', cliente: 'nombre', nombrecompleto: 'nombre', razonsocial: 'nombre',
  telefono: 'telefono', phone: 'telefono', celular: 'telefono', movil: 'telefono', tel: 'telefono', cel: 'telefono', whatsapp: 'telefono',
  email: 'email', correo: 'email', mail: 'email', correoelectronico: 'email',
  direccion: 'direccion', address: 'direccion', domicilio: 'direccion', calle: 'direccion',
  dni: 'dni', documento: 'dni', doc: 'dni', identificacion: 'dni', cuit: 'dni', cuil: 'dni', nrodocumento: 'dni',
}

function normalizeKey(key: string): string {
  return key
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\s_\-./]+/g, '')
    .trim()
}

export interface HeaderNormalization {
  canonicalHeaders: string[]
  mapping: Record<string, string>
  unmapped: string[]
}

export function normalizeHeaders(
  headers: string[],
  entityType: 'CLIENTES' | 'INVENTARIO'
): HeaderNormalization {
  const aliases = entityType === 'CLIENTES' ? HEADER_ALIASES_CLIENTES : HEADER_ALIASES_INVENTARIO
  const mapping: Record<string, string> = {}
  const unmapped: string[] = []
  const canonicalHeaders = headers.map(h => {
    const key = normalizeKey(h)
    const canonical = aliases[key]
    if (canonical) {
      mapping[h] = canonical
      return canonical
    }
    mapping[h] = h
    unmapped.push(h)
    return h
  })
  return { canonicalHeaders, mapping, unmapped }
}

export function normalizeRow(
  row: ParsedRow,
  mapping: Record<string, string>
): ParsedRow {
  const result: ParsedRow = {}
  for (const [origKey, value] of Object.entries(row)) {
    const canonical = mapping[origKey] ?? origKey
    // Primer non-null gana (evita pisar valor con celda vacía de columna duplicada).
    if (result[canonical] === undefined || result[canonical] === null || result[canonical] === '') {
      result[canonical] = value
    }
  }
  return result
}

export function validateCSVHeaders(
  headers: string[],
  entityType: 'CLIENTES' | 'INVENTARIO'
): { valid: boolean; error?: string } {
  const requiredHeaders = entityType === 'CLIENTES'
    ? ['nombre', 'telefono']
    : ['nombre', 'precioVenta']

  const missingHeaders = requiredHeaders.filter(h => !headers.includes(h))

  if (missingHeaders.length > 0) {
    return {
      valid: false,
      error: `Faltan columnas requeridas: ${missingHeaders.join(', ')}`,
    }
  }

  return { valid: true }
}
