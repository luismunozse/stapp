import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { mockAuthSuccess, createGetRequest, parseResponse } from "./helpers"

import { GET } from "@/app/api/inventario/check-duplicate/route"

// Model codes (tokens with a digit: a13, 20w, 3000mah) tell products apart. Two names that both
// carry model codes and share none of them are different products, however many generic words
// they share ("Funda A13" is not a duplicate of "Funda A12"). When either side has no model
// code, the plain token scoring applies unchanged.

const fila = (id: string, nombre: string) => ({
  id,
  organization_id: "org-1",
  codigo: `C-${id}`,
  nombre,
  categoria: "Fundas",
  tipo_dispositivo: "CELULAR",
  stock: 3,
  precio_compra: 100,
  precio_venta: 200,
  proveedor_id: null,
  proveedores: null,
  deleted_at: null,
  grupo_id: null as string | null,
})

function fake(filas: Record<string, any>[]) {
  vi.mocked(supabaseAdmin.from).mockImplementation(((tabla: string) => {
    if (tabla !== "inventario") throw new Error(`unexpected table ${tabla}`)
    const api: any = {
      select: () => api,
      eq: () => api,
      neq: () => api,
      is: () => api,
      or: () => api,
      limit: () => api,
      then: (resolve: any, reject?: any) => Promise.resolve({ data: filas, error: null }).then(resolve, reject),
    }
    return api
  }) as any)
}

const BASE = "http://localhost:3000/api/inventario/check-duplicate"
const consultar = async (nombre: string, candidatos: string[]) => {
  fake(candidatos.map((n, i) => fila(`i${i}`, n)))
  const { body } = await parseResponse(await GET(createGetRequest(`${BASE}?nombre=${encodeURIComponent(nombre)}`)))
  return body.matches as { nombre: string; score: number }[]
}
const nombres = (matches: { nombre: string }[]) => matches.map((m) => m.nombre).sort()

describe("GET /api/inventario/check-duplicate: model codes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
  })

  it("does not flag a different model code (A13 vs A12)", async () => {
    expect(await consultar("Funda A13", ["Funda A12"])).toEqual([])
  })

  it("flags the same model with extra words", async () => {
    expect(nombres(await consultar("Funda A13", ["Funda A13 transparente"]))).toEqual(["Funda A13 transparente"])
  })

  it("flags the identical name", async () => {
    expect(nombres(await consultar("Funda A13", ["Funda A13"]))).toEqual(["Funda A13"])
  })

  it("joins a standalone letter and number (A 13 matches A13)", async () => {
    expect(nombres(await consultar("Funda A 13", ["Funda A13"]))).toEqual(["Funda A13"])
  })

  it("does not flag a different wattage (20W vs 25W)", async () => {
    expect(await consultar("Cargador 20W", ["Cargador 25W"])).toEqual([])
  })

  it("flags a longer name that keeps the model (iPhone 13 vs iPhone 13 Pro)", async () => {
    expect(nombres(await consultar("Modulo iPhone 13", ["Modulo iPhone 13 Pro"]))).toEqual(["Modulo iPhone 13 Pro"])
  })

  it("keeps today's scoring when the candidate has no model code", async () => {
    const matches = await consultar("Funda A13", ["Funda silicona"])
    expect(nombres(matches)).toEqual(["Funda silicona"])
    expect(matches[0].score).toBe(0.57)
  })

  it("does not glue a lone letter onto a size token (USB-C 2m still matches USB 2m)", async () => {
    expect(nombres(await consultar("Cable USB-C 2m", ["Cable USB 2m"]))).toEqual(["Cable USB 2m"])
  })

  it("does not glue a lone letter onto a wattage token (Tipo C 20W still matches 20W)", async () => {
    expect(nombres(await consultar("Cargador Tipo C 20W", ["Cargador 20W"]))).toEqual(["Cargador 20W"])
  })

  it("treats a single digit as a model code (iPhone 7 vs iPhone 8)", async () => {
    expect(await consultar("Funda iPhone 7", ["Funda iPhone 8"])).toEqual([])
  })

  it("flags a single-digit model with extra words (iPhone 7 vs iPhone 7 Plus)", async () => {
    expect(nombres(await consultar("Funda iPhone 7", ["Funda iPhone 7 Plus"]))).toEqual(["Funda iPhone 7 Plus"])
  })

  it("does not flag Redmi 9 vs Redmi 10", async () => {
    expect(await consultar("Redmi 9", ["Redmi 10"])).toEqual([])
  })

  it("matches a number split from its unit (8 GB vs 8GB)", async () => {
    expect(nombres(await consultar("Memoria 8 GB", ["Memoria 8GB"]))).toEqual(["Memoria 8GB"])
  })

  it("matches a wattage split from its unit (20 W vs 20W)", async () => {
    expect(nombres(await consultar("Cargador 20 W", ["Cargador 20W"]))).toEqual(["Cargador 20W"])
  })

  it("returns only the same-model items from a mixed list", async () => {
    const matches = await consultar("Funda A13", ["Funda A12", "Funda A13", "Funda A32", "Funda A13 transparente"])
    expect(nombres(matches)).toEqual(["Funda A13", "Funda A13 transparente"])
  })
})
