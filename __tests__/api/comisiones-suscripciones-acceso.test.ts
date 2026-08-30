import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { createChainMock, createGetRequest, parseResponse } from "./helpers"

/**
 * Comisiones de vendedores y facturación de la organización: dos dominios de
 * plata que estaban detrás de `requireAuth()` a secas.
 *
 * `GET /api/vendedores/[id]/comisiones` era el peor: el id del vendedor viaja
 * en la URL, así que cualquier rol autenticado leía lo que gana CUALQUIER
 * vendedor —ventas, porcentaje, montos, si ya se le pagó— cambiando un id. La
 * página `/vendedores` era admin-only en el middleware; la API no.
 *
 * Mismo patrón que las fugas de caja: un guard escrito cuando el único actor
 * era el ADMIN, más un rol nuevo que entró después. En estos archivos es más
 * visible todavía, porque el POST del mismo route.ts ya usaba requireAdmin y
 * nadie volvió por el GET.
 *
 * Lo que NO se cierra, y es deliberado: `/api/subscriptions` y
 * `/api/subscriptions/usage` los consumen TrialCountdownBanner y
 * UsageWarningBanner, montados en `app/(dashboard)/layout.tsx` — el shell de
 * todos los roles— y subscription-required-view, que es la pantalla de
 * "se venció tu suscripción". Cerrarlos le mostraría un error al vendedor en
 * vez de la explicación.
 */

function mockRole(role: string, userId = "user-1") {
  vi.mocked(auth).mockResolvedValue({
    user: { id: userId, organizationId: "org-1", role, sucursalId: "suc-1", email: "u@u.com" },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any)
}

function mockTablas() {
  vi.mocked(supabaseAdmin.from).mockImplementation((() => createChainMock([], null, 0)) as any)
  // /api/vendedores agrega stats por RPC despues del listado.
  ;(supabaseAdmin as any).rpc = vi.fn().mockResolvedValue({ data: [], error: null })
}

async function statusDe(res: any) {
  return (await parseResponse(await res)).status
}

const NO_ADMIN = ["VENDEDOR", "TECNICO", "GERENTE"]

describe("GET /api/vendedores/[id]/comisiones", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTablas()
  })

  const params = () => ({ params: Promise.resolve({ id: "vendedor-2" }) })
  const url = "http://localhost/api/vendedores/vendedor-2/comisiones"

  it.each(NO_ADMIN)("%s no lee las comisiones de un vendedor", async (rol) => {
    mockRole(rol)
    const { GET } = await import("@/app/api/vendedores/[id]/comisiones/route")

    expect(await statusDe(GET(createGetRequest(url), params()))).toBe(403)
  })

  it("un VENDEDOR tampoco lee las suyas por esta ruta: es la pantalla de liquidación", async () => {
    // No es una vista de "mis comisiones": es la liquidación que hace el dueño.
    // Si mañana hace falta que el vendedor vea las propias, va por una ruta que
    // se scopee sola, como ya hace GET /api/comisiones con el técnico.
    mockRole("VENDEDOR", "vendedor-2")
    const { GET } = await import("@/app/api/vendedores/[id]/comisiones/route")

    expect(await statusDe(GET(createGetRequest(url), params()))).toBe(403)
  })

  it("el ADMIN sí", async () => {
    mockRole("ADMIN")
    const { GET } = await import("@/app/api/vendedores/[id]/comisiones/route")

    expect(await statusDe(GET(createGetRequest(url), params()))).toBe(200)
  })
})

describe("GET /api/vendedores", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTablas()
  })

  it.each(NO_ADMIN)("%s no lista los vendedores", async (rol) => {
    // El POS no se rompe: usa /api/operadores?rol=VENDEDOR, no esta ruta.
    mockRole(rol)
    const { GET } = await import("@/app/api/vendedores/route")

    expect(await statusDe(GET(createGetRequest("http://localhost/api/vendedores")))).toBe(403)
  })

  it("el ADMIN sí", async () => {
    mockRole("ADMIN")
    const { GET } = await import("@/app/api/vendedores/route")

    expect(await statusDe(GET(createGetRequest("http://localhost/api/vendedores")))).toBe(200)
  })
})

describe("GET /api/vendedores/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTablas()
  })

  it.each(NO_ADMIN)("%s no lee la ficha de un vendedor", async (rol) => {
    mockRole(rol)
    const { GET } = await import("@/app/api/vendedores/[id]/route")

    expect(
      await statusDe(
        GET(createGetRequest("http://localhost/api/vendedores/vendedor-2"), {
          params: Promise.resolve({ id: "vendedor-2" }),
        }),
      ),
    ).toBe(403)
  })
})

describe("GET /api/subscriptions/payments", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTablas()
  })

  it.each(NO_ADMIN)("%s no lee el historial de facturación de la organización", async (rol) => {
    // select("*") sobre subscription_payments: montos, fechas, medio de pago.
    // El único consumidor es /configuracion/billing, que ya es admin-only.
    mockRole(rol)
    const { GET } = await import("@/app/api/subscriptions/payments/route")

    expect(await statusDe(GET())).toBe(403)
  })

  it("el ADMIN sí", async () => {
    mockRole("ADMIN")
    const { GET } = await import("@/app/api/subscriptions/payments/route")

    expect(await statusDe(GET())).toBe(200)
  })
})

describe("GET /api/subscription/status", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTablas()
  })

  it.each(NO_ADMIN)("%s no lo lee", async (rol) => {
    // Hoy no lo consume nadie en la app. Se cierra ahora, antes de que alguien
    // lo cablee a una pantalla y cerrarlo pase a ser un cambio de conducta.
    mockRole(rol)
    const { GET } = await import("@/app/api/subscription/status/route")

    expect(await statusDe(GET())).toBe(403)
  })
})
