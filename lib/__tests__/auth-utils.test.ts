import { describe, it, expect } from 'vitest'
import { hasInventarioAccess, canCreateOrders } from '../auth-utils'

describe('hasInventarioAccess', () => {
  it('ADMIN accede siempre, con flag apagado o prendido', () => {
    expect(hasInventarioAccess('ADMIN', false)).toBe(true)
    expect(hasInventarioAccess('ADMIN', true)).toBe(true)
  })
  it('VENDEDOR accede solo con el flag de la org prendido', () => {
    expect(hasInventarioAccess('VENDEDOR', true)).toBe(true)
    expect(hasInventarioAccess('VENDEDOR', false)).toBe(false)
  })
  it('TECNICO nunca accede, incluso con flag prendido', () => {
    expect(hasInventarioAccess('TECNICO', true)).toBe(false)
  })
  it('rol nulo/vacío/desconocido nunca accede', () => {
    expect(hasInventarioAccess(null, true)).toBe(false)
    expect(hasInventarioAccess('', true)).toBe(false)
    expect(hasInventarioAccess('admin', true)).toBe(false) // case sensitive
  })
})

describe('canCreateOrders', () => {
  it('retorna true para ADMIN', () => {
    expect(canCreateOrders('ADMIN')).toBe(true)
  })

  it('retorna true para VENDEDOR', () => {
    expect(canCreateOrders('VENDEDOR')).toBe(true)
  })

  it('retorna false para TECNICO', () => {
    expect(canCreateOrders('TECNICO')).toBe(false)
  })

  it('retorna false para null', () => {
    expect(canCreateOrders(null)).toBe(false)
  })

  it('retorna false para string vacio', () => {
    expect(canCreateOrders('')).toBe(false)
  })

  it('retorna false para rol desconocido', () => {
    expect(canCreateOrders('GERENTE')).toBe(false)
  })
})
