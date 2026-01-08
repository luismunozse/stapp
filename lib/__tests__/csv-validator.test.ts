import { describe, it, expect } from 'vitest'
import {
  validateClienteRow,
  validateInventarioRow,
  validateCSVHeaders,
} from '../csv-validator'

describe('validateClienteRow', () => {
  it('valida cliente correcto', () => {
    const row = {
      nombre: 'Juan Perez',
      telefono: '1123456789',
      email: 'juan@test.com',
    }
    const result = validateClienteRow(row, 0)
    expect(result.valid).toBe(true)
    expect(result.data).toBeDefined()
    expect(result.data.nombre).toBe('Juan Perez')
  })

  it('rechaza telefono con menos de 10 digitos', () => {
    const row = {
      nombre: 'Juan',
      telefono: '123456', // solo 6 digitos
    }
    const result = validateClienteRow(row, 0)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('10 dígitos')
  })

  it('rechaza telefono con letras', () => {
    const row = {
      nombre: 'Juan',
      telefono: '123456789a',
    }
    const result = validateClienteRow(row, 0)
    expect(result.valid).toBe(false)
  })

  it('rechaza nombre vacio', () => {
    const row = {
      nombre: '',
      telefono: '1123456789',
    }
    const result = validateClienteRow(row, 0)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('nombre')
  })

  it('acepta email vacio como opcional', () => {
    const row = {
      nombre: 'Juan',
      telefono: '1123456789',
      email: '',
    }
    const result = validateClienteRow(row, 0)
    expect(result.valid).toBe(true)
  })

  it('acepta email null como opcional', () => {
    const row = {
      nombre: 'Juan',
      telefono: '1123456789',
      email: null,
    }
    const result = validateClienteRow(row, 0)
    expect(result.valid).toBe(true)
  })

  it('rechaza email invalido', () => {
    const row = {
      nombre: 'Juan',
      telefono: '1123456789',
      email: 'not-an-email',
    }
    const result = validateClienteRow(row, 0)
    expect(result.valid).toBe(false)
    expect(result.error?.toLowerCase()).toContain('email')
  })

  it('incluye numero de fila en error (1-indexed + header)', () => {
    const row = { nombre: '', telefono: '1234' }
    const result = validateClienteRow(row, 0) // fila 0 = fila 2 en CSV (despues del header)
    expect(result.error).toContain('Fila 2')
  })

  it('calcula correctamente fila 5 del CSV', () => {
    const row = { nombre: '', telefono: '1234' }
    const result = validateClienteRow(row, 3) // fila 3 = fila 5 en CSV
    expect(result.error).toContain('Fila 5')
  })

  it('acepta campos opcionales como null', () => {
    const row = {
      nombre: 'Juan',
      telefono: '1123456789',
      direccion: null,
      dni: null,
    }
    const result = validateClienteRow(row, 0)
    expect(result.valid).toBe(true)
  })
})

describe('validateInventarioRow', () => {
  it('valida inventario correcto', () => {
    const row = {
      codigo: 'PROD001',
      nombre: 'Pantalla iPhone',
      categoria: 'Pantallas',
      tipoDispositivo: 'CELULAR',
      stock: '10',
      precioCompra: '5000',
      precioVenta: '8000',
    }
    const result = validateInventarioRow(row, 0)
    expect(result.valid).toBe(true)
    expect(result.data?.stock).toBe(10) // transformado a numero
    expect(result.data?.precioCompra).toBe(5000)
  })

  it('acepta numeros directos (no strings)', () => {
    const row = {
      codigo: 'PROD001',
      nombre: 'Producto',
      categoria: 'Cat',
      tipoDispositivo: 'CELULAR',
      stock: 10,
      precioCompra: 100,
      precioVenta: 150,
    }
    const result = validateInventarioRow(row, 0)
    expect(result.valid).toBe(true)
    expect(result.data?.stock).toBe(10)
  })

  it('rechaza tipo de dispositivo invalido', () => {
    const row = {
      codigo: 'PROD001',
      nombre: 'Producto',
      categoria: 'Cat',
      tipoDispositivo: 'INVALIDO',
      stock: '10',
      precioCompra: '100',
      precioVenta: '150',
    }
    const result = validateInventarioRow(row, 0)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('Tipo de dispositivo')
  })

  it('acepta todos los tipos validos', () => {
    const tipos = ['CELULAR', 'COMPUTADORA', 'TABLET', 'CONSOLA', 'SMARTWATCH', 'TODOS']
    tipos.forEach((tipo) => {
      const row = {
        codigo: 'PROD001',
        nombre: 'Producto',
        categoria: 'Cat',
        tipoDispositivo: tipo,
        stock: '1',
        precioCompra: '100',
        precioVenta: '150',
      }
      const result = validateInventarioRow(row, 0)
      expect(result.valid).toBe(true)
    })
  })

  it('rechaza stock negativo', () => {
    const row = {
      codigo: 'PROD001',
      nombre: 'Producto',
      categoria: 'Cat',
      tipoDispositivo: 'CELULAR',
      stock: '-5',
      precioCompra: '100',
      precioVenta: '150',
    }
    const result = validateInventarioRow(row, 0)
    expect(result.valid).toBe(false)
  })

  it('rechaza precio de compra negativo', () => {
    const row = {
      codigo: 'PROD001',
      nombre: 'Producto',
      categoria: 'Cat',
      tipoDispositivo: 'CELULAR',
      stock: '10',
      precioCompra: '-100',
      precioVenta: '150',
    }
    const result = validateInventarioRow(row, 0)
    expect(result.valid).toBe(false)
  })

  it('rechaza codigo vacio', () => {
    const row = {
      codigo: '',
      nombre: 'Producto',
      categoria: 'Cat',
      tipoDispositivo: 'CELULAR',
      stock: '10',
      precioCompra: '100',
      precioVenta: '150',
    }
    const result = validateInventarioRow(row, 0)
    expect(result.valid).toBe(false)
  })

  it('acepta proveedor opcional como null', () => {
    const row = {
      codigo: 'PROD001',
      nombre: 'Producto',
      categoria: 'Cat',
      tipoDispositivo: 'CELULAR',
      stock: '10',
      precioCompra: '100',
      precioVenta: '150',
      proveedor: null,
    }
    const result = validateInventarioRow(row, 0)
    expect(result.valid).toBe(true)
  })

  it('acepta precios con decimales', () => {
    const row = {
      codigo: 'PROD001',
      nombre: 'Producto',
      categoria: 'Cat',
      tipoDispositivo: 'CELULAR',
      stock: '10',
      precioCompra: '99.99',
      precioVenta: '149.99',
    }
    const result = validateInventarioRow(row, 0)
    expect(result.valid).toBe(true)
    expect(result.data?.precioCompra).toBeCloseTo(99.99, 2)
  })
})

describe('validateCSVHeaders', () => {
  it('valida headers de clientes correctos', () => {
    const headers = ['nombre', 'telefono', 'email', 'direccion']
    const result = validateCSVHeaders(headers, 'CLIENTES')
    expect(result.valid).toBe(true)
  })

  it('valida headers minimos de clientes', () => {
    const headers = ['nombre', 'telefono']
    const result = validateCSVHeaders(headers, 'CLIENTES')
    expect(result.valid).toBe(true)
  })

  it('detecta columnas faltantes en clientes', () => {
    const headers = ['nombre'] // falta telefono
    const result = validateCSVHeaders(headers, 'CLIENTES')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('telefono')
  })

  it('valida headers de inventario correctos', () => {
    const headers = [
      'codigo',
      'nombre',
      'categoria',
      'tipoDispositivo',
      'stock',
      'precioCompra',
      'precioVenta',
    ]
    const result = validateCSVHeaders(headers, 'INVENTARIO')
    expect(result.valid).toBe(true)
  })

  it('detecta columnas faltantes en inventario', () => {
    const headers = ['codigo', 'nombre'] // faltan varias
    const result = validateCSVHeaders(headers, 'INVENTARIO')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('categoria')
  })

  it('acepta headers extras', () => {
    const headers = ['nombre', 'telefono', 'extra_column', 'another_extra']
    const result = validateCSVHeaders(headers, 'CLIENTES')
    expect(result.valid).toBe(true)
  })

  it('es case sensitive', () => {
    const headers = ['Nombre', 'Telefono'] // mayusculas
    const result = validateCSVHeaders(headers, 'CLIENTES')
    expect(result.valid).toBe(false)
  })
})
