import { describe, it, expect } from 'vitest'
import {
  snakeToCamel,
  camelToSnake,
  transformToCamelCase,
  transformToSnakeCase,
  formatCliente,
  formatInventario,
  formatUser,
  formatProveedor,
} from '../db-utils'

describe('snakeToCamel', () => {
  it('convierte snake_case a camelCase', () => {
    expect(snakeToCamel('hello_world')).toBe('helloWorld')
    expect(snakeToCamel('organization_id')).toBe('organizationId')
    expect(snakeToCamel('fecha_ingreso')).toBe('fechaIngreso')
  })

  it('mantiene strings sin guiones bajos', () => {
    expect(snakeToCamel('hello')).toBe('hello')
    expect(snakeToCamel('id')).toBe('id')
  })

  it('maneja multiples guiones', () => {
    expect(snakeToCamel('my_long_variable_name')).toBe('myLongVariableName')
  })

  it('maneja string vacio', () => {
    expect(snakeToCamel('')).toBe('')
  })

  it('maneja guiones al inicio', () => {
    expect(snakeToCamel('_private')).toBe('Private')
  })
})

describe('camelToSnake', () => {
  it('convierte camelCase a snake_case', () => {
    expect(camelToSnake('helloWorld')).toBe('hello_world')
    expect(camelToSnake('organizationId')).toBe('organization_id')
    expect(camelToSnake('fechaIngreso')).toBe('fecha_ingreso')
  })

  it('mantiene strings sin mayusculas', () => {
    expect(camelToSnake('hello')).toBe('hello')
    expect(camelToSnake('id')).toBe('id')
  })

  it('maneja multiples mayusculas', () => {
    expect(camelToSnake('myLongVariableName')).toBe('my_long_variable_name')
  })

  it('maneja string vacio', () => {
    expect(camelToSnake('')).toBe('')
  })
})

describe('transformToCamelCase', () => {
  it('transforma objeto completo', () => {
    const input = {
      organization_id: '123',
      fecha_ingreso: '2024-01-01',
      numero_orden: 1,
    }
    const result = transformToCamelCase(input)
    expect(result).toEqual({
      organizationId: '123',
      fechaIngreso: '2024-01-01',
      numeroOrden: 1,
    })
  })

  it('transforma arrays', () => {
    const input = [{ my_key: 'value1' }, { my_key: 'value2' }]
    const result = transformToCamelCase(input)
    expect(result).toEqual([{ myKey: 'value1' }, { myKey: 'value2' }])
  })

  it('maneja objetos anidados', () => {
    const input = {
      outer_key: {
        inner_key: 'value',
      },
    }
    const result = transformToCamelCase(input)
    expect(result).toEqual({
      outerKey: {
        innerKey: 'value',
      },
    })
  })

  it('maneja null', () => {
    expect(transformToCamelCase(null as any)).toBe(null)
  })

  it('maneja undefined', () => {
    expect(transformToCamelCase(undefined as any)).toBe(undefined)
  })

  it('retorna primitivos sin cambios', () => {
    expect(transformToCamelCase('string' as any)).toBe('string')
    expect(transformToCamelCase(123 as any)).toBe(123)
    expect(transformToCamelCase(true as any)).toBe(true)
  })

  it('maneja arrays anidados', () => {
    const input = {
      items: [
        { item_id: 1 },
        { item_id: 2 },
      ],
    }
    const result = transformToCamelCase(input)
    expect(result.items[0].itemId).toBe(1)
    expect(result.items[1].itemId).toBe(2)
  })
})

describe('transformToSnakeCase', () => {
  it('transforma objeto de camelCase a snake_case', () => {
    const input = {
      organizationId: '123',
      fechaIngreso: '2024-01-01',
    }
    const result = transformToSnakeCase(input)
    expect(result).toEqual({
      organization_id: '123',
      fecha_ingreso: '2024-01-01',
    })
  })

  it('transforma arrays', () => {
    const input = [{ myKey: 'value1' }, { myKey: 'value2' }]
    const result = transformToSnakeCase(input)
    expect(result).toEqual([{ my_key: 'value1' }, { my_key: 'value2' }])
  })

  it('maneja null y undefined', () => {
    expect(transformToSnakeCase(null as any)).toBe(null)
    expect(transformToSnakeCase(undefined as any)).toBe(undefined)
  })
})

describe('formatCliente', () => {
  it('formatea cliente correctamente', () => {
    const input = {
      id: '1',
      nombre: 'Juan',
      telefono: '1234567890',
      email: 'juan@test.com',
      direccion: 'Calle 123',
      dni: '12345678',
      organization_id: 'org-1',
      created_at: '2024-01-01',
      updated_at: '2024-01-02',
    }
    const result = formatCliente(input)
    expect(result).toEqual({
      id: '1',
      nombre: 'Juan',
      telefono: '1234567890',
      email: 'juan@test.com',
      direccion: 'Calle 123',
      dni: '12345678',
      organizationId: 'org-1',
      createdAt: '2024-01-01',
      updatedAt: '2024-01-02',
    })
  })

  it('retorna null para input null', () => {
    expect(formatCliente(null)).toBe(null)
  })

  it('retorna null para input undefined', () => {
    expect(formatCliente(undefined)).toBe(null)
  })

  it('maneja campos opcionales faltantes', () => {
    const input = {
      id: '1',
      nombre: 'Juan',
      telefono: '123',
      organization_id: 'org-1',
    }
    const result = formatCliente(input)
    expect(result?.nombre).toBe('Juan')
    expect(result?.email).toBeUndefined()
  })
})

describe('formatInventario', () => {
  it('formatea item de inventario', () => {
    const input = {
      id: '1',
      codigo: 'PROD001',
      nombre: 'Pantalla iPhone',
      descripcion: 'Pantalla OLED',
      categoria: 'Pantallas',
      tipo_dispositivo: 'CELULAR',
      stock: 10,
      precio_compra: 5000,
      precio_venta: 8000,
      proveedor: 'Proveedor X',
      organization_id: 'org-1',
      created_at: '2024-01-01',
      updated_at: '2024-01-02',
    }
    const result = formatInventario(input)
    expect(result?.tipoDispositivo).toBe('CELULAR')
    expect(result?.precioCompra).toBe(5000)
    expect(result?.precioVenta).toBe(8000)
    expect(result?.organizationId).toBe('org-1')
    expect(result?.codigo).toBe('PROD001')
  })

  it('retorna null para input null', () => {
    expect(formatInventario(null)).toBe(null)
  })
})

describe('formatUser', () => {
  it('formatea usuario correctamente', () => {
    const input = {
      id: 'user-1',
      email: 'user@test.com',
      nombre: 'Usuario Test',
      rol: 'ADMIN',
      organization_id: 'org-1',
      created_at: '2024-01-01',
      updated_at: '2024-01-02',
    }
    const result = formatUser(input)
    expect(result?.email).toBe('user@test.com')
    expect(result?.rol).toBe('ADMIN')
    expect(result?.organizationId).toBe('org-1')
  })

  it('retorna null para input null', () => {
    expect(formatUser(null)).toBe(null)
  })
})

describe('formatProveedor', () => {
  it('formatea proveedor correctamente', () => {
    const input = {
      id: 'prov-1',
      nombre: 'Proveedor Test',
      telefono: '123456',
      whatsapp: '123456',
      email: 'prov@test.com',
      direccion: 'Direccion 123',
      website: 'https://test.com',
      notas: 'Notas del proveedor',
      activo: true,
      organization_id: 'org-1',
      created_at: '2024-01-01',
      updated_at: '2024-01-02',
    }
    const result = formatProveedor(input)
    expect(result?.nombre).toBe('Proveedor Test')
    expect(result?.activo).toBe(true)
    expect(result?.organizationId).toBe('org-1')
  })

  it('retorna null para input null', () => {
    expect(formatProveedor(null)).toBe(null)
  })
})
