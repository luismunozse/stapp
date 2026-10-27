import { z } from 'zod'
import type { ParsedRow } from './csv-parser'
import { parseLocalizedNumber } from './number-parse'

// Cells reach the validators as STRINGS (CSV) or native numbers (Excel). Text
// fields accept both: a numeric Excel cell for telefono/dni/codigo is a valid
// identifier, not a "format error".
const toText = (val: unknown): unknown => {
  if (typeof val === 'number') return Number.isFinite(val) ? String(val) : val
  if (typeof val === 'string') return val.trim()
  return val
}

const optionalText = z.preprocess(toText, z.string().nullish())
const emailShape = z.string().email()

// Cliente validation schema (matches existing API schema)
const clienteRowSchema = z.object({
  nombre: z.preprocess(
    toText,
    z.string({ required_error: 'El nombre es requerido', invalid_type_error: 'El nombre es requerido' })
      .min(1, 'El nombre es requerido'),
  ),
  telefono: z.preprocess((val, ctx) => {
    const raw = toText(val)
    if (raw === null || raw === undefined || raw === '') {
      ctx.addIssue({ code: 'custom', fatal: true, message: 'El teléfono es requerido' })
      return z.NEVER
    }
    // Spaces, dashes, dots and parentheses are formatting, not content.
    const digits = typeof raw === 'string' ? raw.replace(/[\s().-]/g, '') : raw
    if (typeof digits !== 'string' || !/^\d{10}$/.test(digits)) {
      ctx.addIssue({
        code: 'custom',
        fatal: true,
        message: `El teléfono debe tener exactamente 10 dígitos (recibido: "${String(raw)}")`,
      })
      return z.NEVER
    }
    return digits
  }, z.string()),
  email: z.preprocess(
    toText,
    z.string().nullish().refine(
      (v) => !v || emailShape.safeParse(v).success,
      (v) => ({ message: `Email inválido: "${v}"` }),
    ),
  ),
  direccion: optionalText,
  dni: optionalText,
})

/**
 * Number column. `emptyValue` is what a blank cell becomes. Parsing goes through
 * the shared `parseLocalizedNumber` so "1.500", "1.500,50" and "1,234.56" mean
 * the same thing here as in "Actualizar precios"; garbage is an explicit error
 * naming the column and the value, never a silent guess.
 */
const numberColumn = (
  label: string,
  opts: { integer?: boolean; emptyValue: 0 | undefined; minMessage: string },
) =>
  z.preprocess((val, ctx) => {
    if (val === null || val === undefined || (typeof val === 'string' && val.trim() === '')) {
      return opts.emptyValue
    }
    const num = parseLocalizedNumber(val as string | number)
    if (num === null || (opts.integer && !Number.isInteger(num))) {
      ctx.addIssue({
        code: 'custom',
        fatal: true,
        message: opts.integer
          ? `${label} inválido: "${String(val)}" debe ser un número entero mayor o igual a 0`
          : `${label} inválido: "${String(val)}" no es un número válido (ejemplos: 1500 o 1.500,50)`,
      })
      return z.NEVER
    }
    return num
  }, opts.emptyValue === undefined
    ? z.number().min(0, opts.minMessage).optional()
    : z.number().min(0, opts.minMessage))

const inventarioRowSchema = z.object({
  codigo: optionalText,
  nombre: z.preprocess(
    toText,
    z.string({ required_error: 'El nombre es requerido', invalid_type_error: 'El nombre es requerido' })
      .min(1, 'El nombre es requerido'),
  ),
  descripcion: optionalText,
  categoria: optionalText,
  tipoDispositivo: optionalText,
  stock: numberColumn('Stock', { integer: true, emptyValue: 0, minMessage: 'El stock debe ser mayor o igual a 0' }),
  precioCompra: numberColumn('Precio de compra', { emptyValue: undefined, minMessage: 'Precio de compra debe ser mayor o igual a 0' }),
  precioVenta: numberColumn('Precio de venta', { emptyValue: 0, minMessage: 'El precio de venta debe ser mayor o igual a 0' }),
  proveedor: optionalText,
  marca: optionalText,
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
  /** Full message including the spreadsheet row: "Fila 7: Precio de venta inválido: ...". */
  error?: string
  /** Same message without the "Fila N:" prefix (for UIs that show the row separately). */
  message?: string
  /** Canonical column (e.g. "precioVenta") of the first problem found, when known. */
  column?: string
  sinPrecio?: boolean
}

function invalidResult(error: unknown, rowNumber: number): ValidationResult {
  let message = 'Error de validación'
  let column: string | undefined
  if (error instanceof z.ZodError) {
    const issues = error.errors
    message = issues.map(i => i.message).join('; ')
    const first = issues[0]?.path[0]
    column = typeof first === 'string' ? first : undefined
  } else if (error instanceof Error) {
    message = error.message
  }
  return { valid: false, error: `Fila ${rowNumber}: ${message}`, message, column }
}

/**
 * @param rowIndex 0-based index of the data row (header excluded).
 * @param rowNumber real spreadsheet line to report; defaults to `rowIndex + 2`
 *   (header = line 1), which only holds for CSVs without blank lines.
 */
export function validateClienteRow(row: ParsedRow, rowIndex: number, rowNumber = rowIndex + 2): ValidationResult {
  try {
    const data = clienteRowSchema.parse(row)
    return { valid: true, data }
  } catch (error) {
    return invalidResult(error, rowNumber)
  }
}

export function validateInventarioRow(row: ParsedRow, rowIndex: number, rowNumber = rowIndex + 2): ValidationResult {
  try {
    const data = inventarioRowSchema.parse(row)
    const sinPrecio = row.precioVenta === null || row.precioVenta === undefined ||
      (typeof row.precioVenta === 'string' && row.precioVenta.trim() === '')
    return { valid: true, data, sinPrecio }
  } catch (error) {
    return invalidResult(error, rowNumber)
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
