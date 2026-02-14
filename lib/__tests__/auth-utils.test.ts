import { describe, it, expect } from 'vitest'
import {
  canManageInventory,
  canCreateOrders
} from '../auth-utils'

describe('canManageInventory', () => {
  it('retorna true solo para ADMIN', () => {
    expect(canManageInventory('ADMIN')).toBe(true)
  })

  it('retorna false para TECNICO', () => {
    expect(canManageInventory('TECNICO')).toBe(false)
  })

  it('retorna false para VENDEDOR', () => {
    expect(canManageInventory('VENDEDOR')).toBe(false)
  })

  it('retorna false para null', () => {
    expect(canManageInventory(null)).toBe(false)
  })

  it('retorna false para string vacio', () => {
    expect(canManageInventory('')).toBe(false)
  })

  it('retorna false para rol desconocido', () => {
    expect(canManageInventory('OTRO')).toBe(false)
    expect(canManageInventory('admin')).toBe(false) // case sensitive
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
