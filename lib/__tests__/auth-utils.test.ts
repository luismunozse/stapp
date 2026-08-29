import { describe, it, expect } from 'vitest'
import { hasInventarioAccess, hasPosAccess, soloVeSusVentas, canCreateOrders } from '../auth-utils'

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

describe('hasPosAccess', () => {
  it('ADMIN opera el POS siempre, con flag apagado o prendido', () => {
    expect(hasPosAccess('ADMIN', false)).toBe(true)
    expect(hasPosAccess('ADMIN', true)).toBe(true)
  })
  it('VENDEDOR opera el POS siempre: es su rol, no depende del flag', () => {
    expect(hasPosAccess('VENDEDOR', false)).toBe(true)
    expect(hasPosAccess('VENDEDOR', true)).toBe(true)
  })
  it('TECNICO opera el POS solo con el flag de la org prendido', () => {
    expect(hasPosAccess('TECNICO', true)).toBe(true)
    expect(hasPosAccess('TECNICO', false)).toBe(false)
  })
  it('rol nulo/vacío/desconocido nunca opera el POS', () => {
    expect(hasPosAccess(null, true)).toBe(false)
    expect(hasPosAccess('', true)).toBe(false)
    expect(hasPosAccess('tecnico', true)).toBe(false) // case sensitive
    expect(hasPosAccess('GERENTE', true)).toBe(false)
  })
})

describe('soloVeSusVentas', () => {
  it('ADMIN ve las ventas de toda la sucursal', () => {
    expect(soloVeSusVentas('ADMIN')).toBe(false)
  })
  it('VENDEDOR ve solo las suyas', () => {
    expect(soloVeSusVentas('VENDEDOR')).toBe(true)
  })
  it('TECNICO habilitado en el POS ve solo las suyas, igual que el vendedor', () => {
    expect(soloVeSusVentas('TECNICO')).toBe(true)
  })
  it('cualquier rol que no sea ADMIN queda acotado a lo suyo', () => {
    // Fail-closed ante un rol futuro: el default es ver menos, no ver todo.
    expect(soloVeSusVentas('GERENTE')).toBe(true)
    expect(soloVeSusVentas(null)).toBe(true)
  })
})
