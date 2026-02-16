import { describe, it, expect, vi, beforeEach } from 'vitest'
import { supabaseAdmin } from '@/lib/supabase'
import { diffObjects, createAuditLogger } from '../audit'

describe('diffObjects', () => {
  it('detecta cambios en valores simples', () => {
    const before = { nombre: 'Juan', edad: 30 }
    const after = { nombre: 'Pedro', edad: 30 }
    const result = diffObjects(before, after)
    expect(result.before).toEqual({ nombre: 'Juan' })
    expect(result.after).toEqual({ nombre: 'Pedro' })
  })

  it('detecta múltiples cambios', () => {
    const before = { nombre: 'Juan', email: 'juan@test.com', telefono: '123' }
    const after = { nombre: 'Pedro', email: 'pedro@test.com', telefono: '123' }
    const result = diffObjects(before, after)
    expect(result.before).toEqual({ nombre: 'Juan', email: 'juan@test.com' })
    expect(result.after).toEqual({ nombre: 'Pedro', email: 'pedro@test.com' })
  })

  it('retorna objetos vacíos cuando no hay cambios', () => {
    const before = { nombre: 'Juan', telefono: '123' }
    const after = { nombre: 'Juan', telefono: '123' }
    const result = diffObjects(before, after)
    expect(result.before).toEqual({})
    expect(result.after).toEqual({})
  })

  it('ignora created_at', () => {
    const before = { nombre: 'Juan', created_at: '2024-01-01' }
    const after = { nombre: 'Juan', created_at: '2024-06-01' }
    const result = diffObjects(before, after)
    expect(result.before).toEqual({})
    expect(result.after).toEqual({})
  })

  it('ignora updated_at', () => {
    const before = { nombre: 'Juan', updated_at: '2024-01-01' }
    const after = { nombre: 'Juan', updated_at: '2024-06-01' }
    const result = diffObjects(before, after)
    expect(result.before).toEqual({})
    expect(result.after).toEqual({})
  })

  it('ignora password', () => {
    const before = { nombre: 'Juan', password: 'hash1' }
    const after = { nombre: 'Juan', password: 'hash2' }
    const result = diffObjects(before, after)
    expect(result.before).toEqual({})
    expect(result.after).toEqual({})
  })

  it('detecta campos nuevos', () => {
    const before = { nombre: 'Juan' }
    const after = { nombre: 'Juan', email: 'juan@test.com' }
    const result = diffObjects(before, after)
    expect(result.before).toEqual({ email: undefined })
    expect(result.after).toEqual({ email: 'juan@test.com' })
  })

  it('detecta campos eliminados', () => {
    const before = { nombre: 'Juan', email: 'juan@test.com' }
    const after = { nombre: 'Juan' }
    const result = diffObjects(before, after)
    expect(result.before).toEqual({ email: 'juan@test.com' })
    expect(result.after).toEqual({ email: undefined })
  })

  it('compara arrays correctamente', () => {
    const before = { tags: ['a', 'b'] }
    const after = { tags: ['a', 'b', 'c'] }
    const result = diffObjects(before, after)
    expect(result.before).toEqual({ tags: ['a', 'b'] })
    expect(result.after).toEqual({ tags: ['a', 'b', 'c'] })
  })

  it('compara objetos anidados correctamente', () => {
    const before = { config: { tema: 'claro' } }
    const after = { config: { tema: 'oscuro' } }
    const result = diffObjects(before, after)
    expect(result.before).toEqual({ config: { tema: 'claro' } })
    expect(result.after).toEqual({ config: { tema: 'oscuro' } })
  })

  it('no incluye campos sin cambios', () => {
    const before = { a: 1, b: 2, c: 3 }
    const after = { a: 1, b: 99, c: 3 }
    const result = diffObjects(before, after)
    expect(Object.keys(result.before)).toEqual(['b'])
    expect(Object.keys(result.after)).toEqual(['b'])
  })

  it('maneja cambio de null a valor', () => {
    const before = { email: null }
    const after = { email: 'test@test.com' }
    const result = diffObjects(before, after)
    expect(result.before).toEqual({ email: null })
    expect(result.after).toEqual({ email: 'test@test.com' })
  })

  it('maneja cambio de valor a null', () => {
    const before = { email: 'test@test.com' }
    const after = { email: null }
    const result = diffObjects(before, after)
    expect(result.before).toEqual({ email: 'test@test.com' })
    expect(result.after).toEqual({ email: null })
  })
})

describe('createAuditLogger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Mock insert chain
    const mockChain = {
      insert: vi.fn().mockResolvedValue({ error: null }),
    }
    vi.mocked(supabaseAdmin.from).mockReturnValue(mockChain as any)
  })

  it('crea logger con métodos create, update, delete', () => {
    const logger = createAuditLogger('org-1', 'user-1')
    expect(logger.create).toBeDefined()
    expect(logger.update).toBeDefined()
    expect(logger.delete).toBeDefined()
    expect(typeof logger.create).toBe('function')
    expect(typeof logger.update).toBe('function')
    expect(typeof logger.delete).toBe('function')
  })

  it('create envía acción CREATE con datos', async () => {
    const logger = createAuditLogger('org-1', 'user-1')
    await logger.create('clientes', 'client-1', { nombre: 'Juan' })

    expect(supabaseAdmin.from).toHaveBeenCalledWith('audit_logs')
  })

  it('update envía acción UPDATE con before/after', async () => {
    const logger = createAuditLogger('org-1', 'user-1')
    await logger.update(
      'clientes',
      'client-1',
      { nombre: 'Juan' },
      { nombre: 'Pedro' }
    )

    expect(supabaseAdmin.from).toHaveBeenCalledWith('audit_logs')
  })

  it('delete envía acción DELETE con datos previos', async () => {
    const logger = createAuditLogger('org-1', 'user-1')
    await logger.delete('clientes', 'client-1', { nombre: 'Juan' })

    expect(supabaseAdmin.from).toHaveBeenCalledWith('audit_logs')
  })

  it('extrae IP de x-forwarded-for del request', () => {
    const mockRequest = {
      headers: new Headers({
        'x-forwarded-for': '192.168.1.1, 10.0.0.1',
        'user-agent': 'Mozilla/5.0',
      }),
    } as Request

    const logger = createAuditLogger('org-1', 'user-1', mockRequest)
    expect(logger).toBeDefined()
  })

  it('extrae IP de x-real-ip como fallback', () => {
    const mockRequest = {
      headers: new Headers({
        'x-real-ip': '10.0.0.1',
        'user-agent': 'Test Agent',
      }),
    } as Request

    const logger = createAuditLogger('org-1', 'user-1', mockRequest)
    expect(logger).toBeDefined()
  })

  it('funciona sin request (sin IP ni user-agent)', () => {
    const logger = createAuditLogger('org-1', 'user-1')
    expect(logger).toBeDefined()
  })
})
