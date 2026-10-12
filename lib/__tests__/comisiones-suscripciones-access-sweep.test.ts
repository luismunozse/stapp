import { describe, it, expect } from 'vitest'
import { join } from 'path'
import { handlersDe } from './sweep-utils'

/**
 * Guard arquitectónico, hermano de pos-access-sweep, inventario-access-sweep y
 * caja-access-sweep.
 *
 * Cubre los dos dominios de plata que salieron del barrido de guards:
 * comisiones de vendedores y facturación de la organización. Los dos estaban
 * detrás de `requireAuth()` a secas, con el id del vendedor viajando en la URL
 * en el caso peor.
 *
 * Lo que este test compra: falla cuando alguien agregue un endpoint NUEVO en
 * estos namespaces con el guard equivocado. Tapar los agujeros de hoy no evita
 * los de mañana; esto sí.
 */

const API = join(process.cwd(), 'app', 'api')

describe('endpoints de vendedores', () => {
  // El namespace entero es del ADMIN: la página /vendedores está en
  // RUTAS_ADMIN y todo lo que cuelga acá —listado, ficha, comisiones,
  // liquidación— es la administración del equipo de ventas.
  //
  // El POS NO depende de estas rutas: usa /api/operadores?rol=VENDEDOR.
  const handlers = handlersDe(join(API, 'vendedores'))

  it('existen endpoints que auditar', () => {
    expect(handlers.length).toBeGreaterThanOrEqual(7)
  })

  it('todos piden requireAdmin', () => {
    const ofensores = handlers
      .filter((h) => !/\brequireAdmin\b/.test(h.body))
      .map((h) => `${h.id} :: ${h.metodo}`)
    expect(ofensores).toEqual([])
  })

  it('ninguno se quedó en requireAuth', () => {
    // El caso real: el POST ya pedía requireAdmin y el GET del MISMO archivo
    // había quedado en requireAuth, así que cualquier rol leía las comisiones
    // de cualquier vendedor cambiando un id en la URL.
    const ofensores = handlers
      .filter((h) => /\brequireAuth\s*\(/.test(h.body))
      .map((h) => `${h.id} :: ${h.metodo}`)
    expect(ofensores).toEqual([])
  })
})

describe('endpoints de suscripción', () => {
  const handlers = [
    ...handlersDe(join(API, 'subscriptions')).map((h) => ({ ...h, id: `subscriptions/${h.id}` })),
    ...handlersDe(join(API, 'subscription')).map((h) => ({ ...h, id: `subscription/${h.id}` })),
  ]

  /**
   * Acá el corte NO es "todo el namespace", y por eso la lista es explícita.
   *
   * Estas dos las consumen TrialCountdownBanner y UsageWarningBanner, montados
   * en `app/(dashboard)/layout.tsx` —el shell de TODOS los roles— y
   * subscription-required-view, que es la pantalla de "se venció tu
   * suscripción". Cerrarlas le mostraría un error al vendedor en lugar de la
   * explicación de por qué no puede trabajar.
   *
   * Son estado de plan, no datos de facturación: `getSubscriptionInfo` ya
   * reduce el `mercadopago_preapproval_id` a un booleano `autoDebito` antes de
   * responder, así que ningún identificador de cobro sale de acá.
   */
  const ABIERTAS_A_TODO_ROL = new Set(['subscriptions/route.ts', 'subscriptions/usage/route.ts'])

  it('existen endpoints que auditar', () => {
    expect(handlers.length).toBeGreaterThanOrEqual(5)
  })

  it('la facturación de la organización es del ADMIN', () => {
    const ofensores = handlers
      .filter((h) => !ABIERTAS_A_TODO_ROL.has(h.id))
      .filter((h) => !/\brequireAdmin\b/.test(h.body))
      .map((h) => `${h.id} :: ${h.metodo}`)
    expect(ofensores).toEqual([])
  })

  it('el estado de plan sigue abierto a todo rol: si no, el vendedor ve un error en vez del aviso', () => {
    const rotas = handlers
      .filter((h) => ABIERTAS_A_TODO_ROL.has(h.id))
      .filter((h) => /\brequireAdmin\b/.test(h.body))
      .map((h) => `${h.id} :: ${h.metodo}`)
    expect(rotas).toEqual([])
  })

  it('la lista de rutas abiertas no quedó apuntando a archivos que ya no existen', () => {
    // Sin esto, renombrar una ruta convierte la excepción en letra muerta y el
    // test seguiría en verde sin auditar nada.
    const ids = new Set(handlers.map((h) => h.id))
    const fantasmas = [...ABIERTAS_A_TODO_ROL].filter((id) => !ids.has(id))
    expect(fantasmas).toEqual([])
  })
})
