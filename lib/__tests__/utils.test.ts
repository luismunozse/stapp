import { describe, it, expect } from 'vitest'
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  calculateIVA,
  calculateTotal,
  cn
} from '../utils'

describe('formatCurrency', () => {
  it('formatea numeros positivos en pesos argentinos', () => {
    const result = formatCurrency(1000)
    expect(result).toContain('1.000')
    // Puede ser "$ 1.000,00" o "ARS 1.000,00" dependiendo del locale
    expect(result).toMatch(/(\$|ARS)/)
  })

  it('formatea cero correctamente', () => {
    const result = formatCurrency(0)
    expect(result).toContain('0')
  })

  it('formatea numeros con decimales', () => {
    const result = formatCurrency(1234.56)
    expect(result).toContain('1.234')
  })

  it('formatea numeros negativos', () => {
    const result = formatCurrency(-500)
    expect(result).toContain('-')
  })

  it('maneja decimales con redondeo', () => {
    const result = formatCurrency(99.999)
    expect(result).toContain('100')
  })
})

describe('formatDate', () => {
  it('formatea fecha desde string ISO', () => {
    const result = formatDate('2024-03-15T10:30:00Z')
    expect(result).toContain('15')
    expect(result).toContain('03')
    expect(result).toContain('2024')
  })

  it('formatea fecha desde objeto Date', () => {
    // Mediodía UTC: cae el día 15 en America/Argentina/Buenos_Aires (UTC-3)
    // independientemente de la TZ del runner (CI corre en UTC).
    const date = new Date(Date.UTC(2024, 2, 15, 12, 0, 0)) // Marzo 15
    const result = formatDate(date)
    expect(result).toContain('15')
    expect(result).toContain('03')
    expect(result).toContain('2024')
  })

  it('usa formato es-AR (dia/mes/ano)', () => {
    // Mediodía UTC para que el día sea estable ante la TZ del runner.
    const date = new Date(Date.UTC(2024, 11, 25, 12, 0, 0)) // Diciembre 25
    const result = formatDate(date)
    expect(result).toMatch(/25.*12.*2024/)
  })
})

describe('formatDateTime', () => {
  it('incluye fecha y hora', () => {
    const result = formatDateTime('2024-03-15T14:30:00')
    expect(result).toContain('15')
    expect(result).toContain('03')
    expect(result).toContain('2024')
    // Hora puede variar por timezone, verificamos que tenga formato de hora
    expect(result).toMatch(/\d{1,2}:\d{2}/)
  })

  it('formatea desde objeto Date', () => {
    const date = new Date(2024, 2, 15, 14, 30)
    const result = formatDateTime(date)
    expect(result).toContain('15')
    expect(result).toMatch(/\d{1,2}:\d{2}/)
  })
})

describe('calculateIVA', () => {
  it('calcula 21% de IVA', () => {
    expect(calculateIVA(100)).toBe(21)
    expect(calculateIVA(1000)).toBe(210)
  })

  it('maneja cero', () => {
    expect(calculateIVA(0)).toBe(0)
  })

  it('maneja decimales', () => {
    expect(calculateIVA(100.5)).toBeCloseTo(21.105, 2)
  })

  it('maneja numeros grandes', () => {
    expect(calculateIVA(10000)).toBe(2100)
  })
})

describe('calculateTotal', () => {
  it('suma subtotal + IVA (21%)', () => {
    expect(calculateTotal(100)).toBe(121)
    expect(calculateTotal(1000)).toBe(1210)
  })

  it('maneja cero', () => {
    expect(calculateTotal(0)).toBe(0)
  })

  it('maneja decimales', () => {
    expect(calculateTotal(100.5)).toBeCloseTo(121.605, 2)
  })
})

describe('cn (className merge)', () => {
  it('combina clases correctamente', () => {
    expect(cn('px-4', 'py-2')).toBe('px-4 py-2')
  })

  it('resuelve conflictos de tailwind', () => {
    // tailwind-merge resuelve conflictos - la ultima gana
    expect(cn('px-4', 'px-8')).toBe('px-8')
  })

  it('filtra valores falsy', () => {
    expect(cn('px-4', false && 'hidden', 'py-2')).toBe('px-4 py-2')
    expect(cn('px-4', undefined, 'py-2')).toBe('px-4 py-2')
    expect(cn('px-4', null, 'py-2')).toBe('px-4 py-2')
  })

  it('maneja arrays', () => {
    expect(cn(['px-4', 'py-2'])).toBe('px-4 py-2')
  })

  it('maneja objetos condicionales', () => {
    expect(cn({ 'px-4': true, 'hidden': false })).toBe('px-4')
  })
})
