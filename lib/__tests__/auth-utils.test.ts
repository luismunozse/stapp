import { describe, it, expect } from 'vitest'
import {
  canManageInventory,
  canCreateOrders,
  isDemoAccount
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

describe('isDemoAccount', () => {
  it('retorna true para emails @demo.com', () => {
    expect(isDemoAccount('admin@demo.com')).toBe(true)
    expect(isDemoAccount('test@demo.com')).toBe(true)
    expect(isDemoAccount('user123@demo.com')).toBe(true)
  })

  it('retorna false para emails normales', () => {
    expect(isDemoAccount('user@gmail.com')).toBe(false)
    expect(isDemoAccount('admin@empresa.com')).toBe(false)
    expect(isDemoAccount('test@hotmail.com')).toBe(false)
  })

  it('retorna false para null', () => {
    expect(isDemoAccount(null)).toBe(false)
  })

  it('retorna false para undefined', () => {
    expect(isDemoAccount(undefined)).toBe(false)
  })

  it('retorna false para string vacio', () => {
    expect(isDemoAccount('')).toBe(false)
  })

  it('no hace match parcial (demo.com.ar)', () => {
    expect(isDemoAccount('user@demo.com.ar')).toBe(false)
  })

  it('no hace match con subdominios de demo.com', () => {
    expect(isDemoAccount('user@sub.demo.com')).toBe(false)
  })

  it('es case sensitive para dominio', () => {
    // endsWith es case sensitive
    expect(isDemoAccount('user@DEMO.COM')).toBe(false)
    expect(isDemoAccount('user@Demo.Com')).toBe(false)
  })
})
