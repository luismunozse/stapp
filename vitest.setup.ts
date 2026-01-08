import '@testing-library/jest-dom'
import { vi } from 'vitest'

// Mock para React cache
vi.mock('react', async () => {
  const actual = await vi.importActual('react')
  return {
    ...actual,
    cache: (fn: any) => fn, // cache simplemente retorna la funcion
  }
})

// Mock para next/headers
vi.mock('next/headers', () => ({
  headers: vi.fn(() => ({
    get: vi.fn(),
  })),
  cookies: vi.fn(() => ({
    get: vi.fn(),
    set: vi.fn(),
  })),
}))

// Mock para @/lib/auth
vi.mock('@/lib/auth', () => ({
  auth: vi.fn(() => Promise.resolve(null)),
}))

// Mock para @/lib/supabase (evitar conexiones reales en tests)
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn(),
    })),
    rpc: vi.fn(),
  },
}))
