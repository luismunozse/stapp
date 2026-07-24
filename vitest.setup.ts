import '@testing-library/jest-dom'
import { vi } from 'vitest'

// jsdom no implementa ResizeObserver; lo necesitan componentes Radix (ej. Slider)
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

// jsdom tampoco implementa matchMedia; lo consultan algunos componentes/diálogos.
if (typeof window !== 'undefined' && typeof window.matchMedia === 'undefined') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

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
    storage: {
      from: vi.fn(() => ({
        list: vi.fn().mockResolvedValue({ data: [], error: null }),
        remove: vi.fn().mockResolvedValue({ data: null, error: null }),
      })),
    },
  },
  STORAGE_BUCKETS: {
    FOTOS_ORDENES: 'fotos-ordenes',
    FOTOS_INVENTARIO: 'fotos-inventario',
    LOGOS: 'logos',
    FIRMAS: 'firmas',
    CSV_IMPORTS: 'csv-imports',
    APK_RELEASES: 'apk-releases',
    SOPORTE_ATTACHMENTS: 'soporte-attachments',
    AVATARS: 'avatars',
    COMPROBANTES_GASTOS: 'comprobantes-gastos',
    CATALOGO: 'catalogo',
  },
}))
