// @vitest-environment node
/**
 * Tests: GET /api/facturacion-electronica/comprobantes/[id]/pdf
 *
 * ADMIN-only, org-scoped, emitido or anulado only (an annulled invoice stays
 * printable; pendiente/rechazado answer 409). A credit note loads the invoice it
 * annuls with a second org-scoped query. Deliberately NOT gated by plan/toggle:
 * a fiscal document must stay readable after a downgrade. The mock inspects
 * the SELECT strings and filters of each query (a mock that ignores them would
 * hide a missing fallback tier).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockAuthError, createChainMock, createGetRequest } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

vi.mock("@/lib/facturacion/access", () => ({
  canEmitirFacturaElectronica: vi.fn(),
}))

vi.mock("@/lib/comprobante-fiscal-react-pdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/comprobante-fiscal-react-pdf")>()
  return { ...actual, generateComprobanteFiscalPDF: vi.fn() }
})

import { canEmitirFacturaElectronica } from "@/lib/facturacion/access"
import {
  generateComprobanteFiscalPDF,
  ComprobanteIncompletoError,
} from "@/lib/comprobante-fiscal-react-pdf"
import { GET } from "@/app/api/facturacion-electronica/comprobantes/[id]/pdf/route"

const ctx = (id = "comp-1") => ({ params: Promise.resolve({ id }) })

const FILA = {
  id: "comp-1",
  venta_id: "venta-1",
  tipo: "B",
  punto_venta: 1,
  numero: "0001-00000123",
  cae: "70417054367476",
  cae_vencimiento: "20261029",
  estado: "emitido",
  total: 121,
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
  detalle: [],
}

// Nota de credito B (cbte_tipo 8) que anula a FILA, con la columna de la migracion 371.
const NC = {
  ...FILA,
  id: "nc-1",
  numero: "0001-00000124",
  cae: "70417054367999",
  cbte_tipo: 8,
  comprobante_asociado_id: "comp-1",
}

// La factura que anula la NC, tal como la lee la segunda consulta. provider_response
// solo se usa en el servidor para fechar una factura legada: nunca sale en el PDF.
const ASOCIADA = {
  tipo: "B",
  numero: "0001-00000123",
  fecha_emision: "2026-10-19",
  provider_response: { secreto: true },
}

const ORG = {
  id: "org-1",
  nombre: "Taller SA",
  nombre_mostrar: "Taller Display",
  cuit: "30-00000000-7",
  condicion_iva: "RESPONSABLE_INSCRIPTO",
  domicilio_fiscal: "Calle 123",
  direccion: "Calle 456",
  telefono: "11 5555",
  logo_url: "https://logo",
  pais: "AR",
  ingresos_brutos: "IIBB-1",
  inicio_actividades: "2020-01-01",
}

type Llamada = { table: string; chain: ReturnType<typeof createChainMock> }

/**
 * `comprobantes_fiscales` responde por tier según el SELECT que reciba:
 * `porSelect` decide data/error mirando el string, no el orden de llamadas.
 */
function mockDb(opts: {
  comprobante: (select: string) => { data: any; error: any }
  org?: { data: any; error: any }
}) {
  const llamadas: Llamada[] = []
  vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) => {
    if (table === "comprobantes_fiscales") {
      const chain = createChainMock() as any
      chain.select = vi.fn((select: string) => {
        const res = opts.comprobante(select)
        chain.single = vi.fn().mockResolvedValue(res)
        chain.maybeSingle = vi.fn().mockResolvedValue(res)
        return chain
      })
      llamadas.push({ table, chain })
      return chain
    }
    if (table === "organizations") {
      const chain = createChainMock(opts.org?.data ?? ORG, opts.org?.error ?? null)
      llamadas.push({ table, chain })
      return chain
    }
    return createChainMock(null, { message: `No mock for table: ${table}` }) as any
  }) as any)
  return llamadas
}

const selects = (llamadas: Llamada[], table = "comprobantes_fiscales") =>
  llamadas
    .filter((l) => l.table === table)
    .map((l) => String(l.chain.select.mock.calls[0]?.[0]))

describe("GET /api/facturacion-electronica/comprobantes/[id]/pdf", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN" })
    vi.mocked(generateComprobanteFiscalPDF).mockResolvedValue(Buffer.from("%PDF-1.7 fake"))
  })

  it("401 sin sesion", async () => {
    mockAuthError()
    const res = await GET(createGetRequest(), ctx())
    expect(res.status).toBe(401)
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it("403 para quien no es ADMIN", async () => {
    mockAuthSuccess({ role: "VENDEDOR" })
    const res = await GET(createGetRequest(), ctx())
    expect(res.status).toBe(403)
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it.each(["", "a b", "x,y", "abc'--", "a".repeat(65), "../etc"])(
    "404 sin tocar la DB cuando el id tiene forma invalida (%j)",
    async (id) => {
      const res = await GET(createGetRequest(), ctx(id))
      expect(res.status).toBe(404)
      expect(supabaseAdmin.from).not.toHaveBeenCalled()
    }
  )

  it("404 (no 500) si Postgres rechaza el id con 22P02", async () => {
    mockDb({ comprobante: () => ({ data: null, error: { code: "22P02", message: "invalid input syntax" } }) })
    const res = await GET(createGetRequest(), ctx("cabc123"))
    expect(res.status).toBe(404)
  })

  it("200 application/pdf inline con nombre factura-B-0001-00000123.pdf", async () => {
    mockDb({ comprobante: () => ({ data: FILA, error: null }) })
    const res = await GET(createGetRequest(), ctx())
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("application/pdf")
    expect(res.headers.get("Content-Disposition")).toBe('inline; filename="factura-B-0001-00000123.pdf"')
    expect(res.headers.get("Cache-Control")).toMatch(/private/)
    const bytes = Buffer.from(await res.arrayBuffer())
    expect(bytes.toString().startsWith("%PDF")).toBe(true)
  })

  it("filtra por id Y organization_id (los numeros se repiten entre orgs); el estado se decide despues", async () => {
    const llamadas = mockDb({ comprobante: () => ({ data: FILA, error: null }) })
    await GET(createGetRequest(), ctx("comp-9"))
    const comp = llamadas.find((l) => l.table === "comprobantes_fiscales")!.chain
    expect(comp.eq).toHaveBeenCalledWith("id", "comp-9")
    expect(comp.eq).toHaveBeenCalledWith("organization_id", "org-1")
    expect(comp.eq).not.toHaveBeenCalledWith("estado", expect.anything())
    const org = llamadas.find((l) => l.table === "organizations")!.chain
    expect(org.eq).toHaveBeenCalledWith("id", "org-1")
  })

  it("404 si el comprobante es de otra org (no hay fila)", async () => {
    mockDb({ comprobante: () => ({ data: null, error: null }) })
    const res = await GET(createGetRequest(), ctx("de-otra-org"))
    expect(res.status).toBe(404)
    expect(generateComprobanteFiscalPDF).not.toHaveBeenCalled()
  })

  it("NO esta gateado por plan ni toggle (legible despues de un downgrade)", async () => {
    vi.mocked(canEmitirFacturaElectronica).mockResolvedValue(false)
    mockDb({ comprobante: () => ({ data: FILA, error: null }) })
    const res = await GET(createGetRequest(), ctx())
    expect(res.status).toBe(200)
    expect(canEmitirFacturaElectronica).not.toHaveBeenCalled()
  })

  it("SELECT tier1 = columnas seguras + foto fiscal + la asociacion de la 371, sin provider_response", async () => {
    const llamadas = mockDb({ comprobante: () => ({ data: FILA, error: null }) })
    await GET(createGetRequest(), ctx())
    const [sel] = selects(llamadas)
    for (const col of ["cae", "cae_vencimiento", "fecha_emision", "cuit_emisor", "cbte_tipo", "moneda", "cotizacion", "importe_neto", "importe_iva", "importe_total", "receptor_doc_tipo_cod", "receptor_doc_nro_cod", "detalle", "estado", "comprobante_asociado_id"]) {
      expect(sel).toContain(col)
    }
    expect(sel).not.toContain("provider_response")
  })

  it("42703 en la foto fiscal -> cae hasta las columnas seguras -> 409 datos incompletos, sin PDF", async () => {
    const llamadas = mockDb({
      comprobante: (select) =>
        select.includes("cuit_emisor")
          ? { data: null, error: { code: "42703", message: 'column "cuit_emisor" does not exist' } }
          : { data: { ...FILA, cuit_emisor: undefined, detalle: undefined }, error: null },
    })
    const res = await GET(createGetRequest(), ctx())
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/datos incompletos/i)
    // Los dos primeros escalones nombran la foto fiscal: el tercero es el unico sin ella.
    const sels = selects(llamadas)
    expect(sels).toHaveLength(3)
    expect(sels[0]).toContain("cuit_emisor")
    expect(sels[1]).toContain("cuit_emisor")
    expect(sels[2]).not.toContain("cuit_emisor")
    expect(sels[2]).not.toContain("provider_response")
    expect(generateComprobanteFiscalPDF).not.toHaveBeenCalled()
    for (const l of llamadas.filter((x) => x.table === "comprobantes_fiscales")) {
      expect(l.chain.eq).toHaveBeenCalledWith("organization_id", "org-1")
    }
  })

  it("fila legacy (foto NULL) -> el generador tira ComprobanteIncompletoError -> 409, sin QR", async () => {
    mockDb({ comprobante: () => ({ data: { ...FILA, cuit_emisor: null, fecha_emision: null }, error: null }) })
    vi.mocked(generateComprobanteFiscalPDF).mockRejectedValue(new ComprobanteIncompletoError())
    const res = await GET(createGetRequest(), ctx())
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/datos incompletos/i)
  })

  it("otro error de DB en el SELECT -> 500 (no se enmascara como 404)", async () => {
    mockDb({ comprobante: () => ({ data: null, error: { code: "XX000", message: "boom" } }) })
    const res = await GET(createGetRequest(), ctx())
    expect(res.status).toBe(500)
  })

  it("arma el emisor desde la org (select * : a salvo de la cascada de columnas)", async () => {
    const llamadas = mockDb({ comprobante: () => ({ data: FILA, error: null }) })
    await GET(createGetRequest(), ctx())
    expect(selects(llamadas, "organizations")).toEqual(["*"])
    const arg = vi.mocked(generateComprobanteFiscalPDF).mock.calls[0][0]
    expect(arg.comprobante).toMatchObject({ numero: "0001-00000123", cae: "70417054367476" })
    expect(arg.emisor).toMatchObject({
      nombreEmpresa: "Taller Display",
      cuitEmpresa: "30-00000000-7",
      condicionIvaEmpresa: "RESPONSABLE_INSCRIPTO",
      domicilioFiscalEmpresa: "Calle 123",
      direccionEmpresa: "Calle 456",
      telefonoEmpresa: "11 5555",
      logoUrl: "https://logo",
      pais: "AR",
      ingresosBrutosEmpresa: "IIBB-1",
      inicioActividadesEmpresa: "2020-01-01",
    })
  })

  it("500 si falla la generacion del PDF", async () => {
    mockDb({ comprobante: () => ({ data: FILA, error: null }) })
    vi.mocked(generateComprobanteFiscalPDF).mockRejectedValue(new Error("render"))
    const res = await GET(createGetRequest(), ctx())
    expect(res.status).toBe(500)
  })

  describe("facturas anuladas y estados no imprimibles", () => {
    it.each(["emitido", "anulado"])("200 con una factura %s (una anulada se sigue pudiendo reimprimir)", async (estado) => {
      mockDb({ comprobante: () => ({ data: { ...FILA, estado }, error: null }) })
      const res = await GET(createGetRequest(), ctx())
      expect(res.status).toBe(200)
      expect(generateComprobanteFiscalPDF).toHaveBeenCalledTimes(1)
      expect(res.headers.get("Content-Disposition")).toBe('inline; filename="factura-B-0001-00000123.pdf"')
    })

    it("el PDF de la anulada se arma con exactamente los mismos datos que cuando estaba emitida", async () => {
      mockDb({ comprobante: () => ({ data: { ...FILA, estado: "emitido" }, error: null }) })
      await GET(createGetRequest(), ctx())
      mockDb({ comprobante: () => ({ data: { ...FILA, estado: "anulado" }, error: null }) })
      await GET(createGetRequest(), ctx())
      const [emitida, anulada] = vi.mocked(generateComprobanteFiscalPDF).mock.calls.map((c) => c[0])
      expect({ ...anulada.comprobante, estado: "emitido" }).toEqual(emitida.comprobante)
      expect(anulada.asociado ?? null).toBeNull()
    })

    it.each(["pendiente", "rechazado"])("409 con una factura %s: todavia no hay comprobante que imprimir", async (estado) => {
      mockDb({ comprobante: () => ({ data: { ...FILA, estado }, error: null }) })
      const res = await GET(createGetRequest(), ctx())
      expect(res.status).toBe(409)
      expect((await res.json()).error).toMatch(/no está emitid/i)
      expect(generateComprobanteFiscalPDF).not.toHaveBeenCalled()
    })

    it("una factura no hace una segunda consulta de comprobantes", async () => {
      const llamadas = mockDb({ comprobante: () => ({ data: { ...FILA, estado: "anulado" }, error: null }) })
      await GET(createGetRequest(), ctx())
      expect(llamadas.filter((l) => l.table === "comprobantes_fiscales")).toHaveLength(1)
    })

    it("sin la 371 (42703 en la asociacion) cae al escalon de la foto fiscal y la factura se imprime", async () => {
      const llamadas = mockDb({
        comprobante: (select) =>
          select.includes("comprobante_asociado_id")
            ? { data: null, error: { code: "42703", message: 'column "comprobante_asociado_id" does not exist' } }
            : { data: FILA, error: null },
      })
      const res = await GET(createGetRequest(), ctx())
      expect(res.status).toBe(200)
      const sels = selects(llamadas)
      expect(sels).toHaveLength(2)
      expect(sels[1]).toContain("cuit_emisor")
      expect(sels[1]).not.toContain("comprobante_asociado_id")
      expect(generateComprobanteFiscalPDF).toHaveBeenCalledTimes(1)
    })

    it("un error que no es de columna faltante en el segundo escalon -> 500", async () => {
      mockDb({
        comprobante: (select) =>
          select.includes("comprobante_asociado_id")
            ? { data: null, error: { code: "42703", message: "column does not exist" } }
            : { data: null, error: { code: "XX000", message: "boom" } },
      })
      expect((await GET(createGetRequest(), ctx())).status).toBe(500)
    })
  })

  describe("nota de credito electronica", () => {
    /** Responde la NC a la consulta principal y la factura asociada a la segunda (la que pide provider_response). */
    const dbNc = (asociada: { data: any; error: any } = { data: ASOCIADA, error: null }, nc: any = NC) =>
      mockDb({
        comprobante: (select) => (select.includes("provider_response") ? asociada : { data: nc, error: null }),
      })

    it("200 con nombre nota-credito-B-<numero>.pdf", async () => {
      dbNc()
      const res = await GET(createGetRequest(), ctx("nc-1"))
      expect(res.status).toBe(200)
      expect(res.headers.get("Content-Type")).toBe("application/pdf")
      expect(res.headers.get("Content-Disposition")).toBe('inline; filename="nota-credito-B-0001-00000124.pdf"')
    })

    it("una NC C se llama nota-credito-C-<numero>.pdf", async () => {
      dbNc({ data: { ...ASOCIADA, tipo: "C" }, error: null }, { ...NC, tipo: "C", cbte_tipo: 13 })
      const res = await GET(createGetRequest(), ctx("nc-1"))
      expect(res.headers.get("Content-Disposition")).toBe('inline; filename="nota-credito-C-0001-00000124.pdf"')
      // La factura asociada tambien viaja con su letra: la linea sintetica y "Comprobante asociado" dicen C.
      expect(vi.mocked(generateComprobanteFiscalPDF).mock.calls[0][0].asociado?.tipo).toBe("C")
    })

    it("carga la factura que anula con una segunda consulta acotada por id Y organizacion", async () => {
      const llamadas = dbNc()
      await GET(createGetRequest(), ctx("nc-1"))
      const consultas = llamadas.filter((l) => l.table === "comprobantes_fiscales")
      expect(consultas).toHaveLength(2)
      const asociada = consultas[1].chain
      expect(asociada.eq).toHaveBeenCalledWith("id", "comp-1")
      expect(asociada.eq).toHaveBeenCalledWith("organization_id", "org-1")
      const sel = String(asociada.select.mock.calls[0][0])
      for (const col of ["tipo", "numero", "fecha_emision", "provider_response"]) expect(sel).toContain(col)
    })

    it("le pasa al generador solo tipo, numero y fecha de la factura (nunca provider_response)", async () => {
      dbNc()
      await GET(createGetRequest(), ctx("nc-1"))
      const arg = vi.mocked(generateComprobanteFiscalPDF).mock.calls[0][0]
      expect(arg.asociado).toEqual({ tipo: "B", numero: "0001-00000123", fecha: "2026-10-19" })
      expect(JSON.stringify(arg)).not.toContain("secreto")
      expect(arg.comprobante).toMatchObject({ numero: "0001-00000124", cbte_tipo: 8, cae: "70417054367999" })
    })

    it("factura legada sin fecha_emision: la fecha sale de CbteFch de la respuesta de ARCA guardada", async () => {
      dbNc({
        data: {
          ...ASOCIADA,
          fecha_emision: null,
          provider_response: { FeDetResp: { FECAEDetResponse: [{ Resultado: "A", CbteFch: "20261015" }] } },
        },
        error: null,
      })
      await GET(createGetRequest(), ctx("nc-1"))
      expect(vi.mocked(generateComprobanteFiscalPDF).mock.calls[0][0].asociado).toEqual({
        tipo: "B",
        numero: "0001-00000123",
        fecha: "2026-10-15",
      })
    })

    it("con fecha_emision y respuesta a la vez, manda fecha_emision", async () => {
      dbNc({
        data: { ...ASOCIADA, provider_response: { FeDetResp: { FECAEDetResponse: [{ CbteFch: "20200101" }] } } },
        error: null,
      })
      await GET(createGetRequest(), ctx("nc-1"))
      expect(vi.mocked(generateComprobanteFiscalPDF).mock.calls[0][0].asociado?.fecha).toBe("2026-10-19")
    })

    it("factura legada sin fecha ni CbteFch: se imprime igual, sin fecha", async () => {
      dbNc({ data: { ...ASOCIADA, fecha_emision: null, provider_response: { otra: "cosa" } }, error: null })
      const res = await GET(createGetRequest(), ctx("nc-1"))
      expect(res.status).toBe(200)
      expect(vi.mocked(generateComprobanteFiscalPDF).mock.calls[0][0].asociado?.fecha).toBeNull()
    })

    it("409 si la factura asociada no esta (no se imprime una NC sin saber a que factura anula)", async () => {
      dbNc({ data: null, error: null })
      const res = await GET(createGetRequest(), ctx("nc-1"))
      expect(res.status).toBe(409)
      expect((await res.json()).error).toMatch(/factura que anula/i)
      expect(generateComprobanteFiscalPDF).not.toHaveBeenCalled()
    })

    it("409 si la NC no trae comprobante_asociado_id, sin hacer la segunda consulta", async () => {
      const llamadas = dbNc(undefined, { ...NC, comprobante_asociado_id: null })
      const res = await GET(createGetRequest(), ctx("nc-1"))
      expect(res.status).toBe(409)
      expect(llamadas.filter((l) => l.table === "comprobantes_fiscales")).toHaveLength(1)
      expect(generateComprobanteFiscalPDF).not.toHaveBeenCalled()
    })

    it("500 si falla la consulta de la factura asociada (no se enmascara como 409)", async () => {
      dbNc({ data: null, error: { code: "XX000", message: "boom" } })
      expect((await GET(createGetRequest(), ctx("nc-1"))).status).toBe(500)
      expect(generateComprobanteFiscalPDF).not.toHaveBeenCalled()
    })

    it("una NC de otra organizacion es 404 y no consulta ninguna factura asociada", async () => {
      const llamadas = mockDb({ comprobante: () => ({ data: null, error: null }) })
      const res = await GET(createGetRequest(), ctx("nc-de-otra-org"))
      expect(res.status).toBe(404)
      expect(llamadas.filter((l) => l.table === "comprobantes_fiscales")).toHaveLength(1)
    })

    it("una NC emitida se imprime", async () => {
      dbNc(undefined, { ...NC, estado: "emitido" })
      expect((await GET(createGetRequest(), ctx("nc-1"))).status).toBe(200)
    })

    it.each(["pendiente", "rechazado"])("una NC %s da 409 y no consulta la factura asociada", async (estado) => {
      const llamadas = dbNc(undefined, { ...NC, estado })
      const res = await GET(createGetRequest(), ctx("nc-1"))
      expect(res.status).toBe(409)
      expect(llamadas.filter((l) => l.table === "comprobantes_fiscales")).toHaveLength(1)
      expect(generateComprobanteFiscalPDF).not.toHaveBeenCalled()
    })

    it("si el generador dice 'datos incompletos' (NC legada sin foto) responde 409", async () => {
      dbNc()
      vi.mocked(generateComprobanteFiscalPDF).mockRejectedValue(new ComprobanteIncompletoError())
      const res = await GET(createGetRequest(), ctx("nc-1"))
      expect(res.status).toBe(409)
    })
  })
})
