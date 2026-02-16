import { describe, it, expect, vi, beforeEach } from 'vitest'
import { supabaseAdmin } from '@/lib/supabase'

describe('DEVICE_TYPE_PREFIXES mapping', () => {
  it('mapea CELULAR a CEL', async () => {
    // Testeamos el formato indirectamente a través de getNextOrderNumberByType
    // El mapeo es: CELULAR -> CEL, COMPUTADORA -> PC, TABLET -> TAB, etc.
    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116', message: 'No rows' } }),
    }
    vi.mocked(supabaseAdmin.from).mockReturnValue(mockChain as any)

    const { getNextOrderNumberByType } = await import('../counters')
    const result = await getNextOrderNumberByType('org-1', 'CELULAR')
    expect(result.codigo).toBe('CEL001')
    expect(result.numero).toBe(1)
  })

  it('mapea COMPUTADORA a PC', async () => {
    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116', message: 'No rows' } }),
    }
    vi.mocked(supabaseAdmin.from).mockReturnValue(mockChain as any)

    const { getNextOrderNumberByType } = await import('../counters')
    const result = await getNextOrderNumberByType('org-1', 'COMPUTADORA')
    expect(result.codigo).toBe('PC001')
  })

  it('mapea TABLET a TAB', async () => {
    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116', message: 'No rows' } }),
    }
    vi.mocked(supabaseAdmin.from).mockReturnValue(mockChain as any)

    const { getNextOrderNumberByType } = await import('../counters')
    const result = await getNextOrderNumberByType('org-1', 'TABLET')
    expect(result.codigo).toBe('TAB001')
  })

  it('mapea CONSOLA a CONS', async () => {
    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116', message: 'No rows' } }),
    }
    vi.mocked(supabaseAdmin.from).mockReturnValue(mockChain as any)

    const { getNextOrderNumberByType } = await import('../counters')
    const result = await getNextOrderNumberByType('org-1', 'CONSOLA')
    expect(result.codigo).toBe('CONS001')
  })

  it('mapea SMARTWATCH a SW', async () => {
    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116', message: 'No rows' } }),
    }
    vi.mocked(supabaseAdmin.from).mockReturnValue(mockChain as any)

    const { getNextOrderNumberByType } = await import('../counters')
    const result = await getNextOrderNumberByType('org-1', 'SMARTWATCH')
    expect(result.codigo).toBe('SW001')
  })

  it('usa ORD como fallback para tipo desconocido', async () => {
    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116', message: 'No rows' } }),
    }
    vi.mocked(supabaseAdmin.from).mockReturnValue(mockChain as any)

    const { getNextOrderNumberByType } = await import('../counters')
    const result = await getNextOrderNumberByType('org-1', 'TIPO_DESCONOCIDO')
    expect(result.codigo).toBe('ORD001')
  })
})

describe('getNextOrderNumberByType - secuencia numérica', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('incrementa número basado en última orden existente', async () => {
    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { numero_orden: 42 }, error: null }),
    }
    vi.mocked(supabaseAdmin.from).mockReturnValue(mockChain as any)

    const { getNextOrderNumberByType } = await import('../counters')
    const result = await getNextOrderNumberByType('org-1', 'CELULAR')
    expect(result.codigo).toBe('CEL043')
    expect(result.numero).toBe(43)
  })

  it('formatea números con padding de 3 dígitos', async () => {
    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { numero_orden: 8 }, error: null }),
    }
    vi.mocked(supabaseAdmin.from).mockReturnValue(mockChain as any)

    const { getNextOrderNumberByType } = await import('../counters')
    const result = await getNextOrderNumberByType('org-1', 'CELULAR')
    expect(result.codigo).toBe('CEL009')
  })

  it('maneja números mayores a 999', async () => {
    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { numero_orden: 999 }, error: null }),
    }
    vi.mocked(supabaseAdmin.from).mockReturnValue(mockChain as any)

    const { getNextOrderNumberByType } = await import('../counters')
    const result = await getNextOrderNumberByType('org-1', 'CELULAR')
    expect(result.codigo).toBe('CEL1000')
    expect(result.numero).toBe(1000)
  })

  it('lanza error en fallo de DB que no sea "no rows"', async () => {
    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { code: 'INTERNAL', message: 'DB error' } }),
    }
    vi.mocked(supabaseAdmin.from).mockReturnValue(mockChain as any)

    const { getNextOrderNumberByType } = await import('../counters')
    await expect(getNextOrderNumberByType('org-1', 'CELULAR')).rejects.toThrow('Error getting last order number')
  })
})

describe('getNextOrderNumber', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('retorna número de la función RPC', async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: 5, error: null } as any)

    const { getNextOrderNumber } = await import('../counters')
    const result = await getNextOrderNumber('org-1')
    expect(result).toBe(5)
  })

  it('lanza error cuando RPC falla', async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: null, error: { message: 'RPC failed' } } as any)

    const { getNextOrderNumber } = await import('../counters')
    await expect(getNextOrderNumber('org-1')).rejects.toThrow('Error getting next order number')
  })
})

describe('getNextQuoteNumber', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('formatea número de cotización como COT-XXXX', async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: 1, error: null } as any)

    const { getNextQuoteNumber } = await import('../counters')
    const result = await getNextQuoteNumber('org-1')
    expect(result).toBe('COT-0001')
  })

  it('aplica padding de 4 dígitos', async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: 42, error: null } as any)

    const { getNextQuoteNumber } = await import('../counters')
    const result = await getNextQuoteNumber('org-1')
    expect(result).toBe('COT-0042')
  })

  it('maneja números grandes sin padding', async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: 12345, error: null } as any)

    const { getNextQuoteNumber } = await import('../counters')
    const result = await getNextQuoteNumber('org-1')
    expect(result).toBe('COT-12345')
  })
})

describe('getNextInvoiceNumber', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('formatea número de factura como 0001-XXXXXXXX', async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: 1, error: null } as any)

    const { getNextInvoiceNumber } = await import('../counters')
    const result = await getNextInvoiceNumber('org-1')
    expect(result).toBe('0001-00000001')
  })

  it('aplica padding de 8 dígitos', async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: 150, error: null } as any)

    const { getNextInvoiceNumber } = await import('../counters')
    const result = await getNextInvoiceNumber('org-1')
    expect(result).toBe('0001-00000150')
  })
})

describe('getNextSaleNumber', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('formatea número de venta como VXXXX', async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: 1, error: null } as any)

    const { getNextSaleNumber } = await import('../counters')
    const result = await getNextSaleNumber('org-1')
    expect(result.codigo).toBe('V0001')
    expect(result.numero).toBe(1)
  })

  it('aplica padding de 4 dígitos', async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: 99, error: null } as any)

    const { getNextSaleNumber } = await import('../counters')
    const result = await getNextSaleNumber('org-1')
    expect(result.codigo).toBe('V0099')
  })
})
