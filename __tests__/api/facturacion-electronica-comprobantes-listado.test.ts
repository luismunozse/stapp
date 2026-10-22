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

// Nota de credito electronica (cbte_tipo 8) asociada a FILA, con las columnas de la migracion 371.
const NC = {
  ...FILA,
  id: "nc-1",
  numero: "0001-00000002",
  cae: "70417054367999",
  cbte_tipo: 8,
  comprobante_asociado_id: "comp-1",
  cbte_nro_solicitado: 2,
  motivo: "error_factura",
  motivo_detalle: null,
  anulado_at: null,
}

// Factura anulada: sigue siendo un comprobante emitido con su PDF.
const ANULADA = { ...FILA, estado: "anulado", anulado_at: "2026-10-20T13:00:00Z" }

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

  it.each(["a b", "x,y", "abc'--", "a".repeat(65)])("ventaId con forma invalida (%j) -> 400 sin tocar la DB", async (v) => {
    const res = await get(`ventaId=${encodeURIComponent(v)}`)
    expect(res.status).toBe(400)
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it("22P02 de Postgres -> 400 (no 500)", async () => {
    mockDb(() => ({ data: null, error: { code: "22P02", message: "invalid input syntax" } }))
    expect((await get("ventaId=cabc123")).status).toBe(400)
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

  it("SELECT: columnas seguras + foto fiscal + anulacion + numero_venta, jamas provider_response", async () => {
    const chains = mockDb(() => ({ data: [], error: null, count: 0 }))
    await get()
    const sel = selectDe(chains[0])
    for (const col of [
      "cae_vencimiento",
      "cuit_emisor",
      "importe_total",
      "detalle",
      "ventas(numero_venta)",
      "comprobante_asociado_id",
      "cbte_nro_solicitado",
      "motivo_detalle",
      "anulado_at",
    ]) {
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
      cbteTipo: 6,
      esNotaCredito: false,
      comprobanteAsociadoId: null,
      anuladoAt: null,
      motivo: null,
      motivoDetalle: null,
      anulable: true,
      verificable: false,
      notaCreditoEnCursoId: null,
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

  it("42703 en la foto fiscal -> cae hasta las columnas seguras, pdfDisponible false", async () => {
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
    // Los dos primeros escalones nombran la foto fiscal: el tercero es el unico sin ella.
    const sels = chains.map(selectDe)
    expect(sels).toHaveLength(3)
    expect(sels[0]).toContain("cuit_emisor")
    expect(sels[1]).toContain("cuit_emisor")
    expect(sels[2]).not.toContain("cuit_emisor")
    expect(sels[2]).toContain("ventas(numero_venta)")
    expect(sels[2]).not.toContain("provider_response")
    const body = await res.json()
    expect(body.items[0].pdfDisponible).toBe(false)
    expect(body.items[0].fechaEmision).toBeNull()
    // Cada reintento conserva los filtros (nunca se pierde el scoping por org).
    for (const chain of chains) expect(chain.eq).toHaveBeenCalledWith("organization_id", "org-1")
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

  describe("notas de credito y facturas anuladas (migracion 371)", () => {
    it("estado=anulado es un filtro valido y filtra por esa columna", async () => {
      const chains = mockDb(() => ({ data: [ANULADA], error: null, count: 1 }))
      const res = await get("estado=anulado")
      expect(res.status).toBe(200)
      expect(chains[0].eq).toHaveBeenCalledWith("estado", "anulado")
      expect(chains[0].eq).toHaveBeenCalledWith("organization_id", "org-1")
      expect((await res.json()).items.map((i: any) => i.id)).toEqual(["comp-1"])
    })

    it("las notas de credito vienen junto a las facturas: ningun filtro las descarta", async () => {
      const chains = mockDb(() => ({ data: [NC, FILA], error: null, count: 2 }))
      const body = await (await get()).json()
      expect(body.items.map((i: any) => i.id)).toEqual(["nc-1", "comp-1"])
      // Un `.or`/`.neq`/`.not` sobre cbte_tipo sacaria las NC del listado.
      expect(chains[0].or).not.toHaveBeenCalled()
      expect(chains[0].neq).not.toHaveBeenCalled()
      expect(chains[0].not).not.toHaveBeenCalled()
    })

    it("fila NC B emitida: se reconoce por cbte_tipo, apunta a su factura y lleva el motivo", async () => {
      mockDb(() => ({ data: [{ ...NC, motivo: "otro", motivo_detalle: "Error de carga" }], error: null, count: 1 }))
      const body = await (await get()).json()
      expect(body.items[0]).toEqual({
        id: "nc-1",
        ventaId: "venta-1",
        numeroVenta: 77,
        tipo: "B",
        puntoVenta: 1,
        numero: "0001-00000002",
        cae: "70417054367999",
        caeVencimiento: "20261029",
        estado: "emitido",
        total: 121,
        errorMsg: null,
        pdfUrl: null,
        fechaEmision: "2026-10-19",
        createdAt: "2026-10-19T12:00:00Z",
        pdfDisponible: true,
        cbteTipo: 8,
        esNotaCredito: true,
        comprobanteAsociadoId: "comp-1",
        anuladoAt: null,
        motivo: "otro",
        motivoDetalle: "Error de carga",
        anulable: false,
        verificable: false,
        notaCreditoEnCursoId: null,
      })
    })

    it("esNotaCredito sale de cbte_tipo (8/13), no de la columna de asociacion de la 371", async () => {
      // Sin la 371 el SELECT no trae comprobante_asociado_id: el criterio no puede depender de ella.
      mockDb(() => ({
        data: [
          { ...NC, comprobante_asociado_id: undefined },
          { ...NC, id: "nc-2", cbte_tipo: 13, comprobante_asociado_id: undefined },
          { ...FILA, comprobante_asociado_id: "otra" },
        ],
        error: null,
        count: 3,
      }))
      const items = (await (await get()).json()).items
      expect(items.map((i: any) => i.esNotaCredito)).toEqual([true, true, false])
    })

    it("fila NC C (13) tambien es nota de credito y jamas anulable", async () => {
      mockDb(() => ({ data: [{ ...NC, tipo: "C", cbte_tipo: 13, importe_iva: 0 }], error: null, count: 1 }))
      const item = (await (await get()).json()).items[0]
      expect(item).toMatchObject({ cbteTipo: 13, esNotaCredito: true, anulable: false, pdfDisponible: true })
    })

    it("NC pendiente con numero pedido: verificable, sin PDF", async () => {
      mockDb(() => ({
        data: [{ ...NC, estado: "pendiente", numero: null, cae: null, cae_vencimiento: null }],
        error: null,
        count: 1,
      }))
      const item = (await (await get()).json()).items[0]
      expect(item).toMatchObject({ estado: "pendiente", verificable: true, pdfDisponible: false, anulable: false })
    })

    it.each([
      ["pendiente sin numero pedido", { estado: "pendiente", cbte_nro_solicitado: null }],
      ["rechazada", { estado: "rechazado" }],
      ["emitida", { estado: "emitido" }],
    ])("NC %s: no verificable", async (_nombre, over) => {
      mockDb(() => ({ data: [{ ...NC, ...over }], error: null, count: 1 }))
      expect((await (await get()).json()).items[0].verificable).toBe(false)
    })

    it("una factura pendiente nunca es verificable (solo las NC)", async () => {
      mockDb(() => ({ data: [{ ...FILA, estado: "pendiente", cbte_nro_solicitado: 3 }], error: null, count: 1 }))
      expect((await (await get()).json()).items[0].verificable).toBe(false)
    })

    it("factura anulada: conserva su PDF, muestra cuando se anulo y ya no es anulable", async () => {
      mockDb(() => ({ data: [ANULADA], error: null, count: 1 }))
      const item = (await (await get()).json()).items[0]
      expect(item).toMatchObject({
        estado: "anulado",
        anuladoAt: "2026-10-20T13:00:00Z",
        pdfDisponible: true,
        anulable: false,
        esNotaCredito: false,
      })
    })

    it.each([
      ["emitido", true],
      ["anulado", true],
      ["pendiente", false],
      ["rechazado", false],
    ])("pdfDisponible con estado %s = %s (foto completa)", async (estado, esperado) => {
      mockDb(() => ({ data: [{ ...FILA, estado }], error: null, count: 1 }))
      expect((await (await get()).json()).items[0].pdfDisponible).toBe(esperado)
    })

    it("factura anulada con foto fiscal incompleta (legacy): sin PDF", async () => {
      mockDb(() => ({ data: [{ ...ANULADA, cuit_emisor: null }], error: null, count: 1 }))
      expect((await (await get()).json()).items[0].pdfDisponible).toBe(false)
    })

    it.each([
      ["arca emitida", {}, true],
      ["arca_delegado emitida", { provider: "arca_delegado" }, true],
      ["tusfacturas", { provider: "tusfacturas" }, false],
      ["rechazada", { estado: "rechazado" }, false],
      ["sin CAE", { cae: null }, false],
    ])("anulable: factura %s -> %s", async (_nombre, over, esperado) => {
      mockDb(() => ({ data: [{ ...FILA, ...over }], error: null, count: 1 }))
      expect((await (await get()).json()).items[0].anulable).toBe(esperado)
    })

    it("sin la 371 (42703 en las columnas de anulacion) cae al escalon de la foto fiscal", async () => {
      const chains = mockDb((select) =>
        select.includes("comprobante_asociado_id")
          ? { data: null, error: { code: "42703", message: 'column "comprobante_asociado_id" does not exist' } }
          : { data: [FILA], error: null, count: 1 }
      )
      const res = await get()
      expect(res.status).toBe(200)
      const sels = chains.map(selectDe)
      expect(sels).toHaveLength(2)
      expect(sels[1]).toContain("cuit_emisor")
      expect(sels[1]).toContain("cbte_tipo")
      for (const col of ["comprobante_asociado_id", "cbte_nro_solicitado", "motivo", "anulado_at"]) {
        expect(sels[1]).not.toContain(col)
      }
      const item = (await res.json()).items[0]
      // La foto fiscal sigue completa: el PDF no se pierde.
      expect(item).toMatchObject({
        pdfDisponible: true,
        cbteTipo: 6,
        esNotaCredito: false,
        comprobanteAsociadoId: null,
        anuladoAt: null,
        motivo: null,
        motivoDetalle: null,
        // Sin la 371 no hay notas de credito que mirar ni ruta que las emita: nunca se ofrece anular.
        anulable: false,
        verificable: false,
        notaCreditoEnCursoId: null,
      })
    })

    it("sin la 371 ni la foto fiscal: tres escalones, y la fila legacy no se puede anular ni verificar", async () => {
      const chains = mockDb((select) =>
        select.includes("cuit_emisor") || select.includes("comprobante_asociado_id")
          ? { data: null, error: { code: "42703", message: "column does not exist" } }
          : {
              data: [{ ...FILA, cbte_tipo: undefined, cuit_emisor: undefined, fecha_emision: undefined }],
              error: null,
              count: 1,
            }
      )
      const res = await get()
      expect(res.status).toBe(200)
      expect(chains.map(selectDe)).toHaveLength(3)
      const item = (await res.json()).items[0]
      expect(item).toMatchObject({ cbteTipo: null, esNotaCredito: false, pdfDisponible: false, verificable: false })
    })

    it("cada escalon conserva organization_id, estado y ventaId", async () => {
      const chains = mockDb((select) =>
        select.includes("cuit_emisor")
          ? { data: null, error: { code: "42703", message: "column does not exist" } }
          : { data: [], error: null, count: 0 }
      )
      await get("estado=emitido&ventaId=venta-9")
      expect(chains).toHaveLength(3)
      for (const chain of chains) {
        expect(chain.eq).toHaveBeenCalledWith("organization_id", "org-1")
        expect(chain.eq).toHaveBeenCalledWith("estado", "emitido")
        expect(chain.eq).toHaveBeenCalledWith("venta_id", "venta-9")
      }
    })

    it("estado=anulado sin la 371: lista vacia, aunque la base devolviera filas", async () => {
      // Sin la migracion no puede haber facturas anuladas: un escalon de respaldo
      // jamas debe inventarlas. La base de este test devuelve una fila a proposito.
      const chains = mockDb((select) =>
        select.includes("comprobante_asociado_id")
          ? { data: null, error: { code: "42703", message: "column does not exist" } }
          : { data: [FILA], error: null, count: 1 }
      )
      const res = await get("estado=anulado")
      expect(res.status).toBe(200)
      expect(chains).toHaveLength(1)
      expect(await res.json()).toMatchObject({ items: [], total: 0, page: 1, totalPages: 0 })
    })

    it("un error que no es de columna faltante en el segundo escalon -> 500", async () => {
      mockDb((select) =>
        select.includes("comprobante_asociado_id")
          ? { data: null, error: { code: "42703", message: "column does not exist" } }
          : { data: null, error: { code: "XX000", message: "boom" } }
      )
      expect((await get()).status).toBe(500)
    })
  })

  describe("anulable y nota de credito en curso (consulta de notas por pagina)", () => {
    const FACTURA_2 = { ...FILA, id: "comp-2", numero: "0001-00000124" }
    // La consulta de notas es la unica que no embebe la venta.
    const esConsultaDeNotas = (select: string) => !select.includes("ventas(numero_venta)")
    const consultasDeNotas = (chains: any[]) => chains.filter((c) => esConsultaDeNotas(selectDe(c)))
    const NC_EN_CURSO = { id: "nc-9", comprobante_asociado_id: "comp-1", estado: "pendiente" }

    function mockPagina(filas: any[], notas: { data: any; error?: any }) {
      return mockDb((select) =>
        esConsultaDeNotas(select)
          ? { data: notas.data, error: notas.error ?? null }
          : { data: filas, error: null, count: filas.length }
      )
    }

    it("busca las notas de la pagina: misma org, ids de las facturas anulables y estados pendiente/emitido", async () => {
      const chains = mockPagina([FILA, FACTURA_2, { ...FILA, id: "rech", estado: "rechazado" }], { data: [] })
      await get()
      const [consulta] = consultasDeNotas(chains)
      expect(consulta).toBeDefined()
      expect(consulta.eq).toHaveBeenCalledWith("organization_id", "org-1")
      expect(consulta.in).toHaveBeenCalledWith("comprobante_asociado_id", ["comp-1", "comp-2"])
      expect(consulta.in).toHaveBeenCalledWith("estado", ["pendiente", "emitido"])
      expect(selectDe(consulta)).toContain("comprobante_asociado_id")
      expect(selectDe(consulta)).not.toContain("provider_response")
      expect(selectDe(consulta)).not.toContain("*")
    })

    it("sin facturas anulables en la pagina no consulta notas", async () => {
      const chains = mockPagina([{ ...FILA, estado: "rechazado" }, ANULADA, NC], { data: [] })
      await get()
      expect(consultasDeNotas(chains)).toHaveLength(0)
    })

    it("factura sin notas en curso: sigue anulable y sin nota", async () => {
      mockPagina([FILA], { data: [] })
      const item = (await (await get()).json()).items[0]
      expect(item).toMatchObject({ anulable: true, notaCreditoEnCursoId: null })
    })

    it.each(["pendiente", "emitido"])("factura con una nota %s: ya no es anulable y expone la nota", async (estado) => {
      mockPagina([FILA, FACTURA_2], { data: [{ ...NC_EN_CURSO, estado }] })
      const items = (await (await get()).json()).items
      expect(items[0]).toMatchObject({ id: "comp-1", anulable: false, notaCreditoEnCursoId: "nc-9" })
      // La otra factura de la pagina no se toca.
      expect(items[1]).toMatchObject({ id: "comp-2", anulable: true, notaCreditoEnCursoId: null })
    })

    it("una nota que apunta a otra factura no afecta a esta", async () => {
      mockPagina([FILA], { data: [{ id: "nc-7", comprobante_asociado_id: "otra" }] })
      expect((await (await get()).json()).items[0]).toMatchObject({ anulable: true, notaCreditoEnCursoId: null })
    })

    it("la nota de credito misma no lleva nota en curso", async () => {
      mockPagina([NC, FILA], { data: [{ id: "nc-1", comprobante_asociado_id: "comp-1" }] })
      const items = (await (await get()).json()).items
      expect(items[0]).toMatchObject({ id: "nc-1", notaCreditoEnCursoId: null, anulable: false })
      expect(items[1]).toMatchObject({ id: "comp-1", notaCreditoEnCursoId: "nc-1", anulable: false })
    })

    it("si la consulta de notas falla, no se ofrece anular (fail-closed) y el listado sigue", async () => {
      mockPagina([FILA, FACTURA_2], { data: null, error: { code: "XX000", message: "boom" } })
      const res = await get()
      expect(res.status).toBe(200)
      const items = (await res.json()).items
      expect(items.map((i: any) => i.anulable)).toEqual([false, false])
      expect(items.map((i: any) => i.notaCreditoEnCursoId)).toEqual([null, null])
    })

    it("sin la 371 (escalon sin columnas de anulacion) no hay consulta de notas y nada es anulable", async () => {
      const chains = mockDb((select) =>
        select.includes("comprobante_asociado_id")
          ? { data: null, error: { code: "42703", message: "column does not exist" } }
          : { data: [FILA], error: null, count: 1 }
      )
      const res = await get()
      expect(res.status).toBe(200)
      expect(consultasDeNotas(chains)).toHaveLength(0)
      expect((await res.json()).items[0]).toMatchObject({ anulable: false, notaCreditoEnCursoId: null })
    })
  })
})
