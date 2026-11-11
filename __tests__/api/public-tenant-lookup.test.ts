/**
 * GET /api/public/tenant y la decisión del login sobre "Negocio no encontrado".
 *
 * El login del subdominio mandaba a /tenant-not-found ante CUALQUIER falla del
 * lookup: un fetch cortado (Safari en iPhone al volver de segundo plano), un 429
 * o un error de Supabase que el endpoint informaba como `tenant: null`. Un taller
 * que existe veía "Negocio no encontrado" de vez en cuando y no podía trabajar.
 * Solo un "no existe" confirmado puede redirigir; el proxy ya corta los slugs
 * inexistentes del lado del servidor.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { tenantLookupOutcome } from "@/lib/tenant-lookup"

const maybeSingle = vi.fn()

vi.mock("@/lib/supabase", () => {
  const chain: Record<string, unknown> = {}
  chain.select = () => chain
  chain.eq = () => chain
  chain.maybeSingle = () => maybeSingle()
  return { supabaseAdmin: { from: () => chain } }
})

import { GET } from "@/app/api/public/tenant/route"

const req = (slug: string) => new NextRequest(`https://x.stapp.com.ar/api/public/tenant?slug=${slug}`)

describe("GET /api/public/tenant", () => {
  beforeEach(() => maybeSingle.mockReset())

  it("devuelve el tenant cuando existe", async () => {
    maybeSingle.mockResolvedValue({ data: { nombre: "Smart", nombre_mostrar: null, logo_url: null }, error: null })
    const res = await GET(req("smart-case"))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ tenant: { nombre: "Smart", logoUrl: null } })
  })

  it("devuelve tenant null con 200 solo cuando no hay fila", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null })
    const res = await GET(req("no-existe"))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ tenant: null })
  })

  it("un error de base NO se informa como 'no existe'", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: "timeout" } })
    const res = await GET(req("smart-case"))
    expect(res.status).toBe(500)
    expect((await res.json()).tenant).toBeUndefined()
  })
})

describe("tenantLookupOutcome", () => {
  it("found con tenant", () => {
    expect(tenantLookupOutcome(true, { tenant: { nombre: "A" } })).toBe("found")
  })

  it("not_found solo con 200 y tenant null", () => {
    expect(tenantLookupOutcome(true, { tenant: null })).toBe("not_found")
  })

  it("unknown ante 429, 500 o cuerpo inesperado", () => {
    expect(tenantLookupOutcome(false, { error: "Demasiadas solicitudes" })).toBe("unknown")
    expect(tenantLookupOutcome(false, { error: "x" })).toBe("unknown")
    expect(tenantLookupOutcome(true, null)).toBe("unknown")
    expect(tenantLookupOutcome(true, {})).toBe("unknown")
  })
})
