import { describe, it, expect } from 'vitest'
import {
  arrayToCSV,
  formatDateCSV,
  formatCurrencyCSV,
  ORDENES_COLUMNS,
  VENTAS_COLUMNS,
  CLIENTES_COLUMNS,
  INVENTARIO_COLUMNS,
  GARANTIAS_COLUMNS,
  type CSVColumn,
} from '../csv-export'

describe('arrayToCSV', () => {
  it('genera CSV con headers y datos', () => {
    const columns: CSVColumn<any>[] = [
      { key: 'nombre', header: 'Nombre' },
      { key: 'edad', header: 'Edad' },
    ]
    const data = [
      { nombre: 'Juan', edad: 30 },
      { nombre: 'María', edad: 25 },
    ]
    const result = arrayToCSV(data, columns)
    const lines = result.split('\n')
    expect(lines[0]).toBe('Nombre,Edad')
    expect(lines[1]).toBe('Juan,30')
    expect(lines[2]).toBe('María,25')
  })

  it('retorna solo headers si no hay datos', () => {
    const columns: CSVColumn<any>[] = [
      { key: 'nombre', header: 'Nombre' },
      { key: 'email', header: 'Email' },
    ]
    const result = arrayToCSV([], columns)
    expect(result).toBe('Nombre,Email')
  })

  it('escapa campos con comas', () => {
    const columns: CSVColumn<any>[] = [
      { key: 'desc', header: 'Descripción' },
    ]
    const data = [{ desc: 'Pantalla, teclado y mouse' }]
    const result = arrayToCSV(data, columns)
    const lines = result.split('\n')
    expect(lines[1]).toBe('"Pantalla, teclado y mouse"')
  })

  it('escapa campos con comillas dobles', () => {
    const columns: CSVColumn<any>[] = [
      { key: 'desc', header: 'Descripción' },
    ]
    const data = [{ desc: 'Pantalla 15"' }]
    const result = arrayToCSV(data, columns)
    const lines = result.split('\n')
    expect(lines[1]).toBe('"Pantalla 15"""')
  })

  it('escapa campos con saltos de línea', () => {
    const columns: CSVColumn<any>[] = [
      { key: 'notas', header: 'Notas' },
    ]
    const data = [{ notas: 'Línea 1\nLínea 2' }]
    const result = arrayToCSV(data, columns)
    expect(result).toContain('"Línea 1\nLínea 2"')
  })

  it('maneja valores null y undefined', () => {
    const columns: CSVColumn<any>[] = [
      { key: 'nombre', header: 'Nombre' },
      { key: 'email', header: 'Email' },
    ]
    const data = [{ nombre: 'Juan', email: null }]
    const result = arrayToCSV(data, columns)
    const lines = result.split('\n')
    expect(lines[1]).toBe('Juan,')
  })

  it('formatea booleanos como Sí/No', () => {
    const columns: CSVColumn<any>[] = [
      { key: 'activo', header: 'Activo' },
    ]
    const data = [{ activo: true }, { activo: false }]
    const result = arrayToCSV(data, columns)
    const lines = result.split('\n')
    expect(lines[1]).toBe('Sí')
    expect(lines[2]).toBe('No')
  })

  it('aplica funciones transform personalizadas', () => {
    const columns: CSVColumn<any>[] = [
      {
        key: 'precio',
        header: 'Precio',
        transform: (v: number) => `$${v.toFixed(2)}`,
      },
    ]
    const data = [{ precio: 1500 }]
    const result = arrayToCSV(data, columns)
    const lines = result.split('\n')
    expect(lines[1]).toBe('$1500.00')
  })

  it('navega claves anidadas con notación de punto', () => {
    const columns: CSVColumn<any>[] = [
      { key: 'cliente.nombre', header: 'Cliente' },
      { key: 'cliente.telefono', header: 'Teléfono' },
    ]
    const data = [
      { cliente: { nombre: 'Juan', telefono: '1234567890' } },
    ]
    const result = arrayToCSV(data, columns)
    const lines = result.split('\n')
    expect(lines[1]).toBe('Juan,1234567890')
  })

  it('maneja claves anidadas con valor undefined', () => {
    const columns: CSVColumn<any>[] = [
      { key: 'cliente.nombre', header: 'Cliente' },
    ]
    const data = [{ cliente: null }]
    const result = arrayToCSV(data, columns)
    const lines = result.split('\n')
    expect(lines[1]).toBe('')
  })

  it('formatea Date objects como YYYY-MM-DD', () => {
    const columns: CSVColumn<any>[] = [
      { key: 'fecha', header: 'Fecha' },
    ]
    const data = [{ fecha: new Date('2024-03-15T00:00:00Z') }]
    const result = arrayToCSV(data, columns)
    const lines = result.split('\n')
    expect(lines[1]).toBe('2024-03-15')
  })
})

describe('formatDateCSV', () => {
  it('formatea fecha ISO a YYYY-MM-DD', () => {
    expect(formatDateCSV('2024-03-15T14:30:00Z')).toBe('2024-03-15')
  })

  it('formatea objeto Date', () => {
    const date = new Date('2024-12-25T00:00:00Z')
    expect(formatDateCSV(date)).toBe('2024-12-25')
  })

  it('retorna string vacío para null', () => {
    expect(formatDateCSV(null)).toBe('')
  })

  it('retorna string vacío para undefined', () => {
    expect(formatDateCSV(undefined as any)).toBe('')
  })
})

describe('formatCurrencyCSV', () => {
  it('formatea número a 2 decimales', () => {
    expect(formatCurrencyCSV(1500)).toBe('1500.00')
  })

  it('formatea número con decimales', () => {
    expect(formatCurrencyCSV(99.5)).toBe('99.50')
  })

  it('retorna "0" para null', () => {
    expect(formatCurrencyCSV(null)).toBe('0')
  })

  it('retorna "0" para undefined', () => {
    expect(formatCurrencyCSV(undefined as any)).toBe('0')
  })

  it('formatea cero correctamente', () => {
    expect(formatCurrencyCSV(0)).toBe('0.00')
  })

  it('maneja números negativos', () => {
    expect(formatCurrencyCSV(-100)).toBe('-100.00')
  })
})

describe('Configuraciones de columnas por entidad', () => {
  it('ORDENES_COLUMNS tiene las columnas esperadas', () => {
    const keys = ORDENES_COLUMNS.map((c) => c.key)
    expect(keys).toContain('numero_orden')
    expect(keys).toContain('codigo_orden')
    expect(keys).toContain('cliente.nombre')
    expect(keys).toContain('estado')
    expect(keys).toContain('fecha_ingreso')
    expect(keys).toContain('presupuesto')
    expect(keys).toContain('tecnico.nombre')
    expect(ORDENES_COLUMNS.length).toBeGreaterThan(10)
  })

  it('VENTAS_COLUMNS tiene las columnas esperadas', () => {
    const keys = VENTAS_COLUMNS.map((c) => c.key)
    expect(keys).toContain('numero_venta')
    expect(keys).toContain('total')
    expect(keys).toContain('metodo_pago')
    expect(keys).toContain('vendedor.nombre')
  })

  it('CLIENTES_COLUMNS tiene las columnas esperadas', () => {
    const keys = CLIENTES_COLUMNS.map((c) => c.key)
    expect(keys).toContain('nombre')
    expect(keys).toContain('telefono')
    expect(keys).toContain('email')
    expect(keys).toContain('dni')
  })

  it('INVENTARIO_COLUMNS tiene las columnas esperadas', () => {
    const keys = INVENTARIO_COLUMNS.map((c) => c.key)
    expect(keys).toContain('codigo')
    expect(keys).toContain('nombre')
    expect(keys).toContain('stock')
    expect(keys).toContain('precio_compra')
    expect(keys).toContain('precio_venta')
  })

  it('GARANTIAS_COLUMNS tiene las columnas esperadas', () => {
    const keys = GARANTIAS_COLUMNS.map((c) => c.key)
    expect(keys).toContain('dias_validez')
    expect(keys).toContain('fecha_inicio')
    expect(keys).toContain('fecha_vencimiento')
    expect(keys).toContain('estado')
  })

  it('todas las columnas tienen header definido', () => {
    const allColumns = [
      ...ORDENES_COLUMNS,
      ...VENTAS_COLUMNS,
      ...CLIENTES_COLUMNS,
      ...INVENTARIO_COLUMNS,
      ...GARANTIAS_COLUMNS,
    ]
    allColumns.forEach((col) => {
      expect(col.header).toBeDefined()
      expect(col.header.length).toBeGreaterThan(0)
    })
  })

  it('columnas con fechas tienen transform', () => {
    const dateColumns = [
      ...ORDENES_COLUMNS.filter((c) => c.key.toString().includes('fecha')),
      ...VENTAS_COLUMNS.filter((c) => c.key === 'created_at'),
      ...GARANTIAS_COLUMNS.filter((c) => c.key.toString().includes('fecha')),
    ]
    dateColumns.forEach((col) => {
      expect(col.transform).toBeDefined()
    })
  })

  it('columnas monetarias tienen transform', () => {
    const moneyColumns = [
      ...ORDENES_COLUMNS.filter((c) =>
        ['presupuesto', 'costo_final'].includes(c.key.toString())
      ),
      ...VENTAS_COLUMNS.filter((c) =>
        ['subtotal', 'descuento', 'total'].includes(c.key.toString())
      ),
    ]
    moneyColumns.forEach((col) => {
      expect(col.transform).toBeDefined()
    })
  })
})
