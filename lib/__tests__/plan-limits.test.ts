import { describe, it, expect } from 'vitest'
import { LIMIT_MESSAGES, type LimitType } from '../plan-limits'

describe('LIMIT_MESSAGES', () => {
  it('tiene mensajes para todos los tipos de límite', () => {
    const tipos: LimitType[] = ['ordenes', 'tecnicos', 'clientes', 'vendedores']
    tipos.forEach((tipo) => {
      expect(LIMIT_MESSAGES[tipo]).toBeDefined()
      expect(LIMIT_MESSAGES[tipo].title).toBeDefined()
      expect(LIMIT_MESSAGES[tipo].description).toBeDefined()
      expect(LIMIT_MESSAGES[tipo].action).toBeDefined()
    })
  })

  it('mensajes de ordenes son correctos', () => {
    expect(LIMIT_MESSAGES.ordenes.title).toContain('órdenes')
    expect(LIMIT_MESSAGES.ordenes.description).toContain('mensual')
    expect(LIMIT_MESSAGES.ordenes.action).toContain('Premium')
  })

  it('mensajes de tecnicos son correctos', () => {
    expect(LIMIT_MESSAGES.tecnicos.title).toContain('técnicos')
    expect(LIMIT_MESSAGES.tecnicos.action).toContain('Premium')
  })

  it('mensajes de clientes son correctos', () => {
    expect(LIMIT_MESSAGES.clientes.title).toContain('clientes')
    expect(LIMIT_MESSAGES.clientes.action).toContain('Premium')
  })

  it('mensajes de vendedores son correctos', () => {
    expect(LIMIT_MESSAGES.vendedores.title).toContain('vendedores')
    expect(LIMIT_MESSAGES.vendedores.action).toContain('Premium')
  })

  it('todos los mensajes tienen la acción de upgrade', () => {
    Object.values(LIMIT_MESSAGES).forEach((msg) => {
      expect(msg.action).toContain('Premium')
      expect(msg.action).toContain('Actualiza')
    })
  })

  it('todos los mensajes tienen title no vacío', () => {
    Object.values(LIMIT_MESSAGES).forEach((msg) => {
      expect(msg.title.length).toBeGreaterThan(0)
      expect(msg.description.length).toBeGreaterThan(0)
      expect(msg.action.length).toBeGreaterThan(0)
    })
  })

  it('todos los títulos mencionan "alcanzado"', () => {
    Object.values(LIMIT_MESSAGES).forEach((msg) => {
      expect(msg.title).toContain('alcanzado')
    })
  })

  it('todas las descripciones mencionan "plan"', () => {
    Object.values(LIMIT_MESSAGES).forEach((msg) => {
      expect(msg.description).toContain('plan')
    })
  })
})
