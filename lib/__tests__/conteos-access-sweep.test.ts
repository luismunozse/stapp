import { describe, it, expect } from 'vitest'
import { join } from 'path'
import { handlersDe } from './sweep-utils'

/**
 * Guard arquitectónico, quinto de la familia (pos, inventario, caja,
 * comisiones+suscripciones, y este).
 *
 * Los conteos son inventario: la pantalla vive en
 * `app/(dashboard)/inventario/conteos`. El namespace estaba partido al medio y
 * la mitad abierta era la que escribe — anotar la cantidad contada de un ítem
 * iba por `requireAuth`, así que la escribía cualquier rol autenticado,
 * incluido un TECNICO y un VENDEDOR sin el permiso 275.
 *
 * El corte NO es "todo el namespace es de ADMIN": abrir el conteo, cancelarlo
 * y finalizarlo —lo que ajusta el stock— sí lo son, pero recorrer las góndolas
 * anotando cantidades es trabajo de inventario. Por eso la lista es explícita.
 */

const CONTEOS = join(process.cwd(), 'app', 'api', 'conteos')

/**
 * Operaciones que mueven el conteo como documento y terminan tocando el stock.
 * Son del dueño, no de quien cuenta.
 */
const RESERVADAS_AL_ADMIN = new Set([
  'route.ts::POST',            // abrir un conteo
  '[id]/route.ts::DELETE',     // cancelarlo
  '[id]/finalizar/route.ts::POST', // finalizarlo: aplica los ajustes de stock
])

describe('endpoints de conteos', () => {
  const handlers = handlersDe(CONTEOS)
  const id = (h: { id: string; metodo: string }) => `${h.id}::${h.metodo}`

  it('existen endpoints que auditar', () => {
    expect(handlers.length).toBeGreaterThanOrEqual(7)
  })

  it('lo que abre, cancela y finaliza el conteo sigue siendo del ADMIN', () => {
    const abiertos = handlers
      .filter((h) => RESERVADAS_AL_ADMIN.has(id(h)))
      .filter((h) => !/\brequireAdmin\b/.test(h.body))
      .map(id)
    expect(abiertos).toEqual([])
  })

  it('el resto va por requireInventarioAccess, no por requireAuth', () => {
    const ofensores = handlers
      .filter((h) => !RESERVADAS_AL_ADMIN.has(id(h)))
      .filter((h) => !/\brequireInventarioAccess\b/.test(h.body))
      .map(id)
    expect(ofensores).toEqual([])
  })

  it('ningún handler se quedó en requireAuth', () => {
    const ofensores = handlers
      .filter((h) => /\brequireAuth\s*\(/.test(h.body))
      .map(id)
    expect(ofensores).toEqual([])
  })

  it('la lista de reservadas no quedó apuntando a handlers que ya no existen', () => {
    // Sin esto, renombrar una ruta convierte la excepción en letra muerta y el
    // sweep seguiría en verde sin auditar nada.
    const existentes = new Set(handlers.map(id))
    const fantasmas = [...RESERVADAS_AL_ADMIN].filter((k) => !existentes.has(k))
    expect(fantasmas).toEqual([])
  })
})
