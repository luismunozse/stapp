// @vitest-environment node
/**
 * Tests: GET /api/facturacion-electronica/comprobantes/[id]/pdf
 *
 * ADMIN-only, org-scoped, emitido-only. Deliberately NOT gated by plan/toggle:
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

  it("filtra por id Y organization_id Y estado emitido (los numeros se repiten entre orgs)", async () => {
    const llamadas = mockDb({ comprobante: () => ({ data: FILA, error: null }) })
    await GET(createGetRequest(), ctx("comp-9"))
    const comp = llamadas.find((l) => l.table === "comprobantes_fiscales")!.chain
    expect(comp.eq).toHaveBeenCalledWith("id", "comp-9")
    expect(comp.eq).toHaveBeenCalledWith("organization_id", "org-1")
    expect(comp.eq).toHaveBeenCalledWith("estado", "emitido")
    const org = llamadas.find((l) => l.table === "organizations")!.chain
    expect(org.eq).toHaveBeenCalledWith("id", "org-1")
  })

  it("404 si el comprobante es de otra org o no esta emitido (no hay fila)", async () => {
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

  it("SELECT tier1 = columnas seguras + foto fiscal, sin provider_response", async () => {
    const llamadas = mockDb({ comprobante: () => ({ data: FILA, error: null }) })
    await GET(createGetRequest(), ctx())
    const [sel] = selects(llamadas)
    for (const col of ["cae", "cae_vencimiento", "fecha_emision", "cuit_emisor", "cbte_tipo", "moneda", "cotizacion", "importe_neto", "importe_iva", "importe_total", "receptor_doc_tipo_cod", "receptor_doc_nro_cod", "detalle"]) {
      expect(sel).toContain(col)
    }
    expect(sel).not.toContain("provider_response")
  })

  it("42703 en la foto fiscal -> tier0 (solo columnas seguras) -> 409 datos incompletos, sin PDF", async () => {
    const llamadas = mockDb({
      comprobante: (select) =>
        select.includes("cuit_emisor")
          ? { data: null, error: { code: "42703", message: 'column "cuit_emisor" does not exist' } }
          : { data: { ...FILA, cuit_emisor: undefined, detalle: undefined }, error: null },
    })
    const res = await GET(createGetRequest(), ctx())
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/datos incompletos/i)
    const sels = selects(llamadas)
    expect(sels).toHaveLength(2)
    expect(sels[0]).toContain("cuit_emisor")
    expect(sels[1]).not.toContain("cuit_emisor")
    expect(sels[1]).not.toContain("provider_response")
    expect(generateComprobanteFiscalPDF).not.toHaveBeenCalled()
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
})
