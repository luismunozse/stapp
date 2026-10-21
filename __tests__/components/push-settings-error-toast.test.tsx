import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

const toastError = vi.fn()
vi.mock('sonner', () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: vi.fn() } }))
vi.mock('@/lib/capacitor', () => ({ isNativePlatform: () => false }))

const webPush = {
  supported: true,
  permission: 'default',
  subscribed: false,
  loading: false,
  error: null as string | null,
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
}
vi.mock('@/hooks/use-web-push', () => ({ useWebPush: () => webPush }))

import { PushSettings } from '@/components/notifications/push-settings'

describe('PushSettings error toast', () => {
  beforeEach(() => {
    toastError.mockClear()
    webPush.error = null
  })

  it('toasts the error once the hook reports it', () => {
    const { rerender } = render(<PushSettings />)
    expect(toastError).not.toHaveBeenCalled()

    webPush.error = 'El servicio de notificaciones no pudo activarse.'
    rerender(<PushSettings />)

    expect(toastError).toHaveBeenCalledWith('El servicio de notificaciones no pudo activarse.')
  })
})
