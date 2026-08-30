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
    // /tecnicos salio de esta lista: ver el caso de "Mi desempeño" mas abajo.
    for (const ruta of ['/configuracion', '/finanzas', '/emails', '/vendedores', '/facturacion']) {
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

  it('el tecnico entra a /tecnicos: es su propia pantalla de "Mi desempeño"', () => {
    // El navbar le ofrece "Mi desempeño" apuntando a /tecnicos, y toda la
    // pantalla existe: app/(dashboard)/tecnicos/page.tsx lo redirige a
    // /tecnicos/<su-id>, la ficha calcula `isSelf`/`canView` y saca al que mira
    // una ajena, y GET /api/tecnicos/[id] va por requireAdminOrSelf.
    //
    // Estaba TODO muerto en produccion porque /tecnicos vivia en RUTAS_ADMIN:
    // el middleware lo rebotaba al panel antes de que nada de eso corriera.
    expect(redirigirPorRol('/tecnicos', 'TECNICO')).toBe(false)
    expect(redirigirPorRol('/tecnicos/abc123', 'TECNICO')).toBe(false)
    expect(redirigirPorRol('/tecnicos', 'ADMIN')).toBe(false)
  })

  it('abrirle /tecnicos al tecnico no se lo abre a nadie mas', () => {
    // El VENDEDOR no tiene pantalla propia ahi y el rol desconocido tampoco.
    expect(redirigirPorRol('/tecnicos', 'VENDEDOR')).toBe(true)
    expect(redirigirPorRol('/tecnicos', 'GERENTE')).toBe(true)
    expect(redirigirPorRol('/tecnicos', null)).toBe(true)
  })

  it('/caja ya no es tierra de nadie: el tecnico y un rol desconocido quedan afuera', () => {
    // Hueco preexistente: el navbar mostraba Caja solo al ADMIN pero el
    // middleware nunca freno la ruta, asi que cualquier rol autenticado que
    // escribiera /caja en la URL entraba y veia los totales del dia.
    expect(redirigirPorRol('/caja', 'TECNICO')).toBe(true)
    expect(redirigirPorRol('/caja', 'GERENTE')).toBe(true)
    expect(redirigirPorRol('/caja', null)).toBe(true)
  })

  it('el vendedor llega a /caja: el flag lo chequea el servidor, no el Edge', () => {
    // Mismo reparto que /pos y /inventario: el Edge abre la puerta gruesa
    // porque no puede leer `vendedores_manejan_caja`, y la pagina y la API
    // deciden de verdad.
    expect(redirigirPorRol('/caja', 'VENDEDOR')).toBe(false)
    expect(redirigirPorRol('/caja', 'ADMIN')).toBe(false)
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
