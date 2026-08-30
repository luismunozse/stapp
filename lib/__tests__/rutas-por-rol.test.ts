import { describe, it, expect } from 'vitest'
import { redirigirPorRol } from '../rutas-por-rol'

/**
 * El middleware corre en el Edge con el JWT y nada más: NO puede leer la BD,
 * así que no puede saber si la org habilitó `tecnicos_operan_pos`.
 *
 * Por eso deja pasar al técnico a /pos y /ventas a nivel de ruta, y el permiso
 * fino lo resuelven la página y la API, que sí leen el flag. Es el mismo
 * reparto que ya existe para VENDEDOR en /inventario: el middleware abre la
 * puerta gruesa, el servidor decide de verdad.
 */
describe('redirigirPorRol', () => {
  it('deja pasar cualquier ruta no protegida', () => {
    expect(redirigirPorRol('/dashboard', 'TECNICO')).toBe(false)
    expect(redirigirPorRol('/ordenes', 'VENDEDOR')).toBe(false)
  })

  it('las rutas admin-only siguen siendo admin-only', () => {
    for (const ruta of ['/configuracion', '/finanzas', '/emails', '/tecnicos', '/vendedores', '/facturacion']) {
      expect(redirigirPorRol(ruta, 'TECNICO')).toBe(true)
      expect(redirigirPorRol(ruta, 'VENDEDOR')).toBe(true)
      expect(redirigirPorRol(ruta, 'ADMIN')).toBe(false)
    }
  })

  it('el técnico llega a /pos y /ventas: el flag lo chequea el servidor, no el Edge', () => {
    for (const ruta of ['/pos', '/ventas', '/ventas/abc123']) {
      expect(redirigirPorRol(ruta, 'TECNICO')).toBe(false)
    }
  })

  it('el flag no le abre al técnico el resto de lo que es de vendedor', () => {
    for (const ruta of ['/reportes', '/proveedores', '/inventario']) {
      expect(redirigirPorRol(ruta, 'TECNICO')).toBe(true)
    }
  })

  it('el vendedor y el admin no pierden nada', () => {
    for (const ruta of ['/pos', '/ventas', '/reportes', '/proveedores', '/inventario']) {
      expect(redirigirPorRol(ruta, 'VENDEDOR')).toBe(false)
      expect(redirigirPorRol(ruta, 'ADMIN')).toBe(false)
    }
  })

  it('/comisiones es admin-only: el navbar ya lo trataba asi, el middleware no', () => {
    // La pantalla es la liquidacion de comisiones de tecnicos y vendedores.
    // El navbar la mostraba solo al ADMIN, pero cualquier rol entraba
    // escribiendo la URL y desde ahi pegaba a las APIs de vendedores.
    expect(redirigirPorRol('/comisiones', 'TECNICO')).toBe(true)
    expect(redirigirPorRol('/comisiones', 'VENDEDOR')).toBe(true)
    expect(redirigirPorRol('/comisiones', 'GERENTE')).toBe(true)
    expect(redirigirPorRol('/comisiones', 'ADMIN')).toBe(false)
  })

  it('matchea por segmento, no por prefijo de string', () => {
    // /posventa no es /pos. Un prefijo crudo lo trataria como tal.
    expect(redirigirPorRol('/posventa', 'TECNICO')).toBe(false)
    expect(redirigirPorRol('/configuraciones-varias', 'TECNICO')).toBe(false)
  })

  it('un rol desconocido no entra a ninguna ruta protegida', () => {
    for (const ruta of ['/pos', '/ventas', '/reportes', '/configuracion']) {
      expect(redirigirPorRol(ruta, 'GERENTE')).toBe(true)
    }
  })
})
