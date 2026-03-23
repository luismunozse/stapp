import { describe, it, expect, vi, beforeEach } from 'vitest'
import { supabaseAdmin } from '@/lib/supabase'
import { getOrderByPublicToken } from '../public-token'

describe('getOrderByPublicToken', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rechaza token vacío', async () => {
    const result = await getOrderByPublicToken('')
    expect(result.orden).toBeNull()
    expect(result.error).not.toBeNull()
    const body = await result.error!.json()
    expect(body.error).toBe('Token inválido')
  })

  it('rechaza token con longitud incorrecta', async () => {
    const result = await getOrderByPublicToken('short')
    expect(result.orden).toBeNull()
    expect(result.error).not.toBeNull()
  })

  it('rechaza token de 31 caracteres', async () => {
    const result = await getOrderByPublicToken('a'.repeat(31))
    expect(result.orden).toBeNull()
  })

  it('rechaza token de 33 caracteres', async () => {
    const result = await getOrderByPublicToken('a'.repeat(33))
    expect(result.orden).toBeNull()
  })

  it('retorna 404 cuando orden no existe', async () => {
    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
    }
    vi.mocked(supabaseAdmin.from).mockReturnValue(mockChain as any)

    const token = 'a'.repeat(32)
    const result = await getOrderByPublicToken(token)
    expect(result.orden).toBeNull()
    expect(result.error).not.toBeNull()
    const body = await result.error!.json()
    expect(body.error).toBe('Orden no encontrada')
  })

  it('retorna orden cuando token válido existe', async () => {
    const mockOrden = { id: 'orden-1', organization_id: 'org-1' }
    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: mockOrden, error: null }),
    }
    vi.mocked(supabaseAdmin.from).mockReturnValue(mockChain as any)

    const token = 'a'.repeat(32)
    const result = await getOrderByPublicToken(token)
    expect(result.error).toBeNull()
    expect(result.orden).toEqual(mockOrden)
  })

  it('usa select por defecto "id, organization_id"', async () => {
    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: '1' }, error: null }),
    }
    vi.mocked(supabaseAdmin.from).mockReturnValue(mockChain as any)

    const token = 'a'.repeat(32)
    await getOrderByPublicToken(token)
    expect(mockChain.select).toHaveBeenCalledWith('id, organization_id')
  })

  it('permite select personalizado', async () => {
    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: '1', estado: 'RECIBIDO' }, error: null }),
    }
    vi.mocked(supabaseAdmin.from).mockReturnValue(mockChain as any)

    const token = 'a'.repeat(32)
    const result = await getOrderByPublicToken(token, 'id, estado')
    expect(mockChain.select).toHaveBeenCalledWith('id, estado')
    expect(result.orden.estado).toBe('RECIBIDO')
  })

  it('filtra por public_token', async () => {
    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: '1' }, error: null }),
    }
    vi.mocked(supabaseAdmin.from).mockReturnValue(mockChain as any)

    const token = 'b'.repeat(32)
    await getOrderByPublicToken(token)
    expect(supabaseAdmin.from).toHaveBeenCalledWith('ordenes_servicio')
    expect(mockChain.eq).toHaveBeenCalledWith('public_token', token)
  })

  it('rechaza token público expirado (410 Gone)', async () => {
    const expiredDate = new Date()
    expiredDate.setDate(expiredDate.getDate() - 1)

    const mockOrden = {
      id: 'orden-1',
      organization_id: 'org-1',
      public_token_expires_at: expiredDate.toISOString(),
    }
    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: mockOrden, error: null }),
    }
    vi.mocked(supabaseAdmin.from).mockReturnValue(mockChain as any)

    const token = 'a'.repeat(32)
    const result = await getOrderByPublicToken(token)
    expect(result.orden).toBeNull()
    expect(result.error).not.toBeNull()
    const body = await result.error!.json()
    expect(body.error).toContain('expirado')
  })

  it('permite token público no expirado', async () => {
    const futureDate = new Date()
    futureDate.setDate(futureDate.getDate() + 10)

    const mockOrden = {
      id: 'orden-1',
      organization_id: 'org-1',
      public_token_expires_at: futureDate.toISOString(),
    }
    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: mockOrden, error: null }),
    }
    vi.mocked(supabaseAdmin.from).mockReturnValue(mockChain as any)

    const token = 'a'.repeat(32)
    const result = await getOrderByPublicToken(token)
    expect(result.error).toBeNull()
    expect(result.orden).not.toBeNull()
    expect(result.orden.id).toBe('orden-1')
  })

  it('permite token sin fecha de expiración (null)', async () => {
    const mockOrden = {
      id: 'orden-1',
      organization_id: 'org-1',
      public_token_expires_at: null,
    }
    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: mockOrden, error: null }),
    }
    vi.mocked(supabaseAdmin.from).mockReturnValue(mockChain as any)

    const token = 'a'.repeat(32)
    const result = await getOrderByPublicToken(token)
    expect(result.error).toBeNull()
    expect(result.orden).not.toBeNull()
  })

  it('permite token sin campo public_token_expires_at (migración no ejecutada)', async () => {
    const mockOrden = {
      id: 'orden-1',
      organization_id: 'org-1',
      // Sin public_token_expires_at — columna no existe aún
    }
    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: mockOrden, error: null }),
    }
    vi.mocked(supabaseAdmin.from).mockReturnValue(mockChain as any)

    const token = 'a'.repeat(32)
    const result = await getOrderByPublicToken(token)
    expect(result.error).toBeNull()
    expect(result.orden).not.toBeNull()
  })
})
