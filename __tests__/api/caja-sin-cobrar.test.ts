/**
 * GET /api/caja: tarjeta "Ordenes reparadas sin cobrar".
 *
 * ordenes_servicio NO tiene created_at: ordenar por esa columna hacia fallar la
 * consulta (supabase-js no lanza, devuelve { data: null, error }) y la tarjeta
 * mostraba 0 en todos los talleres. El mock de estos tests se comporta como
 * PostgREST: una columna inexistente devuelve 42703.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth } from "@/lib/auth"
import { cookies } from "next/headers"
import { mockSupabaseFrom, createChainMock, createGetRequest } from "./helpers"

vi.mock("@/lib/caja-utils", () => ({
  fetchMovimientosDia: vi.fn().mockResolvedValue([]),
  computeTotales: vi.fn().mockReturnValue({
    totalIngresos: 0,
    totalEgresos: 0,
    totalIngresosEfectivo: 0,
    totalEgresosEfectivo: 0,
    totalCostosFinancieros: 0,
    totalDia: 0,
    porMetodo: {},
    porTipo: {},
    ingresoReal: 0,
  }),
}))

import { GET } from "@/app/api/caja/route"

// Columnas reales de ordenes_servicio que usa (o podria usar) esta consulta.
// Notar: no existen created_at ni updated_at.
const COLUMNAS_ORDENES = new Set([
  "id", "numero_orden", "costo_final", "total_cobrado", "estado_cobro", "estado",
  "organization_id", "sucursal_id", "fecha_ingreso", "fecha_entrega", "fecha_completado",
])

type Fila = Record<string, unknown>

/** Chain de ordenes_servicio que valida columnas como PostgREST y registra el orden. */
function ordenesEstricto(filas: Fila[], falla?: { code: string; message: string }) {
  const usadas: string[] = []
  const ordenes: Array<{ column: string; ascending?: boolean }> = []
  const chain: any = {}
  const registrar = (col: unknown) => typeof col === "string" && usadas.push(col)
  chain.select = vi.fn((cols: string) => {
    cols.split(",").map((c) => c.trim()).forEach(registrar)
    return chain
  })
  for (const m of ["eq", "in", "not", "gt"]) {
    chain[m] = vi.fn((col: string) => (registrar(col), chain))
  }
  chain.order = vi.fn((col: string, opts?: { ascending?: boolean }) => {
    registrar(col)
    ordenes.push({ column: col, ascending: opts?.ascending })
    return chain
  })
  chain.limit = vi.fn(() => chain)
  chain.then = (resolve: any, reject?: any) => {
    const mala = usadas.find((c) => !COLUMNAS_ORDENES.has(c))
    const result = falla
      ? { data: null, error: falla, count: null }
      : mala
        ? { data: null, error: { code: "42703", message: `column ordenes_servicio.${mala} does not exist` }, count: null }
        : { data: filas, error: null, count: filas.length }
    return Promise.resolve(result).then(resolve, reject)
  }
  return Object.assign(chain, { ordenesOrdenadas: ordenes })
}

function montar(ordenes: ReturnType<typeof ordenesEstricto>) {
  vi.mocked(auth).mockResolvedValue({
    user: { id: "user-1", organizationId: "org-1", role: "ADMIN", sucursalId: null, email: "a@a.com" },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any)
  vi.mocked(cookies).mockResolvedValue({ get: vi.fn(() => undefined), set: vi.fn() } as any)
  mockSupabaseFrom({
    ordenes_servicio: ordenes,
    sesiones_caja: createChainMock(null, null),
    users: createChainMock({ id: "user-1", nombre: "Test" }, null),
    organizations: createChainMock({ zona_horaria: "America/Argentina/Buenos_Aires" }, null),
  })
}

const fila = (n: number, costo: number, cobrado = 0): Fila => ({
  id: `o${n}`, numero_orden: n, costo_final: String(costo), total_cobrado: String(cobrado), estado_cobro: "PENDIENTE",
})

describe("GET /api/caja: sinCobrar", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("ordena por fecha_ingreso (las mas nuevas primero) y lista las ordenes sin cobrar", async () => {
    const ordenes = ordenesEstricto([fila(7, 1000, 250), fila(6, 500)])
    montar(ordenes)

    const res = await GET(createGetRequest("http://localhost:3000/api/caja"))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(ordenes.ordenesOrdenadas).toEqual([{ column: "fecha_ingreso", ascending: false }])
    expect(body.sinCobrar.count).toBe(2)
    expect(body.sinCobrar.ordenes[0]).toMatchObject({ numeroOrden: 7, pendiente: 750, totalCobrado: 250 })
  })

  it("no consulta columnas inexistentes de ordenes_servicio", async () => {
    const ordenes = ordenesEstricto([fila(1, 100)])
    montar(ordenes)

    const body = await (await GET(createGetRequest("http://localhost:3000/api/caja"))).json()

    expect(body.sinCobrar).not.toBeNull()
    expect(body.sinCobrar.count).toBe(1)
  })

  it("si la consulta falla devuelve sinCobrar null (no 0), loguea y no tumba la caja", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    montar(ordenesEstricto([], { code: "XX000", message: "boom" }))

    const res = await GET(createGetRequest("http://localhost:3000/api/caja"))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.sinCobrar).toBeNull()
    expect(body).toHaveProperty("sesionActual")
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
