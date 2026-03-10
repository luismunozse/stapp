import { describe, it, expect } from 'vitest'
import {
  snakeToCamel,
  camelToSnake,
  transformToCamelCase,
  transformToSnakeCase,
  formatCliente,
  formatOrden,
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
      tipoCliente: 'INDIVIDUAL',
      razonSocial: undefined,
      cuit: undefined,
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
    expect(result?.tipoCliente).toBe('INDIVIDUAL')
  })

  it('formatea cliente empresa con razon social y cuit', () => {
    const input = {
      id: '2',
      nombre: 'Municipalidad de Cordoba',
      telefono: '3514001234',
      email: 'contacto@muni.gob.ar',
      direccion: 'Av. Marcelo T. de Alvear 120',
      dni: null,
      tipo_cliente: 'EMPRESA',
      razon_social: 'Municipalidad de Cordoba',
      cuit: '30-12345678-9',
      organization_id: 'org-1',
      created_at: '2024-01-01',
      updated_at: '2024-01-02',
    }
    const result = formatCliente(input)
    expect(result?.tipoCliente).toBe('EMPRESA')
    expect(result?.razonSocial).toBe('Municipalidad de Cordoba')
    expect(result?.cuit).toBe('30-12345678-9')
  })

  it('defaults tipoCliente to INDIVIDUAL when tipo_cliente is null', () => {
    const input = {
      id: '3',
      nombre: 'Cliente Viejo',
      telefono: '123',
      tipo_cliente: null,
      organization_id: 'org-1',
    }
    const result = formatCliente(input)
    expect(result?.tipoCliente).toBe('INDIVIDUAL')
  })
})

describe('formatOrden', () => {
  it('formatea orden con sector', () => {
    const input = {
      id: 'ord-1',
      numero_orden: 1,
      codigo_orden: 'CEL-001',
      cliente_id: 'c-1',
      tecnico_id: null,
      organization_id: 'org-1',
      dispositivo: 'iPhone 15',
      tipo_dispositivo: 'CELULAR',
      marca: 'Apple',
      color: 'Negro',
      imei: '123456789',
      accesorios: 'Cargador',
      password_dispositivo: null,
      problema_reportado: 'No enciende',
      estado: 'RECIBIDO',
      presupuesto: null,
      costo_final: null,
      sena: 0,
      fecha_ingreso: '2024-01-01',
      fecha_prometida: null,
      fecha_completado: null,
      observaciones: null,
      diagnostico: null,
      metadata: { procesador: 'A16' },
      sector_id: 's-1',
      sectores_cliente: {
        id: 's-1',
        cliente_id: 'c-1',
        nombre: 'Finanzas',
        contacto_nombre: 'Juan',
        contacto_telefono: '123',
        contacto_email: 'juan@empresa.com',
        activo: true,
      },
    }
    const result = formatOrden(input)
    expect(result?.sectorId).toBe('s-1')
    expect(result?.sector?.nombre).toBe('Finanzas')
    expect(result?.sector?.contactoNombre).toBe('Juan')
    expect(result?.sector?.contactoEmail).toBe('juan@empresa.com')
    expect(result?.metadata).toEqual({ procesador: 'A16' })
  })

  it('formatea orden sin sector', () => {
    const input = {
      id: 'ord-2',
      numero_orden: 2,
      codigo_orden: 'CEL-002',
      cliente_id: 'c-2',
      tecnico_id: null,
      organization_id: 'org-1',
      dispositivo: 'Samsung S24',
      tipo_dispositivo: 'CELULAR',
      marca: 'Samsung',
      color: null,
      imei: null,
      accesorios: null,
      password_dispositivo: null,
      problema_reportado: 'Pantalla rota',
      estado: 'RECIBIDO',
      presupuesto: 50000,
      costo_final: null,
      sena: 0,
      fecha_ingreso: '2024-01-02',
      fecha_prometida: null,
      fecha_completado: null,
      observaciones: null,
      diagnostico: null,
      metadata: {},
      sector_id: null,
    }
    const result = formatOrden(input)
    expect(result?.sectorId).toBeNull()
    expect(result?.sector).toBeUndefined()
    expect(result?.metadata).toEqual({})
  })

  it('retorna null para input null', () => {
    expect(formatOrden(null)).toBe(null)
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
