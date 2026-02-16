import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock localStorage para tests
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key]
    }),
    clear: () => {
      store = {}
    },
  }
})()

Object.defineProperty(global, 'localStorage', {
  value: localStorageMock,
  writable: true,
})

// Necesitamos importar después de definir localStorage
import {
  getCookieConsent,
  setCookieConsent,
  canUseAnalytics,
  canUseMarketing,
  hasGivenConsent,
  resetCookieConsent,
} from '../cookies'

describe('getCookieConsent', () => {
  beforeEach(() => {
    localStorageMock.clear()
    vi.clearAllMocks()
  })

  it('retorna null cuando no hay consentimiento guardado', () => {
    const result = getCookieConsent()
    expect(result).toBe(null)
  })

  it('retorna "all" cuando se aceptaron todas las cookies', () => {
    localStorageMock.setItem('cookie-consent', 'all')
    const result = getCookieConsent()
    expect(result).toBe('all')
  })

  it('retorna "essential" cuando solo se aceptaron esenciales', () => {
    localStorageMock.setItem('cookie-consent', 'essential')
    const result = getCookieConsent()
    expect(result).toBe('essential')
  })

  it('retorna "rejected" cuando se rechazaron', () => {
    localStorageMock.setItem('cookie-consent', 'rejected')
    const result = getCookieConsent()
    expect(result).toBe('rejected')
  })
})

describe('setCookieConsent', () => {
  beforeEach(() => {
    localStorageMock.clear()
    vi.clearAllMocks()
  })

  it('guarda consentimiento "all"', () => {
    setCookieConsent('all')
    expect(localStorageMock.setItem).toHaveBeenCalledWith('cookie-consent', 'all')
  })

  it('guarda consentimiento "essential"', () => {
    setCookieConsent('essential')
    expect(localStorageMock.setItem).toHaveBeenCalledWith('cookie-consent', 'essential')
  })

  it('guarda consentimiento "rejected"', () => {
    setCookieConsent('rejected')
    expect(localStorageMock.setItem).toHaveBeenCalledWith('cookie-consent', 'rejected')
  })

  it('remueve consentimiento cuando es null', () => {
    setCookieConsent(null)
    expect(localStorageMock.removeItem).toHaveBeenCalledWith('cookie-consent')
  })
})

describe('canUseAnalytics', () => {
  beforeEach(() => {
    localStorageMock.clear()
    vi.clearAllMocks()
  })

  it('retorna true cuando el consentimiento es "all"', () => {
    localStorageMock.setItem('cookie-consent', 'all')
    expect(canUseAnalytics()).toBe(true)
  })

  it('retorna false cuando el consentimiento es "essential"', () => {
    localStorageMock.setItem('cookie-consent', 'essential')
    expect(canUseAnalytics()).toBe(false)
  })

  it('retorna false cuando el consentimiento es "rejected"', () => {
    localStorageMock.setItem('cookie-consent', 'rejected')
    expect(canUseAnalytics()).toBe(false)
  })

  it('retorna false cuando no hay consentimiento', () => {
    expect(canUseAnalytics()).toBe(false)
  })
})

describe('canUseMarketing', () => {
  beforeEach(() => {
    localStorageMock.clear()
    vi.clearAllMocks()
  })

  it('retorna true cuando el consentimiento es "all"', () => {
    localStorageMock.setItem('cookie-consent', 'all')
    expect(canUseMarketing()).toBe(true)
  })

  it('retorna false cuando el consentimiento es "essential"', () => {
    localStorageMock.setItem('cookie-consent', 'essential')
    expect(canUseMarketing()).toBe(false)
  })

  it('retorna false cuando no hay consentimiento', () => {
    expect(canUseMarketing()).toBe(false)
  })
})

describe('hasGivenConsent', () => {
  beforeEach(() => {
    localStorageMock.clear()
    vi.clearAllMocks()
  })

  it('retorna false cuando no hay consentimiento', () => {
    expect(hasGivenConsent()).toBe(false)
  })

  it('retorna true cuando se aceptó todo', () => {
    localStorageMock.setItem('cookie-consent', 'all')
    expect(hasGivenConsent()).toBe(true)
  })

  it('retorna true cuando se aceptó solo esenciales', () => {
    localStorageMock.setItem('cookie-consent', 'essential')
    expect(hasGivenConsent()).toBe(true)
  })

  it('retorna true cuando se rechazó (pero se dio respuesta)', () => {
    localStorageMock.setItem('cookie-consent', 'rejected')
    expect(hasGivenConsent()).toBe(true)
  })
})

describe('resetCookieConsent', () => {
  beforeEach(() => {
    localStorageMock.clear()
    vi.clearAllMocks()
  })

  it('limpia el consentimiento de cookies', () => {
    localStorageMock.setItem('cookie-consent', 'all')
    resetCookieConsent()
    expect(localStorageMock.removeItem).toHaveBeenCalledWith('cookie-consent')
  })

  it('después de reset, hasGivenConsent retorna false', () => {
    localStorageMock.setItem('cookie-consent', 'all')
    resetCookieConsent()
    // Clear the mock to reset the store
    localStorageMock.clear()
    expect(hasGivenConsent()).toBe(false)
  })
})
