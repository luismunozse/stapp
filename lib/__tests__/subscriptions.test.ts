import { describe, it, expect, vi, beforeEach } from 'vitest'
import { supabaseAdmin } from '@/lib/supabase'

// Mock de supabase ya está en vitest.setup.ts

// Helper para mockear cadena de queries de Supabase
function mockSupabaseChain(returnData: any, returnError: any = null) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: returnData, error: returnError }),
  }
  return chain
}

describe('getSubscriptionInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('retorna null cuando no hay suscripción', async () => {
    const chain = mockSupabaseChain(null, { message: 'No rows' })
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain as any)

    const { getSubscriptionInfo } = await import('../subscriptions')
    const result = await getSubscriptionInfo('org-123')
    expect(result).toBe(null)
  })

  it('retorna info formateada cuando hay suscripción', async () => {
    const mockData = {
      id: 'sub-1',
      status: 'ACTIVE',
      billing_period: 'MONTHLY',
      payment_provider: 'MERCADOPAGO',
      current_period_end: '2025-12-31',
      trial_end: null,
      cancel_at_period_end: false,
      plans: {
        id: 'plan-1',
        nombre: 'Premium',
        tipo: 'PREMIUM',
        limite_ordenes: null,
        limite_tecnicos: null,
        limite_clientes: null,
        limite_storage_mb: null,
        features: ['export', 'reports'],
      },
    }
    const chain = mockSupabaseChain(mockData)
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain as any)

    const { getSubscriptionInfo } = await import('../subscriptions')
    const result = await getSubscriptionInfo('org-123')

    expect(result).not.toBe(null)
    expect(result!.planTipo).toBe('PREMIUM')
    expect(result!.status).toBe('ACTIVE')
    expect(result!.billingPeriod).toBe('MONTHLY')
    expect(result!.paymentProvider).toBe('MERCADOPAGO')
    expect(result!.features).toEqual(['export', 'reports'])
    expect(result!.limits.ordenes).toBe(null) // Premium = sin límite
  })

  it('retorna límites del plan FREE correctamente', async () => {
    const mockData = {
      id: 'sub-2',
      status: 'ACTIVE',
      billing_period: null,
      payment_provider: null,
      current_period_end: null,
      trial_end: null,
      cancel_at_period_end: false,
      plans: {
        id: 'plan-free',
        nombre: 'Free',
        tipo: 'FREE',
        limite_ordenes: 50,
        limite_tecnicos: 2,
        limite_clientes: 100,
        limite_storage_mb: 100,
        features: [],
      },
    }
    const chain = mockSupabaseChain(mockData)
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain as any)

    const { getSubscriptionInfo } = await import('../subscriptions')
    const result = await getSubscriptionInfo('org-123')

    expect(result!.planTipo).toBe('FREE')
    expect(result!.limits.ordenes).toBe(50)
    expect(result!.limits.tecnicos).toBe(2)
    expect(result!.limits.clientes).toBe(100)
    expect(result!.limits.storageMb).toBe(100)
  })
})

describe('getUsageInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('retorna ceros cuando no hay datos de uso', async () => {
    const chain = mockSupabaseChain(null)
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain as any)

    const { getUsageInfo } = await import('../subscriptions')
    const result = await getUsageInfo('org-123')

    expect(result.ordenesMesActual).toBe(0)
    expect(result.ordenesTotal).toBe(0)
    expect(result.tecnicos).toBe(0)
    expect(result.vendedores).toBe(0)
    expect(result.clientes).toBe(0)
    expect(result.storageMb).toBe(0)
  })

  it('retorna datos de uso formateados', async () => {
    const mockData = {
      ordenes_mes_actual: 15,
      ordenes_count: 100,
      tecnicos_count: 3,
      vendedores_count: 2,
      clientes_count: 50,
      storage_used_mb: '45.5',
    }
    const chain = mockSupabaseChain(mockData)
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain as any)

    const { getUsageInfo } = await import('../subscriptions')
    const result = await getUsageInfo('org-123')

    expect(result.ordenesMesActual).toBe(15)
    expect(result.ordenesTotal).toBe(100)
    expect(result.tecnicos).toBe(3)
    expect(result.vendedores).toBe(2)
    expect(result.clientes).toBe(50)
    expect(result.storageMb).toBe(45.5)
  })

  it('maneja valores null en datos de uso', async () => {
    const mockData = {
      ordenes_mes_actual: null,
      ordenes_count: null,
      tecnicos_count: 0,
      vendedores_count: null,
      clientes_count: null,
      storage_used_mb: null,
    }
    const chain = mockSupabaseChain(mockData)
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain as any)

    const { getUsageInfo } = await import('../subscriptions')
    const result = await getUsageInfo('org-123')

    expect(result.ordenesMesActual).toBe(0)
    expect(result.ordenesTotal).toBe(0)
    expect(result.tecnicos).toBe(0)
    expect(result.vendedores).toBe(0)
    expect(result.clientes).toBe(0)
    expect(result.storageMb).toBe(0)
  })
})

describe('SubscriptionInfo interface', () => {
  it('tiene los campos esperados para tipo FREE', () => {
    const info = {
      id: 'sub-1',
      planId: 'plan-1',
      planNombre: 'Free',
      planTipo: 'FREE' as const,
      status: 'ACTIVE' as const,
      billingPeriod: null,
      paymentProvider: null,
      currentPeriodEnd: null,
      trialEnd: null,
      cancelAtPeriodEnd: false,
      limits: {
        ordenes: 50,
        tecnicos: 2,
        clientes: 100,
        storageMb: 100,
      },
      features: [],
    }
    expect(info.planTipo).toBe('FREE')
    expect(info.limits.ordenes).toBe(50)
  })

  it('tiene los campos esperados para tipo PREMIUM', () => {
    const info = {
      id: 'sub-2',
      planId: 'plan-2',
      planNombre: 'Premium',
      planTipo: 'PREMIUM' as const,
      status: 'ACTIVE' as const,
      billingPeriod: 'MONTHLY' as const,
      paymentProvider: 'MERCADOPAGO' as const,
      currentPeriodEnd: '2025-12-31',
      trialEnd: null,
      cancelAtPeriodEnd: false,
      limits: {
        ordenes: null,
        tecnicos: null,
        clientes: null,
        storageMb: null,
      },
      features: ['export', 'advanced_reports'],
    }
    expect(info.planTipo).toBe('PREMIUM')
    expect(info.limits.ordenes).toBe(null) // sin límite
    expect(info.features).toContain('export')
  })
})

describe('TrialInfo interface', () => {
  it('representa trial activo correctamente', () => {
    const trial = {
      isInTrial: true,
      isTrialExpired: false,
      trialEnd: new Date('2025-12-31'),
      daysRemaining: 15,
      isPaid: false,
    }
    expect(trial.isInTrial).toBe(true)
    expect(trial.isTrialExpired).toBe(false)
    expect(trial.daysRemaining).toBeGreaterThan(0)
  })

  it('representa trial expirado correctamente', () => {
    const trial = {
      isInTrial: true,
      isTrialExpired: true,
      trialEnd: new Date('2024-01-01'),
      daysRemaining: 0,
      isPaid: false,
    }
    expect(trial.isTrialExpired).toBe(true)
    expect(trial.daysRemaining).toBe(0)
  })

  it('representa usuario pagado sin trial', () => {
    const trial = {
      isInTrial: false,
      isTrialExpired: false,
      trialEnd: null,
      daysRemaining: 0,
      isPaid: true,
    }
    expect(trial.isPaid).toBe(true)
    expect(trial.isInTrial).toBe(false)
  })
})
