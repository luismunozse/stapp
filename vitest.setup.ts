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
  // Corta el refresh token de un usuario. Lo usa el cambio de rol para que la
  // sesion no se siga extendiendo con el rol viejo. Va en el mock global
  // porque el modulo real arrastra next-auth, que no carga en este entorno:
  // un importActual sobre @/lib/auth revienta con ERR_MODULE_NOT_FOUND.
  invalidateRefreshToken: vi.fn(() => Promise.resolve()),
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

// requireAuth() re-reads users.sucursal_id for every TECNICO/VENDEDOR request
// (lib/sesion-sucursal.ts). Without a default, each of the ~120 route suites that
// run as one of those roles would see an extra from("users") call that eats its
// mock queue. The default is "the DB agrees with the JWT": the session passes
// through untouched. __tests__/lib/auth-utils-sucursal.test.ts runs the real thing
// with vi.unmock, and any test that needs a moved user can too.
vi.mock('@/lib/sesion-sucursal', () => ({
  conSucursalVigente: vi.fn(async (session: unknown) => session),
}))

// Practice-order helpers. Every route that creates a real order calls
// deletePracticeData, and every money or stock route calls rejectIfPractica.
// Without these defaults each of those route suites would see an extra rpc() or
// from("ordenes_servicio") call. The helpers' own tests load the real module
// with vi.importActual; route tests override these per case with vi.mocked().
vi.mock('@/lib/onboarding/practica', async () => {
  const actual = await vi.importActual<typeof import('@/lib/onboarding/practica')>('@/lib/onboarding/practica')
  return {
    ...actual,
    deletePracticeData: vi.fn(async () => ({ ordenBorrada: false, ordenConservada: false, clienteConservado: false })),
    rejectIfPractica: vi.fn(async () => null),
  }
})
