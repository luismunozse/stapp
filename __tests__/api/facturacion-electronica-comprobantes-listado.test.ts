// @vitest-environment node
/**
 * Tests: GET /api/facturacion-electronica/comprobantes
 *
 * ADMIN-only, org-scoped listing. NOT gated by plan/toggle (the ledger stays
 * readable after a downgrade); `puedeEmitir` carries the gate for the UI. The
 * mock inspects the SELECT string and filters, never call counts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockAuthError, createChainMock, createGetRequest } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

vi.mock("@/lib/facturacion/access", () => ({
  canEmitirFacturaElectronica: vi.fn(),
}))

import { canEmitirFacturaElectronica } from "@/lib/facturacion/access"
import { GET } from "@/app/api/facturacion-electronica/comprobantes/route"

const URL_BASE = "http://localhost:3000/api/facturacion-electronica/comprobantes"
const get = (qs = "") => GET(createGetRequest(qs ? `${URL_BASE}?${qs}` : URL_BASE))

const FILA = {
  id: "comp-1",
  venta_id: "venta-1",
  tipo: "B",
  punto_venta: 1,
  numero: "0001-00000123",
  cae: "70417054367476",
  cae_vencimiento: "20261029",
  estado: "emitido",
  pdf_url: null,
  total: 121,
  provider: "arca",
  error_msg: null,
  created_at: "2026-10-19T12:00:00Z",
  updated_at: "2026-10-19T12:00:00Z",
  fecha_emision: "2026-10-19",
  cuit_emisor: "30000000007",
  cbte_tipo: 6,
  moneda: "PES",
  cotizacion: 1,
  importe_neto: 100,
  importe_iva: 21,
  importe_total: 121,
  receptor_doc_tipo_cod: 99,
  receptor_doc_nro_cod: "0",
  detalle: [{ descripcion: "x" }],
  ventas: { numero_venta: 77 },
  // Aunque el SELECT jamas lo pida, el DTO tampoco debe dejarlo pasar.
  provider_response: { secreto: true },
}

/** Responde segun el SELECT recibido: `respuesta(select)` -> {data, error, count}. */
function mockDb(respuesta: (select: string) => { data: any; error: any; count?: number }) {
  const chains: any[] = []
  vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) => {
    if (table !== "comprobantes_fiscales") {
      return createChainMock(null, { message: `No mock for table: ${table}` }) as any
    }
    const chain = createChainMock() as any
    chain.select = vi.fn((select: string) => {
      const res = respuesta(select)
      chain.then = (resolve: any, reject?: any) => Promise.resolve(res).then(resolve, reject)
      return chain
    })
    chains.push(chain)
    return chain
  }) as any)
  return chains
}

const selectDe = (chain: any): string => String(chain.select.mock.calls[0][0])

describe("GET /api/facturacion-electronica/comprobantes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN" })
    vi.mocked(canEmitirFacturaElectronica).mockResolvedValue(true)
  })

  it("401 sin sesion", async () => {
    mockAuthError()
    expect((await get()).status).toBe(401)
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it("403 para vendedor", async () => {
    mockAuthSuccess({ role: "VENDEDOR" })
    expect((await get()).status).toBe(403)
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it("filtra por organization_id y ordena created_at desc", async () => {
    const chains = mockDb(() => ({ data: [], error: null, count: 0 }))
    await get()
    expect(chains[0].eq).toHaveBeenCalledWith("organization_id", "org-1")
    expect(chains[0].order).toHaveBeenCalledWith("created_at", { ascending: false })
  })

  it("org vacia -> items vacios sin error", async () => {
    mockDb(() => ({ data: [], error: null, count: 0 }))
    const res = await get()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ items: [], total: 0, page: 1, limit: 20, totalPages: 0 })
  })

  it("25 filas, limit 10, page 3 -> range(20, 29), total 25, totalPages 3", async () => {
    const chains = mockDb(() => ({ data: Array(5).fill(FILA), error: null, count: 25 }))
    const res = await get("limit=10&page=3")
    const body = await res.json()
    expect(chains[0].range).toHaveBeenCalledWith(20, 29)
    expect(body).toMatchObject({ total: 25, page: 3, limit: 10, totalPages: 3 })
    expect(body.items).toHaveLength(5)
  })

  it("pide el conteo exacto", async () => {
    const chains = mockDb(() => ({ data: [], error: null, count: 0 }))
    await get()
    expect(chains[0].select).toHaveBeenCalledWith(expect.any(String), { count: "exact" })
  })

  it("default limit 20 y tope 100", async () => {
    const chains = mockDb(() => ({ data: [], error: null, count: 0 }))
    await get()
    expect(chains[0].range).toHaveBeenCalledWith(0, 19)
    const chains2 = mockDb(() => ({ data: [], error: null, count: 0 }))
    const res = await get("limit=5000")
    expect(chains2[0].range).toHaveBeenCalledWith(0, 99)
    expect((await res.json()).limit).toBe(100)
  })

  it.each(["page=0", "page=-1", "page=abc", "page=1.5", "limit=0", "limit=-3", "limit=xyz"])(
    "400 con paginacion invalida (%s)",
    async (qs) => {
      mockDb(() => ({ data: [], error: null, count: 0 }))
      const res = await get(qs)
      expect(res.status).toBe(400)
    }
  )

  it("estado valido filtra; invalido -> 400", async () => {
    const chains = mockDb(() => ({ data: [], error: null, count: 0 }))
    expect((await get("estado=rechazado")).status).toBe(200)
    expect(chains[0].eq).toHaveBeenCalledWith("estado", "rechazado")
    expect((await get("estado=cualquiera")).status).toBe(400)
  })

  it("sin estado no filtra por estado", async () => {
    const chains = mockDb(() => ({ data: [], error: null, count: 0 }))
    await get()
    expect(chains[0].eq).not.toHaveBeenCalledWith("estado", expect.anything())
  })

  it("ventaId filtra por venta_id", async () => {
    const chains = mockDb(() => ({ data: [], error: null, count: 0 }))
    await get("ventaId=venta-9&limit=1")
    expect(chains[0].eq).toHaveBeenCalledWith("venta_id", "venta-9")
    expect(chains[0].eq).toHaveBeenCalledWith("organization_id", "org-1")
    expect(chains[0].range).toHaveBeenCalledWith(0, 0)
  })

  it("SELECT: columnas seguras + foto fiscal + numero_venta, jamas provider_response", async () => {
    const chains = mockDb(() => ({ data: [], error: null, count: 0 }))
    await get()
    const sel = selectDe(chains[0])
    for (const col of ["cae_vencimiento", "cuit_emisor", "importe_total", "detalle", "ventas(numero_venta)"]) {
      expect(sel).toContain(col)
    }
    expect(sel).not.toContain("provider_response")
    expect(sel).not.toContain("*")
  })

  it("DTO: campos esperados, pdfDisponible true, sin provider_response ni detalle", async () => {
    mockDb(() => ({ data: [FILA], error: null, count: 1 }))
    const body = await (await get()).json()
    expect(body.items[0]).toEqual({
      id: "comp-1",
      ventaId: "venta-1",
      numeroVenta: 77,
      tipo: "B",
      puntoVenta: 1,
      numero: "0001-00000123",
      cae: "70417054367476",
      caeVencimiento: "20261029",
      estado: "emitido",
      total: 121,
      errorMsg: null,
      pdfUrl: null,
      fechaEmision: "2026-10-19",
      createdAt: "2026-10-19T12:00:00Z",
      pdfDisponible: true,
    })
    expect(JSON.stringify(body)).not.toContain("provider_response")
    expect(JSON.stringify(body)).not.toContain("secreto")
  })

  it("pdfDisponible false si no esta emitido o la foto esta incompleta (fila legacy)", async () => {
    mockDb(() => ({
      data: [
        { ...FILA, id: "a", estado: "rechazado" },
        { ...FILA, id: "b", cuit_emisor: null, fecha_emision: null },
      ],
      error: null,
      count: 2,
    }))
    const body = await (await get()).json()
    expect(body.items.map((i: any) => i.pdfDisponible)).toEqual([false, false])
    expect(body.items[1].fechaEmision).toBeNull()
  })

  it("numeroVenta null si no hay venta embebida", async () => {
    mockDb(() => ({ data: [{ ...FILA, ventas: null }], error: null, count: 1 }))
    const body = await (await get()).json()
    expect(body.items[0].numeroVenta).toBeNull()
  })

  it("42703 en la foto fiscal -> reintenta sin esas columnas, pdfDisponible false", async () => {
    const chains = mockDb((select) =>
      select.includes("cuit_emisor")
        ? { data: null, error: { code: "42703", message: 'column "cuit_emisor" does not exist' } }
        : {
            data: [{ ...FILA, cuit_emisor: undefined, fecha_emision: undefined, importe_total: undefined, detalle: undefined }],
            error: null,
            count: 1,
          }
    )
    const res = await get()
    expect(res.status).toBe(200)
    const sels = chains.map(selectDe)
    expect(sels).toHaveLength(2)
    expect(sels[0]).toContain("cuit_emisor")
    expect(sels[1]).not.toContain("cuit_emisor")
    expect(sels[1]).toContain("ventas(numero_venta)")
    expect(sels[1]).not.toContain("provider_response")
    const body = await res.json()
    expect(body.items[0].pdfDisponible).toBe(false)
    expect(body.items[0].fechaEmision).toBeNull()
    // El reintento conserva los filtros (nunca se pierde el scoping por org).
    expect(chains[1].eq).toHaveBeenCalledWith("organization_id", "org-1")
  })

  it("otro error de DB -> 500", async () => {
    mockDb(() => ({ data: null, error: { code: "XX000", message: "boom" } }))
    expect((await get()).status).toBe(500)
  })

  it("puedeEmitir refleja canEmitirFacturaElectronica", async () => {
    mockDb(() => ({ data: [], error: null, count: 0 }))
    vi.mocked(canEmitirFacturaElectronica).mockResolvedValue(true)
    expect((await (await get()).json()).puedeEmitir).toBe(true)
    expect(canEmitirFacturaElectronica).toHaveBeenCalledWith("org-1")
  })

  it("NO esta gateado: con canEmitir false igual lista (downgrade) y puedeEmitir=false", async () => {
    mockDb(() => ({ data: [FILA], error: null, count: 1 }))
    vi.mocked(canEmitirFacturaElectronica).mockResolvedValue(false)
    const body = await (await get()).json()
    expect(body.items).toHaveLength(1)
    expect(body.puedeEmitir).toBe(false)
  })

  it("fail-closed: si canEmitir tira, puedeEmitir=false y el listado sigue", async () => {
    mockDb(() => ({ data: [FILA], error: null, count: 1 }))
    vi.mocked(canEmitirFacturaElectronica).mockRejectedValue(new Error("db"))
    const res = await get()
    expect(res.status).toBe(200)
    expect((await res.json()).puedeEmitir).toBe(false)
  })
})
