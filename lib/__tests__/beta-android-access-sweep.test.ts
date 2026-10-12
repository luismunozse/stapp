import { describe, it, expect } from 'vitest'
import { join } from 'path'
import { handlersDe } from './sweep-utils'
import { redirigirPorRol } from '../rutas-por-rol'

/**
 * Guard arquitectónico de la beta de Android, hermano de los *-access-sweep.
 *
 * Dos namespaces con reglas OPUESTAS que se rompen en silencio.
 *
 * /api/beta-android: cualquier usuario autenticado, de cualquier rol. Si
 * alguien le pone requireAdmin "por las dudas", el TECNICO y el VENDEDOR dejan
 * de poder anotarse y nadie se entera.
 *
 * /api/superadmin/beta-android: solo superadmin. Trae los correos de usuarios
 * de TODOS los talleres; con requireAuth a secas los leería cualquier cliente.
 */

const API = join(process.cwd(), 'app', 'api')
const ROLES = ['ADMIN', 'TECNICO', 'VENDEDOR']

describe('/api/beta-android (cualquier rol autenticado)', () => {
  const handlers = handlersDe(join(API, 'beta-android'))

  it('existen endpoints que auditar', () => {
    expect(handlers.length).toBeGreaterThanOrEqual(2)
  })

  it('todos piden requireAuth', () => {
    const ofensores = handlers
      .filter((h) => !/\brequireAuth\s*\(/.test(h.body))
      .map((h) => `${h.id} :: ${h.metodo}`)
    expect(ofensores).toEqual([])
  })

  it('ninguno restringe por rol', () => {
    const ofensores = handlers
      .filter((h) => /\b(requireAdmin|requireAdminOrSelf|requireRole|requireSuperadmin|requirePosAccess)\b/.test(h.body))
      .map((h) => `${h.id} :: ${h.metodo}`)
    expect(ofensores).toEqual([])
  })

  it.each(ROLES)('el middleware no saca a un %s de la ruta', (rol) => {
    expect(redirigirPorRol('/api/beta-android', rol)).toBe(false)
  })
})

describe('/api/superadmin/beta-android (solo superadmin)', () => {
  const handlers = handlersDe(join(API, 'superadmin', 'beta-android'))

  it('existen endpoints que auditar', () => {
    expect(handlers.length).toBeGreaterThanOrEqual(3)
  })

  it('todos piden requireSuperadmin', () => {
    const ofensores = handlers
      .filter((h) => !/\brequireSuperadmin\s*\(/.test(h.body))
      .map((h) => `${h.id} :: ${h.metodo}`)
    expect(ofensores).toEqual([])
  })

  it('ninguno se quedó en requireAuth', () => {
    const ofensores = handlers
      .filter((h) => /\brequireAuth\s*\(/.test(h.body))
      .map((h) => `${h.id} :: ${h.metodo}`)
    expect(ofensores).toEqual([])
  })
})
