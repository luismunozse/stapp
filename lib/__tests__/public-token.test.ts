import { describe, it, expect, vi, beforeEach } from 'vitest'
import { supabaseAdmin } from '@/lib/supabase'
import { getOrderByPublicToken } from '../public-token'

// Helper: build a full mock chain that includes every method the source calls.
// The chain is: .from() -> .select() -> .eq() -> .not() -> .single()
function makeMockChain(singleResult: { data: unknown; error: unknown }) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(singleResult),
  }
  return chain
}

// A valid 32-char hex-like token used across most tests.
const VALID_TOKEN = 'a'.repeat(32)

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
    const mockChain = makeMockChain({ data: null, error: { code: 'PGRST116' } })
    vi.mocked(supabaseAdmin.from).mockReturnValue(mockChain as any)

    const result = await getOrderByPublicToken(VALID_TOKEN)
    expect(result.orden).toBeNull()
    expect(result.error).not.toBeNull()
    const body = await result.error!.json()
    expect(body.error).toBe('Orden no encontrada')
  })

  it('retorna orden cuando token válido existe', async () => {
    // public_token must be present and match the token passed in so the
    // timing-safe comparison succeeds.
    const mockOrden = {
      id: 'orden-1',
      organization_id: 'org-1',
      public_token: VALID_TOKEN,
      public_token_expires_at: null,
    }
    const mockChain = makeMockChain({ data: mockOrden, error: null })
    vi.mocked(supabaseAdmin.from).mockReturnValue(mockChain as any)

    const result = await getOrderByPublicToken(VALID_TOKEN)
    expect(result.error).toBeNull()
    expect(result.orden).toEqual(mockOrden)
  })

  it('usa select por defecto con columnas de seguridad requeridas', async () => {
    const mockOrden = {
      id: '1',
      organization_id: 'org-1',
      public_token: VALID_TOKEN,
      public_token_expires_at: null,
    }
    const mockChain = makeMockChain({ data: mockOrden, error: null })
    vi.mocked(supabaseAdmin.from).mockReturnValue(mockChain as any)

    await getOrderByPublicToken(VALID_TOKEN)
    // Source always prepends required security columns when no extra select is given.
    expect(mockChain.select).toHaveBeenCalledWith(
      'id, organization_id, public_token, public_token_expires_at'
    )
  })

  it('permite select personalizado — columnas de seguridad se anteponen', async () => {
    const mockOrden = {
      id: '1',
      organization_id: 'org-1',
      public_token: VALID_TOKEN,
      public_token_expires_at: null,
      estado: 'RECIBIDO',
    }
    const mockChain = makeMockChain({ data: mockOrden, error: null })
    vi.mocked(supabaseAdmin.from).mockReturnValue(mockChain as any)

    const result = await getOrderByPublicToken(VALID_TOKEN, 'estado')
    // Source builds: requiredCols + ", " + caller's select
    expect(mockChain.select).toHaveBeenCalledWith(
      'id, organization_id, public_token, public_token_expires_at, estado'
    )
    expect(result.orden?.estado).toBe('RECIBIDO')
  })

  it('filtra por public_token y llama .not() para excluir nulls', async () => {
    const token = 'b'.repeat(32)
    const mockOrden = {
      id: '1',
      organization_id: 'org-1',
      public_token: token,
      public_token_expires_at: null,
    }
    const mockChain = makeMockChain({ data: mockOrden, error: null })
    vi.mocked(supabaseAdmin.from).mockReturnValue(mockChain as any)

    await getOrderByPublicToken(token)
    expect(supabaseAdmin.from).toHaveBeenCalledWith('ordenes_servicio')
    expect(mockChain.eq).toHaveBeenCalledWith('public_token', token)
    expect(mockChain.not).toHaveBeenCalledWith('public_token', 'is', null)
  })

  it('rechaza token público expirado (410 Gone)', async () => {
    const expiredDate = new Date()
    expiredDate.setDate(expiredDate.getDate() - 1)

    const mockOrden = {
      id: 'orden-1',
      organization_id: 'org-1',
      public_token: VALID_TOKEN,
      public_token_expires_at: expiredDate.toISOString(),
    }
    const mockChain = makeMockChain({ data: mockOrden, error: null })
    vi.mocked(supabaseAdmin.from).mockReturnValue(mockChain as any)

    const result = await getOrderByPublicToken(VALID_TOKEN)
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
      public_token: VALID_TOKEN,
      public_token_expires_at: futureDate.toISOString(),
    }
    const mockChain = makeMockChain({ data: mockOrden, error: null })
    vi.mocked(supabaseAdmin.from).mockReturnValue(mockChain as any)

    const result = await getOrderByPublicToken(VALID_TOKEN)
    expect(result.error).toBeNull()
    expect(result.orden).not.toBeNull()
    expect(result.orden.id).toBe('orden-1')
  })

  it('permite token sin fecha de expiración (null)', async () => {
    const mockOrden = {
      id: 'orden-1',
      organization_id: 'org-1',
      public_token: VALID_TOKEN,
      public_token_expires_at: null,
    }
    const mockChain = makeMockChain({ data: mockOrden, error: null })
    vi.mocked(supabaseAdmin.from).mockReturnValue(mockChain as any)

    const result = await getOrderByPublicToken(VALID_TOKEN)
    expect(result.error).toBeNull()
    expect(result.orden).not.toBeNull()
  })

  it('permite token sin campo public_token_expires_at (migración no ejecutada)', async () => {
    const mockOrden = {
      id: 'orden-1',
      organization_id: 'org-1',
      public_token: VALID_TOKEN,
      // Sin public_token_expires_at — columna no existe aún
    }
    const mockChain = makeMockChain({ data: mockOrden, error: null })
    vi.mocked(supabaseAdmin.from).mockReturnValue(mockChain as any)

    const result = await getOrderByPublicToken(VALID_TOKEN)
    expect(result.error).toBeNull()
    expect(result.orden).not.toBeNull()
  })
})
