import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'user-1' } } }),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('@/lib/capacitor', () => ({
  isNativePlatform: () => false,
}))

import { useWebPush } from '../use-web-push'

describe('useWebPush.subscribe', () => {
  const originalSW = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker')

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'BAAA')
    vi.stubGlobal('PushManager', class {})
    vi.stubGlobal('Notification', {
      permission: 'default',
      requestPermission: vi.fn().mockResolvedValue('granted'),
    })
    // A service worker whose install failed never becomes active, so `ready` never settles.
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        ready: new Promise(() => {}),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    if (originalSW) Object.defineProperty(navigator, 'serviceWorker', originalSW)
    else delete (navigator as unknown as Record<string, unknown>).serviceWorker
  })

  it('stops loading and reports an error when the service worker never becomes ready', async () => {
    const { result } = renderHook(() => useWebPush())

    let ok: boolean | undefined
    let pending: Promise<boolean>
    await act(async () => {
      pending = result.current.subscribe()
      await Promise.resolve()
    })
    expect(result.current.loading).toBe(true)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
      ok = await pending
    })

    expect(ok).toBe(false)
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toMatch(/no pudo activarse|service worker|recarg/i)
  })
})
