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
  formatProveedorContacto,
  formatProveedorAdjunto,
  formatProveedorCatalogoItem,
  formatVenta,
  formatRepuesto,
  precioVentaRepuesto,
} from '../db-utils'

function ventaBase(over: Partial<any> = {}) {
  return {
    id: 'v1',
    numero_venta: 5,
    cliente_id: null,
    cliente_nombre: 'Consumidor Final',
    cliente_telefono: null,
    vendedor_id: null,
    subtotal: '100',
    descuento: '0',
    total: '100',
    monto_abonado: '100',
    estado_pago: 'PAGADO',
    metodo_pago: 'EFECTIVO',
    estado: 'COMPLETADA',
    observaciones: null,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    ...over,
  }
}

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
      aceptaWhatsapp: true,
      saldoCuenta: 0,
      tipoPrecio: 'MINORISTA',
      descuentoPct: null,
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

  it('oculta el costo de los repuestos y el agregado de cotizaciones cuando se lo pide', () => {
    const input = {
      id: 'ord-3',
      repuestos_orden: [
        { id: 'r-1', cantidad: 2, precio_unitario: 50, precio_venta_unitario: 120 },
      ],
      cotizaciones: [
        {
          estado: 'ACEPTADA',
          deleted_at: null,
          items_cotizacion: [{ cantidad: 2, inventario: { precio_compra: 150 } }],
        },
      ],
    }

    const visible = formatOrden(input)
    expect(visible?.repuestos?.[0]?.precioUnitario).toBe(50)
    expect(visible?.costoRepuestosCotizaciones).toBe(300)

    const oculto = formatOrden(input, {
      includeInventarioCost: false,
      includeCotizacionCost: false,
    })
    expect(oculto?.repuestos?.[0]?.precioUnitario).toBeNull()
    expect(oculto?.costoRepuestosCotizaciones).toBeNull()
    // Lo que el rol sí necesita sigue disponible.
    expect(oculto?.repuestos?.[0]?.cantidad).toBe(2)
    expect(oculto?.repuestos?.[0]?.precioVentaUnitario).toBe(120)
  })
})

describe('formatRepuesto / precioVentaRepuesto', () => {
  it('formatRepuesto oculta el costo con includeCost en false', () => {
    const row = { id: 'r-1', cantidad: 1, precio_unitario: 80, precio_venta_unitario: 200 }
    expect(formatRepuesto(row)?.precioUnitario).toBe(80)
    expect(formatRepuesto(row, false)?.precioUnitario).toBeNull()
    expect(formatRepuesto(row, false)?.precioVentaUnitario).toBe(200)
  })

  it('usa el precio de venta cuando existe', () => {
    expect(precioVentaRepuesto({ precioVentaUnitario: 200, precioUnitario: 80 })).toBe(200)
  })

  it('cae al costo en filas anteriores a la migracion 286', () => {
    expect(precioVentaRepuesto({ precioVentaUnitario: null, precioUnitario: 80 })).toBe(80)
  })

  it('devuelve null cuando no queda ningun precio (fila vieja + costo oculto)', () => {
    expect(precioVentaRepuesto({ precioVentaUnitario: null, precioUnitario: null })).toBeNull()
    expect(precioVentaRepuesto({})).toBeNull()
  })

  it('propaga includeCost al inventario embebido', () => {
    const row = {
      id: 'r-1',
      cantidad: 1,
      precio_unitario: 80,
      precio_venta_unitario: 200,
      inventario: { id: 'i-1', precio_compra: 55, precio_venta: 300, stock: 4 },
    }
    expect(formatRepuesto(row)?.inventario?.precioCompra).toBe(55)
    expect(formatRepuesto(row, false)?.inventario?.precioCompra).toBeNull()
    // Lo que no es costo sigue disponible en el embed.
    expect(formatRepuesto(row, false)?.inventario?.precioVenta).toBe(300)
    expect(formatRepuesto(row, false)?.inventario?.stock).toBe(4)
  })
})

describe('formatInventario', () => {
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

  it('formatea item de inventario', () => {
    const result = formatInventario(input, true)
    expect(result?.tipoDispositivo).toBe('CELULAR')
    expect(result?.precioCompra).toBe(5000)
    expect(result?.precioVenta).toBe(8000)
    expect(result?.organizationId).toBe('org-1')
    expect(result?.codigo).toBe('PROD001')
  })

  // Default-safe: quien no pide el costo explícitamente no lo recibe. Un caller
  // nuevo que se olvide del gate pierde el costo (bug visible) en vez de
  // filtrarlo a un rol sin permiso (bug silencioso).
  it('oculta precioCompra cuando el caller no lo pide', () => {
    const result = formatInventario(input)
    expect(result?.precioCompra).toBeNull()
    // Lo que no es costo no cambia.
    expect(result?.precioVenta).toBe(8000)
    expect(result?.stock).toBe(10)
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

  it('formatea campos fiscales (AR)', () => {
    const result = formatProveedor({
      id: 'p',
      nombre: 'X',
      activo: true,
      organization_id: 'o',
      razon_social: 'Razón SA',
      cuit: '30-12345678-9',
      condicion_iva: 'RESPONSABLE_INSCRIPTO',
      ingresos_brutos: '123',
      condicion_pago: 'CTA_CTE',
      dias_pago: 30,
    })
    expect(result?.razonSocial).toBe('Razón SA')
    expect(result?.cuit).toBe('30-12345678-9')
    expect(result?.condicionIva).toBe('RESPONSABLE_INSCRIPTO')
    expect(result?.ingresosBrutos).toBe('123')
    expect(result?.condicionPago).toBe('CTA_CTE')
    expect(result?.diasPago).toBe(30)
  })

  it('formatea campos operativos + clasificación + logo', () => {
    const result = formatProveedor({
      id: 'p',
      nombre: 'X',
      activo: true,
      organization_id: 'o',
      lead_time_dias: 7,
      pedido_minimo: '12500.50',
      rating: 4,
      tags: ['mayorista', 'repuestos'],
      logo_url: 'https://cdn/test.png',
      logo_path: 'path/to/logo.png',
    })
    expect(result?.leadTimeDias).toBe(7)
    expect(result?.pedidoMinimo).toBe(12500.5)
    expect(result?.rating).toBe(4)
    expect(result?.tags).toEqual(['mayorista', 'repuestos'])
    expect(result?.logoUrl).toBe('https://cdn/test.png')
    expect(result?.logoPath).toBe('path/to/logo.png')
  })

  it('null para campos opcionales no cargados', () => {
    const result = formatProveedor({
      id: 'p',
      nombre: 'X',
      activo: true,
      organization_id: 'o',
    })
    expect(result?.razonSocial).toBe(null)
    expect(result?.diasPago).toBe(null)
    expect(result?.leadTimeDias).toBe(null)
    expect(result?.pedidoMinimo).toBe(null)
    expect(result?.rating).toBe(null)
    expect(result?.tags).toBe(null)
    expect(result?.logoUrl).toBe(null)
  })
})

describe('formatProveedorContacto', () => {
  it('retorna null para input null', () => {
    expect(formatProveedorContacto(null)).toBe(null)
  })

  it('formatea contacto completo', () => {
    const result = formatProveedorContacto({
      id: 'c1',
      proveedor_id: 'p1',
      nombre: 'Juan',
      cargo: 'Ventas',
      telefono: '111',
      whatsapp: '5491111',
      email: 'j@x.com',
      notas: 'Solo mañanas',
      principal: true,
      created_at: '2026-01-01',
      updated_at: '2026-01-02',
    })
    expect(result?.id).toBe('c1')
    expect(result?.proveedorId).toBe('p1')
    expect(result?.nombre).toBe('Juan')
    expect(result?.cargo).toBe('Ventas')
    expect(result?.principal).toBe(true)
  })

  it('default principal = false si no está', () => {
    const result = formatProveedorContacto({
      id: 'c1', proveedor_id: 'p1', nombre: 'X',
    })
    expect(result?.principal).toBe(false)
  })

  it('null para campos opcionales vacíos', () => {
    const result = formatProveedorContacto({
      id: 'c1', proveedor_id: 'p1', nombre: 'X', principal: false,
    })
    expect(result?.cargo).toBe(null)
    expect(result?.telefono).toBe(null)
    expect(result?.email).toBe(null)
  })
})

describe('formatProveedorAdjunto', () => {
  it('retorna null para input null', () => {
    expect(formatProveedorAdjunto(null)).toBe(null)
  })

  it('formatea adjunto y convierte size a number', () => {
    const result = formatProveedorAdjunto({
      id: 'a1',
      proveedor_id: 'p1',
      nombre: 'Lista abril',
      descripcion: 'PDF lista',
      file_url: 'https://x/a',
      file_path: 'path/a',
      mime: 'application/pdf',
      size_bytes: '123456',
      uploaded_by: 'u1',
      created_at: '2026-01-01',
    })
    expect(result?.id).toBe('a1')
    expect(result?.proveedorId).toBe('p1')
    expect(result?.fileUrl).toBe('https://x/a')
    expect(result?.filePath).toBe('path/a')
    expect(result?.sizeBytes).toBe(123456)
    expect(typeof result?.sizeBytes).toBe('number')
  })
})

describe('formatProveedorCatalogoItem', () => {
  it('retorna null para input null', () => {
    expect(formatProveedorCatalogoItem(null)).toBe(null)
  })

  it('formatea item con inventario vinculado', () => {
    const result = formatProveedorCatalogoItem({
      id: 'i1',
      proveedor_id: 'p1',
      inventario_id: 'inv1',
      codigo_proveedor: 'SKU-123',
      nombre: 'Producto X',
      descripcion: 'desc',
      precio_referencia: '999.99',
      moneda: 'ARS',
      unidad: 'caja',
      notas: null,
      precio_actualizado_at: '2026-01-15',
      inventario: { id: 'inv1', codigo: 'COD-1', nombre: 'Item inv' },
      created_at: '2026-01-01',
      updated_at: '2026-01-15',
    })
    expect(result?.id).toBe('i1')
    expect(result?.codigoProveedor).toBe('SKU-123')
    expect(result?.precioReferencia).toBe(999.99)
    expect(result?.moneda).toBe('ARS')
    expect(result?.unidad).toBe('caja')
    expect(result?.inventarioId).toBe('inv1')
    expect(result?.inventario?.codigo).toBe('COD-1')
    expect(result?.precioActualizadoAt).toBe('2026-01-15')
  })

  it('moneda default ARS si null', () => {
    const result = formatProveedorCatalogoItem({
      id: 'i1', proveedor_id: 'p1', nombre: 'X',
    })
    expect(result?.moneda).toBe('ARS')
    expect(result?.precioReferencia).toBe(null)
    expect(result?.inventario).toBe(null)
  })
})

describe('formatVenta — facturaId from facturas embed', () => {
  it('retorna null para input null', () => {
    expect(formatVenta(null)).toBe(null)
  })

  it('facturaId null cuando no hay factura (array vacío)', () => {
    const result = formatVenta(ventaBase({ facturas: [] }))
    expect(result?.facturaId).toBe(null)
  })

  it('facturaId toma el id cuando facturas es un array (shape normal)', () => {
    const result = formatVenta(ventaBase({ facturas: [{ id: 'f1' }] }))
    expect(result?.facturaId).toBe('f1')
  })

  it('facturaId toma el id cuando facturas viene como objeto (PostgREST one-to-one embed)', () => {
    // facturas (id) is a reverse embed over the UNIQUE venta_id FK — PostgREST
    // one-to-one detection can return it as a bare object instead of an
    // array. Without normalizing, facturaId stays null and the "Generar
    // factura" button never hides for an already-invoiced venta.
    const result = formatVenta(ventaBase({ facturas: { id: 'f1' } }))
    expect(result?.facturaId).toBe('f1')
  })

  // Las ventas embeben `inventario (*)`, que trae precio_compra. Ningún
  // consumidor de /api/ventas lee ese costo, así que el embed no lo pide.
  it('no expone el costo de compra del inventario embebido en los items', () => {
    const result = formatVenta(ventaBase({
      items_venta: [{
        id: 'iv1',
        inventario_id: 'inv1',
        descripcion: 'Pantalla',
        cantidad: 1,
        precio_unitario: '100',
        subtotal: '100',
        inventario: { id: 'inv1', codigo: 'C1', precio_compra: 40, precio_venta: 100 },
      }],
    }))
    expect(result?.items?.[0]?.inventario?.precioCompra).toBeNull()
    expect(result?.items?.[0]?.inventario?.codigo).toBe('C1')
  })
})
