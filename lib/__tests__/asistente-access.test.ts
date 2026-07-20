import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/subscriptions', () => ({
  getSubscriptionInfo: vi.fn(),
  hasPlanFeature: vi.fn(),
}))

import { getSubscriptionInfo, hasPlanFeature } from '@/lib/subscriptions'
import { canUseAsistente } from '@/lib/asistente/access'
import { checkAsistenteRateLimit } from '@/lib/asistente/rate-limit'

const baseSub = { status: 'ACTIVE', planSlug: 'profesional' } as any

describe('canUseAsistente', () => {
  beforeEach(() => vi.clearAllMocks())

  it('true: plan ACTIVE con flag asistente_ia', async () => {
    vi.mocked(getSubscriptionInfo).mockResolvedValue(baseSub)
    vi.mocked(hasPlanFeature).mockResolvedValue(true)
    expect(await canUseAsistente('org-1')).toBe(true)
  })

  it('false: TRIALING aunque tenga el flag (trial excluido)', async () => {
    vi.mocked(getSubscriptionInfo).mockResolvedValue({ ...baseSub, status: 'TRIALING' })
    vi.mocked(hasPlanFeature).mockResolvedValue(true)
    expect(await canUseAsistente('org-1')).toBe(false)
  })

  it('false: ACTIVE sin flag (plan free)', async () => {
    vi.mocked(getSubscriptionInfo).mockResolvedValue({ ...baseSub, planSlug: 'free' })
    vi.mocked(hasPlanFeature).mockResolvedValue(false)
    expect(await canUseAsistente('org-1')).toBe(false)
  })

  it('false: sin suscripción', async () => {
    vi.mocked(getSubscriptionInfo).mockResolvedValue(null)
    expect(await canUseAsistente('org-1')).toBe(false)
  })
})

describe('checkAsistenteRateLimit', () => {
  it('permite 10 y bloquea el 11º dentro de la ventana', () => {
    const now = 1_000_000
    for (let i = 0; i < 10; i++) {
      expect(checkAsistenteRateLimit('user-rl-1', now + i)).toBe(true)
    }
    expect(checkAsistenteRateLimit('user-rl-1', now + 11)).toBe(false)
  })

  it('resetea pasada la ventana de 60s', () => {
    const now = 2_000_000
    for (let i = 0; i < 10; i++) checkAsistenteRateLimit('user-rl-2', now)
    expect(checkAsistenteRateLimit('user-rl-2', now + 61_000)).toBe(true)
  })
})
