import { describe, it, expect } from 'vitest'
import { join } from 'path'
import { handlersDe } from './sweep-utils'

/**
 * Guard arquitectónico, sexto de la familia (pos, inventario, caja,
 * comisiones+suscripciones, conteos, y este).
 *
 * Proveedores es el caso más nítido del patrón que se repitió en todo el
 * barrido: TODAS las escrituras del namespace ya iban por
 * `requireAdminOrVendedor` y ninguna lectura volvió a revisarse. El archivo ya
 * tenía el guard correcto importado y usado unas líneas más abajo.
 *
 * Son dos ejes independientes:
 *   - quién ve proveedores         -> ADMIN + VENDEDOR (este sweep)
 *   - quién ve el precio de compra -> hasInventarioAccess, adentro de los
 *                                     handlers de costo (no lo cubre este test)
 */

const PROVEEDORES = join(process.cwd(), 'app', 'api', 'proveedores')

/** Borrar un proveedor es del dueño, no de quien lo carga. */
const RESERVADAS_AL_ADMIN = new Set(['[id]/route.ts::DELETE'])

describe('endpoints de proveedores', () => {
  const handlers = handlersDe(PROVEEDORES)
  const id = (h: { id: string; metodo: string }) => `${h.id}::${h.metodo}`

  it('existen endpoints que auditar', () => {
    expect(handlers.length).toBeGreaterThanOrEqual(20)
  })

  it('ningún handler se quedó en requireAuth', () => {
    // El agujero real: ocho lecturas con requireAuth mientras el POST de al
    // lado, en el mismo route.ts, ya pedía requireAdminOrVendedor.
    const ofensores = handlers
      .filter((h) => /\brequireAuth\s*\(/.test(h.body))
      .map(id)
    expect(ofensores).toEqual([])
  })

  it('borrar un proveedor sigue siendo del ADMIN', () => {
    const abiertos = handlers
      .filter((h) => RESERVADAS_AL_ADMIN.has(id(h)))
      .filter((h) => !/\brequireAdmin\b/.test(h.body))
      .map(id)
    expect(abiertos).toEqual([])
  })

  it('todo el resto va por requireAdminOrVendedor', () => {
    const ofensores = handlers
      .filter((h) => !RESERVADAS_AL_ADMIN.has(id(h)))
      .filter((h) => !/\brequireAdminOrVendedor\b/.test(h.body))
      .map(id)
    expect(ofensores).toEqual([])
  })

  it('la lista de reservadas no quedó apuntando a handlers que ya no existen', () => {
    const existentes = new Set(handlers.map(id))
    const fantasmas = [...RESERVADAS_AL_ADMIN].filter((k) => !existentes.has(k))
    expect(fantasmas).toEqual([])
  })
})
