import { describe, it, expect, vi, beforeEach } from "vitest"
import { cookies } from "next/headers"
import { supabaseAdmin } from "@/lib/supabase"
import { mockAuthSuccess, mockAuthError, createChainMock, createGetRequest, parseResponse } from "./helpers"
import { GET } from "@/app/api/notas-credito/route"

const URL_BASE = "http://localhost/api/notas-credito"

function mockCookie(value: string | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn((name: string) => (name === "stapp-sucursal-activa" && value ? { value } : undefined)),
    set: vi.fn(),
  } as any)
}

const filaVista = {
  id: "nc-1", origen: "ORDEN", origen_id: "o-1", origen_numero: "CEL099", numero: "NC-000007",
  fecha: "2026-10-13T15:00:00+00:00", modo: "MONTO", motivo_nc: "TRABAJO_NO_REALIZADO", detalle: null,
  monto: "1000.00", monto_aplicado_deuda: "0.00", monto_reembolso: "1000.00", metodo: "TRANSFERENCIA",
  cliente_id: "cli-1", sucursal_id: null, organization_id: "org-1", user_id: null, anulada: false,
}

function setup(opts: { filas?: unknown[]; count?: number; vistaError?: unknown; zona?: string } = {}) {
  const chains: Record<string, ReturnType<typeof createChainMock>> = {}
  vi.mocked(supabaseAdmin.from).mockImplementation((t: string) => {
    if (t === "v_notas_credito") {
      chains.vista = createChainMock(opts.filas ?? [filaVista], opts.vistaError ?? null, opts.count ?? 1)
      return chains.vista as any
    }
    if (t === "organizations") return createChainMock({ zona_horaria: opts.zona ?? "America/Argentina/Buenos_Aires" }) as any
    if (t === "clientes") return createChainMock([{ id: "cli-1", nombre: "Juan Pérez" }]) as any
    return createChainMock([]) as any
  })
  return chains
}

const get = (qs = "") => GET(createGetRequest(`${URL_BASE}${qs}`))

describe("GET /api/notas-credito — acceso", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCookie(null)
  })

  it("sin sesión responde 401", async () => {
    mockAuthError()
    const res = await get()
    expect(res.status).toBe(401)
  })

  // Hasta el PR7 el listado es solo del ADMIN (desvío 3 del plan).
  it.each(["VENDEDOR", "TECNICO"])("%s recibe 403 y no se lee la vista", async (role) => {
    mockAuthSuccess({ role, sucursalId: "suc-1" })
    setup()
    const res = await get()
    expect(res.status).toBe(403)
    expect(supabaseAdmin.from).not.toHaveBeenCalledWith("v_notas_credito")
  })
})

describe("GET /api/notas-credito — lectura", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie(null)
  })

  it("lee la vista de la organización, más nueva primero, y devuelve filas con nombres", async () => {
    const chains = setup({ count: 41 })
    const res = await parseResponse(await get("?page=2&limit=20"))
    expect(res.status).toBe(200)
    expect(chains.vista.select).toHaveBeenCalledWith(expect.stringContaining("monto_aplicado_deuda"), { count: "exact" })
    expect(chains.vista.eq).toHaveBeenCalledWith("organization_id", "org-1")
    expect(chains.vista.order).toHaveBeenNthCalledWith(1, "fecha", { ascending: false })
    expect(chains.vista.order).toHaveBeenNthCalledWith(2, "id", { ascending: false })
    expect(chains.vista.range).toHaveBeenCalledWith(20, 39)
    expect(res.body).toMatchObject({ total: 41, page: 2, limit: 20, totalPages: 3 })
    expect(res.body.data[0]).toMatchObject({ numero: "NC-000007", origenNumero: "CEL099", clienteNombre: "Juan Pérez", motivo: "Trabajo no realizado" })
  })

  it("nunca pide más de 100 filas", async () => {
    const chains = setup()
    await get("?limit=5000")
    expect(chains.vista.range).toHaveBeenCalledWith(0, 99)
  })

  it("aplica origen, modo, motivo, estado, cliente y número", async () => {
    const chains = setup()
    await get("?origen=VENTA&modo=ITEMS&motivo=GARANTIA&estado=ANULADA&cliente=cli-9&q=NC-0001")
    expect(chains.vista.eq).toHaveBeenCalledWith("origen", "VENTA")
    expect(chains.vista.eq).toHaveBeenCalledWith("modo", "ITEMS")
    expect(chains.vista.eq).toHaveBeenCalledWith("motivo_nc", "GARANTIA")
    expect(chains.vista.eq).toHaveBeenCalledWith("anulada", true)
    expect(chains.vista.eq).toHaveBeenCalledWith("cliente_id", "cli-9")
    expect(chains.vista.ilike).toHaveBeenCalledWith("numero", "%NC-0001%")
  })

  it("estado ACTIVA filtra las no anuladas", async () => {
    const chains = setup()
    await get("?estado=ACTIVA")
    expect(chains.vista.eq).toHaveBeenCalledWith("anulada", false)
  })

  // Review Focus 3: una NC de las 22:30 de Argentina (01:30 UTC del 14) es del 13.
  it("las fechas son días de la organización, no días UTC", async () => {
    const chains = setup()
    await get("?desde=2026-10-13&hasta=2026-10-13")
    expect(chains.vista.gte).toHaveBeenCalledWith("fecha", "2026-10-13T03:00:00.000Z")
    expect(chains.vista.lte).toHaveBeenCalledWith("fecha", "2026-10-14T02:59:59.999Z")
  })

  it("con otra zona horaria corre el corte del día", async () => {
    const chains = setup({ zona: "Europe/Madrid" })
    await get("?desde=2026-10-13")
    expect(chains.vista.gte).toHaveBeenCalledWith("fecha", "2026-10-12T22:00:00.000Z")
  })

  it("sin sucursal elegida no filtra por sucursal", async () => {
    const chains = setup()
    await get()
    expect(chains.vista.eq).not.toHaveBeenCalledWith("sucursal_id", expect.anything())
  })

  it("con la sucursal elegida en el selector filtra por ella", async () => {
    mockCookie("suc-2")
    const chains = setup()
    await get()
    expect(chains.vista.eq).toHaveBeenCalledWith("sucursal_id", "suc-2")
  })

  it("un error de la vista responde 500", async () => {
    setup({ vistaError: { message: "boom" } })
    const res = await get()
    expect(res.status).toBe(500)
  })

  // PGRST103 = rango no satisfacible: la página pedida está más allá de la última.
  it("una página más allá de la última responde 200 vacío con el total real", async () => {
    setup({ filas: [], count: 41, vistaError: { code: "PGRST103", message: "Requested range not satisfiable" } })
    const res = await parseResponse(await get("?page=9&limit=20"))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ data: [], total: 41, page: 9, limit: 20, totalPages: 3 })
  })

  it("sin resultados devuelve una página vacía", async () => {
    setup({ filas: [], count: 0 })
    const res = await parseResponse(await get())
    expect(res.body).toEqual({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 })
  })
})
