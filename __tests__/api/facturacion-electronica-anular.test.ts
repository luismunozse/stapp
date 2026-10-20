// @vitest-environment node
/**
 * Tests: POST /api/facturacion-electronica/comprobantes/[id]/anular
 *
 * Anular una factura ARCA = emitir UNA nota de crédito electrónica por el total
 * autorizado, asociada a la factura. Lo que estos tests protegen:
 *  - nunca se emite una SEGUNDA nota de crédito (un envío incierto queda
 *    `pendiente`, jamás `rechazado`);
 *  - los importes salen de la consulta a ARCA, no de la venta;
 *  - todo se filtra por la organización de la sesión;
 *  - sin la migración 371 la ruta responde 503 sin llamar a ARCA.
 *
 * Los tests miran los filtros y los payloads de las queries (no cuántas veces se
 * llamó a cada cosa). Fixtures inventados: ningún CUIT ni dato de cliente real.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { MENSAJE_ERROR_TECNICO } from "@/lib/facturacion/errores"
import { mockAuthSuccess, mockAuthError, createChainMock, parseResponse } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

const { auditUpdate } = vi.hoisted(() => ({ auditUpdate: vi.fn() }))

vi.mock("@/lib/audit", () => ({
  createAuditLogger: vi.fn(() => ({ update: auditUpdate })),
}))

vi.mock("@/lib/facturacion/access", () => ({
  canEmitirFacturaElectronica: vi.fn(),
}))

vi.mock("@/lib/facturacion/arca/credenciales-ruta", () => ({
  cargarCredencialesArca: vi.fn(),
}))

vi.mock("@/lib/facturacion/arca/arca-direct-provider", () => ({
  arcaDirectProvider: {
    consultar: vi.fn(),
    ultimoAutorizado: vi.fn(),
    emitirNotaCredito: vi.fn(),
  },
}))

import { createAuditLogger } from "@/lib/audit"
import { canEmitirFacturaElectronica } from "@/lib/facturacion/access"
import { cargarCredencialesArca } from "@/lib/facturacion/arca/credenciales-ruta"
import { arcaDirectProvider } from "@/lib/facturacion/arca/arca-direct-provider"
import { POST } from "@/app/api/facturacion-electronica/comprobantes/[id]/anular/route"

// ---------------------------------------------------------------- fixtures

const ORG = "org-1"
const FACTURA_ID = "fac-1"
const NC_ID = "nc-1"
const CUIT_EMISOR = "20111111112"
const CAE_FACTURA = "75123456789012"
const CAE_NC = "75999999999999"

const CREDS = {
  organizationId: ORG,
  cuit: CUIT_EMISOR,
  certPem: "CERT",
  keyPem: "KEY",
  puntoVenta: 3,
  condicionFiscal: "RESPONSABLE_INSCRIPTO" as const,
  production: false,
}

const DETALLE = [{ cantidad: 1, descripcion: "Servicio", importeUnitario: 1210, importe: 1210, alicuotaIva: 21 }]

/** Factura B por 1210 (neto 1000 + IVA 210) emitida el 15/10/2026, con foto fiscal completa. */
const FACTURA = {
  id: FACTURA_ID,
  venta_id: "venta-1",
  tipo: "B",
  punto_venta: 3,
  numero: "0003-00000001",
  cae: CAE_FACTURA,
  cae_vencimiento: "20261025",
  estado: "emitido",
  pdf_url: null,
  receptor_doc_tipo: "CONSUMIDOR FINAL",
  receptor_doc_nro: "0",
  receptor_condicion_iva: "CF",
  total: 1210,
  provider: "arca",
  error_msg: null,
  created_at: "2026-10-15T15:00:00.000Z",
  updated_at: "2026-10-15T15:00:00.000Z",
  fecha_emision: "2026-10-15",
  cuit_emisor: CUIT_EMISOR,
  cbte_tipo: 6,
  moneda: "PES",
  cotizacion: 1,
  importe_neto: 1000,
  importe_iva: 210,
  importe_total: 1210,
  receptor_doc_tipo_cod: 99,
  receptor_doc_nro_cod: "0",
  detalle: DETALLE,
  comprobante_asociado_id: null,
  cbte_nro_solicitado: null,
  motivo: null,
  motivo_detalle: null,
  anulado_at: null,
}

/** Fila anterior a la foto fiscal (migración 370): solo trae lo básico. */
const FACTURA_LEGADA = {
  ...FACTURA,
  fecha_emision: null,
  cuit_emisor: null,
  cbte_tipo: null,
  moneda: null,
  cotizacion: null,
  importe_neto: null,
  importe_iva: null,
  importe_total: null,
  receptor_doc_tipo_cod: null,
  receptor_doc_nro_cod: null,
  detalle: null,
}

/** Factura C por 500, sin discriminar IVA. */
const FACTURA_C = {
  ...FACTURA,
  tipo: "C",
  numero: "0003-00000002",
  total: 500,
  cbte_tipo: 11,
  importe_neto: 500,
  importe_iva: 0,
  importe_total: 500,
  detalle: [{ cantidad: 1, descripcion: "Servicio", importeUnitario: 500, importe: 500, alicuotaIva: 0 }],
}

/** Lo que ARCA tiene de la factura B (FECompConsultar). */
const CONSULTA_B = {
  existe: true,
  cbteNro: 1,
  cae: CAE_FACTURA,
  caeVencimiento: "20261025",
  resultado: "A",
  cbteFch: "20261015",
  concepto: 1,
  docTipo: 99,
  docNro: "0",
  impTotal: 1210,
  impNeto: 1000,
  impIva: 210,
  impTrib: 0,
  impOpEx: 0,
  impTotConc: 0,
  moneda: "PES",
  cotizacion: 1,
}

const CONSULTA_C = { ...CONSULTA_B, cbteNro: 2, impTotal: 500, impNeto: 500, impIva: 0 }

const NC_EMITIDA = {
  id: NC_ID,
  venta_id: "venta-1",
  tipo: "B",
  punto_venta: 3,
  numero: "0003-00000005",
  cae: CAE_NC,
  cae_vencimiento: "20261030",
  estado: "emitido",
  total: 1210,
  provider: "arca",
  error_msg: null,
  comprobante_asociado_id: FACTURA_ID,
  cbte_nro_solicitado: 5,
  motivo: "error_factura",
  motivo_detalle: null,
  anulado_at: null,
}

const AUTORIZADA = {
  kind: "autorizada" as const,
  numero: "0003-00000005",
  cae: CAE_NC,
  caeVencimiento: "20261030",
  raw: { FeCabResp: { Resultado: "A" } },
}

const HOY = new Date("2026-10-20T15:00:00Z")

// ---------------------------------------------------------------- helpers

const params = (id: string = FACTURA_ID) => ({ params: Promise.resolve({ id }) })

function pedir(body: unknown, id: string = FACTURA_ID) {
  return POST(
    new Request("http://localhost:3000/api/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params(id)
  )
}

const anular = (extra: Record<string, unknown> = {}, id: string = FACTURA_ID) =>
  pedir({ motivo: "error_factura", ...extra }, id).then(parseResponse)

type Cadena = ReturnType<typeof createChainMock>

/** Toda cadena que la ruta recibió de `supabaseAdmin.from`, incluidas las "de más". */
let entregadas: Cadena[] = []

/**
 * `comprobantes_fiscales` se consulta varias veces por request con intenciones
 * distintas (cargar la factura, buscar una NC activa, insertar, actualizar...):
 * una cadena por llamada, en el orden en que la ruta las hace. Una llamada de más
 * falla en voz alta en vez de reutilizar la última, y queda en `entregadas` para
 * que "nunca se borra / nunca se escribe X" valga también para ella.
 */
function montarTablas(comprobantes: Cadena[]) {
  entregadas = []
  let i = 0
  vi.mocked(supabaseAdmin.from).mockImplementation(((tabla: string) => {
    const cadena =
      tabla !== "comprobantes_fiscales"
        ? createChainMock(null, { message: `tabla inesperada: ${tabla}` })
        : (comprobantes[i++] ?? createChainMock(null, { message: "consulta de más a comprobantes_fiscales" }))
    entregadas.push(cadena)
    return cadena
  }) as never)
}

/** Argumentos de todas las llamadas a `metodo` en TODAS las cadenas entregadas. */
const escrituras = (metodo: "update" | "delete" | "insert") =>
  entregadas.flatMap((c) => vi.mocked(c[metodo]).mock.calls.map((llamada) => llamada[0] as Record<string, unknown> | undefined))

interface Escenario {
  factura?: unknown
  facturaError?: unknown
  ncActiva?: unknown
  insertError?: unknown
  insertData?: unknown
  despues?: Cadena[]
}

/** Arma las cadenas de la ruta feliz; `despues` son las que siguen al INSERT. */
function montar(e: Escenario = {}) {
  const carga = createChainMock(e.factura === undefined ? FACTURA : e.factura, e.facturaError ?? null)
  const activa = createChainMock(e.ncActiva ?? null)
  const insercion = createChainMock(
    e.insertData === undefined ? (e.insertError ? null : { id: NC_ID }) : e.insertData,
    e.insertError ?? null
  )
  const despues = e.despues ?? [createChainMock(NC_EMITIDA)]
  montarTablas([carga, activa, insercion, ...despues])
  return { carga, activa, insercion, despues }
}

const payloads = (cadena: Cadena, metodo: "insert" | "update") =>
  vi.mocked(cadena[metodo]).mock.calls.map((c) => c[0] as Record<string, unknown>)

const escritoSobreOrg = (cadena: Cadena) => expect(cadena.eq).toHaveBeenCalledWith("organization_id", ORG)

function sinLlamadasAArca() {
  expect(arcaDirectProvider.consultar).not.toHaveBeenCalled()
  expect(arcaDirectProvider.ultimoAutorizado).not.toHaveBeenCalled()
  expect(arcaDirectProvider.emitirNotaCredito).not.toHaveBeenCalled()
}

// ---------------------------------------------------------------- tests

describe("POST /api/facturacion-electronica/comprobantes/[id]/anular", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(HOY)

    mockAuthSuccess({ role: "ADMIN", organizationId: ORG, userId: "user-1" })
    vi.mocked(canEmitirFacturaElectronica).mockResolvedValue(true)
    vi.mocked(cargarCredencialesArca).mockResolvedValue({ ok: true, provider: "arca", creds: CREDS })
    vi.mocked(arcaDirectProvider.consultar).mockResolvedValue(CONSULTA_B)
    vi.mocked(arcaDirectProvider.ultimoAutorizado).mockResolvedValue(4)
    vi.mocked(arcaDirectProvider.emitirNotaCredito).mockResolvedValue(AUTORIZADA)
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { id: NC_ID, asociadoId: FACTURA_ID, replayed: false }, error: null } as never)
    auditUpdate.mockResolvedValue(undefined)
    montar()
  })

  afterEach(() => vi.useRealTimers())

  // ------------------------------------------------------ acceso

  describe("acceso", () => {
    it("401 sin sesión: no toca la base ni ARCA", async () => {
      mockAuthError()

      const { status } = await anular()

      expect(status).toBe(401)
      expect(supabaseAdmin.from).not.toHaveBeenCalled()
      sinLlamadasAArca()
    })

    it("403 para quien no es Admin", async () => {
      mockAuthSuccess({ role: "VENDEDOR", organizationId: ORG })

      const { status } = await anular()

      expect(status).toBe(403)
      expect(supabaseAdmin.from).not.toHaveBeenCalled()
      sinLlamadasAArca()
    })

    it("403 cuando la facturación electrónica no está habilitada (se revalida en el servidor)", async () => {
      vi.mocked(canEmitirFacturaElectronica).mockResolvedValue(false)

      const { status, body } = await anular()

      expect(status).toBe(403)
      expect(body.error).toBeDefined()
      expect(canEmitirFacturaElectronica).toHaveBeenCalledWith(ORG)
      expect(supabaseAdmin.from).not.toHaveBeenCalled()
      sinLlamadasAArca()
    })

    it.each(["../etc/passwd", "a b", "x".repeat(65), ""])("404 sin tocar la base para un id imposible (%j)", async (id) => {
      const { status } = await anular({}, id)

      expect(status).toBe(404)
      expect(supabaseAdmin.from).not.toHaveBeenCalled()
      sinLlamadasAArca()
    })
  })

  // ------------------------------------------------------ motivo

  describe("motivo", () => {
    it.each([
      ["sin motivo", {}],
      ["motivo desconocido", { motivo: "porque si" }],
      ["motivo con la etiqueta en vez del código", { motivo: "Error en la factura" }],
      ["motivo que no es texto", { motivo: 3 }],
      ["'otro' sin detalle", { motivo: "otro" }],
      ["'otro' con detalle en blanco", { motivo: "otro", motivoDetalle: "   " }],
      ["detalle de más de 500 caracteres", { motivo: "otro", motivoDetalle: "x".repeat(501) }],
      ["detalle que no es texto", { motivo: "error_factura", motivoDetalle: 42 }],
    ])("400 sin tocar la base ni ARCA: %s", async (_titulo, body) => {
      const r = await pedir(body).then(parseResponse)

      expect(r.status).toBe(400)
      expect(r.body.error).toBeDefined()
      expect(supabaseAdmin.from).not.toHaveBeenCalled()
      sinLlamadasAArca()
    })

    it("400 cuando el cuerpo no es JSON", async () => {
      const respuesta = await POST(
        new Request("http://localhost:3000/api/test", { method: "POST", body: "no es json" }),
        params()
      )

      expect(respuesta.status).toBe(400)
      expect(supabaseAdmin.from).not.toHaveBeenCalled()
    })

    it("'error_factura' y 'devolucion_total' no necesitan detalle", async () => {
      for (const motivo of ["error_factura", "devolucion_total"]) {
        montar()
        const { status } = await anular({ motivo })
        expect(status).toBe(200)
      }
    })

    it("'otro' con detalle sigue adelante y lo guarda recortado en la NC", async () => {
      const { insercion } = montar()

      const { status } = await anular({ motivo: "otro", motivoDetalle: "  Se facturó a otro cliente  " })

      expect(status).toBe(200)
      expect(payloads(insercion, "insert")[0]).toMatchObject({
        motivo: "otro",
        motivo_detalle: "Se facturó a otro cliente",
      })
    })

    it("un detalle en blanco de un motivo que no es 'otro' se guarda como NULL", async () => {
      const { insercion } = montar()

      await anular({ motivo: "devolucion_total", motivoDetalle: "   " })

      expect(payloads(insercion, "insert")[0]).toMatchObject({ motivo: "devolucion_total", motivo_detalle: null })
    })
  })

  // ------------------------------------------------------ carga y elegibilidad

  describe("la factura", () => {
    it("se busca por id Y por la organización de la sesión, con todas las columnas de la anulación", async () => {
      const { carga } = montar()

      await anular()

      expect(supabaseAdmin.from).toHaveBeenNthCalledWith(1, "comprobantes_fiscales")
      expect(carga.eq).toHaveBeenCalledWith("id", FACTURA_ID)
      escritoSobreOrg(carga)
      const [columnas] = vi.mocked(carga.select).mock.calls[0] as [string]
      for (const columna of ["id", "estado", "cae", "cbte_tipo", "detalle", "comprobante_asociado_id", "cbte_nro_solicitado"]) {
        expect(columnas).toContain(columna)
      }
      expect(columnas).not.toContain("provider_response")
    })

    it("404 cuando el comprobante es de otra organización (o no existe): ARCA no se llama y nada se escribe", async () => {
      const { carga, insercion } = montar({ factura: null })

      const { status } = await anular()

      expect(status).toBe(404)
      escritoSobreOrg(carga)
      expect(insercion.insert).not.toHaveBeenCalled()
      sinLlamadasAArca()
    })

    it("503 sin consultar a ARCA cuando falta la migración (42703 al leer las columnas nuevas)", async () => {
      montar({ factura: null, facturaError: { code: "42703", message: "column comprobantes_fiscales.anulado_at does not exist" } })

      const { status, body } = await anular()

      expect(status).toBe(503)
      expect(body.error).toMatch(/todavía no está disponible/i)
      expect(cargarCredencialesArca).not.toHaveBeenCalled()
      sinLlamadasAArca()
    })

    it("500 ante cualquier otro error de base de datos al cargar", async () => {
      montar({ factura: null, facturaError: { code: "57014", message: "statement timeout" } })

      const { status } = await anular()

      expect(status).toBe(500)
      sinLlamadasAArca()
    })

    it("422 si el comprobante es una nota de crédito (cbte_tipo 8)", async () => {
      montar({ factura: { ...FACTURA, cbte_tipo: 8, comprobante_asociado_id: "otra" } })

      const { status } = await anular()

      expect(status).toBe(422)
      sinLlamadasAArca()
    })

    it("422 si el cbte_tipo es de nota de crédito (8 / 13) aunque la fila no diga a qué factura apunta", async () => {
      for (const cbteTipo of [8, 13]) {
        montar({ factura: { ...FACTURA, cbte_tipo: cbteTipo, comprobante_asociado_id: null } })
        expect((await anular()).status).toBe(422)
      }
      sinLlamadasAArca()
    })

    it("422 si apunta a otra factura aunque cbte_tipo no esté (comprobante_asociado_id)", async () => {
      montar({ factura: { ...FACTURA, cbte_tipo: null, comprobante_asociado_id: "otra" } })

      expect((await anular()).status).toBe(422)
      sinLlamadasAArca()
    })

    it("422 si la letra de la factura no es B ni C", async () => {
      montar({ factura: { ...FACTURA, tipo: "A" } })

      expect((await anular()).status).toBe(422)
      sinLlamadasAArca()
    })

    it("422 si la factura salió por TusFacturas: ARCA no se llama", async () => {
      montar({ factura: { ...FACTURA, provider: "tusfacturas" } })

      const { status } = await anular()

      expect(status).toBe(422)
      expect(cargarCredencialesArca).not.toHaveBeenCalled()
      sinLlamadasAArca()
    })

    it.each(["pendiente", "rechazado"])("409 si la factura está '%s' (solo se anulan las emitidas)", async (estado) => {
      montar({ factura: { ...FACTURA, estado } })

      const { status } = await anular()

      expect(status).toBe(409)
      sinLlamadasAArca()
    })

    it("409 si la factura ya está anulada", async () => {
      montar({ factura: { ...FACTURA, estado: "anulado", anulado_at: "2026-10-18T12:00:00.000Z" } })

      const { status, body } = await anular()

      expect(status).toBe(409)
      expect(body.error).toMatch(/ya está anulada/i)
      sinLlamadasAArca()
    })

    it.each([
      ["sin número", { numero: null }],
      ["sin CAE", { cae: null }],
    ])("409 si la factura emitida está %s: no hay con qué consultarla", async (_titulo, cambio) => {
      montar({ factura: { ...FACTURA, ...cambio } })

      expect((await anular()).status).toBe(409)
      sinLlamadasAArca()
    })

    it("422 si el número de la factura no tiene el formato PPPP-NNNNNNNN", async () => {
      montar({ factura: { ...FACTURA, numero: "sin-formato" } })

      expect((await anular()).status).toBe(422)
      sinLlamadasAArca()
    })

    it("409 con la NC existente en el cuerpo cuando la factura ya tiene una activa; ARCA no se llama", async () => {
      const existente = { ...NC_EMITIDA, estado: "pendiente", numero: null, cae: null }
      const { activa, insercion } = montar({ ncActiva: existente })

      const { status, body } = await anular()

      expect(status).toBe(409)
      expect(body.notaCredito).toEqual(existente)
      expect(body).not.toHaveProperty("comprobante")
      expect(activa.eq).toHaveBeenCalledWith("comprobante_asociado_id", FACTURA_ID)
      expect(activa.in).toHaveBeenCalledWith("estado", ["pendiente", "emitido"])
      escritoSobreOrg(activa)
      expect(insercion.insert).not.toHaveBeenCalled()
      sinLlamadasAArca()
    })

    it("500 si la búsqueda de una NC activa falla", async () => {
      const carga = createChainMock(FACTURA)
      const activa = createChainMock(null, { message: "boom" })
      montarTablas([carga, activa])

      const { status } = await anular()

      expect(status).toBe(500)
      sinLlamadasAArca()
    })
  })

  // ------------------------------------------------------ credenciales y emisor

  describe("credenciales", () => {
    it("pide las credenciales de la organización de la sesión y devuelve su fallo tal cual", async () => {
      vi.mocked(cargarCredencialesArca).mockResolvedValue({ ok: false, status: 409, error: "No factura con ARCA" })

      const { status, body } = await anular()

      expect(cargarCredencialesArca).toHaveBeenCalledWith(ORG)
      expect(status).toBe(409)
      expect(body.error).toBe("No factura con ARCA")
      sinLlamadasAArca()
    })

    it("409 si el CUIT emisor de la factura no es el de las credenciales actuales; ARCA no se llama", async () => {
      montar({ factura: { ...FACTURA, cuit_emisor: "20999999995" } })

      const { status, body } = await anular()

      expect(status).toBe(409)
      expect(body.error).toMatch(/CUIT/)
      sinLlamadasAArca()
    })

    it("con delegación el emisor es el representado, no el titular del certificado de la plataforma", async () => {
      vi.mocked(cargarCredencialesArca).mockResolvedValue({
        ok: true,
        provider: "arca_delegado",
        creds: { ...CREDS, cuit: "23222222223", cuitRepresentado: CUIT_EMISOR },
      })
      const { insercion } = montar({ factura: { ...FACTURA, provider: "arca_delegado" } })

      const { status } = await anular()

      expect(status).toBe(200)
      expect(payloads(insercion, "insert")[0]).toMatchObject({ cuit_emisor: CUIT_EMISOR, provider: "arca_delegado" })
    })

    it("una factura legada sin cuit_emisor toma el de las credenciales", async () => {
      const { insercion } = montar({ factura: FACTURA_LEGADA })

      await anular()

      expect(payloads(insercion, "insert")[0]).toMatchObject({ cuit_emisor: CUIT_EMISOR })
    })
  })

  // ------------------------------------------------------ consulta a ARCA

  describe("consulta de la factura original en ARCA", () => {
    it("consulta el punto de venta y número de la FACTURA (no los de las credenciales) con su tipo", async () => {
      montar({ factura: { ...FACTURA, numero: "0007-00000012" } })
      vi.mocked(cargarCredencialesArca).mockResolvedValue({ ok: true, provider: "arca", creds: { ...CREDS, puntoVenta: 3 } })

      await anular()

      expect(arcaDirectProvider.consultar).toHaveBeenCalledWith(CREDS, { puntoVenta: 7, cbteTipoAfip: 6, cbteNro: 12 })
    })

    it("una factura legada (sin cbte_tipo) se consulta con el tipo de su letra: B = 6", async () => {
      montar({ factura: FACTURA_LEGADA })

      await anular()

      expect(arcaDirectProvider.consultar).toHaveBeenCalledWith(CREDS, { puntoVenta: 3, cbteTipoAfip: 6, cbteNro: 1 })
    })

    it("una factura C legada se consulta como tipo 11", async () => {
      montar({ factura: { ...FACTURA_C, cbte_tipo: null } })
      vi.mocked(arcaDirectProvider.consultar).mockResolvedValue(CONSULTA_C)

      await anular()

      expect(arcaDirectProvider.consultar).toHaveBeenCalledWith(CREDS, { puntoVenta: 3, cbteTipoAfip: 11, cbteNro: 2 })
    })

    it("502 genérico si la consulta falla: no se escribe nada ni se envía nada", async () => {
      const { insercion } = montar()
      vi.mocked(arcaDirectProvider.consultar).mockRejectedValue(new Error(MENSAJE_ERROR_TECNICO))

      const { status, body } = await anular()

      expect(status).toBe(502)
      expect(body.error).toBe(MENSAJE_ERROR_TECNICO)
      expect(insercion.insert).not.toHaveBeenCalled()
      expect(arcaDirectProvider.emitirNotaCredito).not.toHaveBeenCalled()
    })

    it("422 si ARCA no tiene la factura y el último autorizado lo CONFIRMA (último < número)", async () => {
      const { insercion } = montar()
      vi.mocked(arcaDirectProvider.consultar).mockResolvedValue({ existe: false })
      vi.mocked(arcaDirectProvider.ultimoAutorizado).mockResolvedValue(0)

      const { status } = await anular()

      expect(status).toBe(422)
      expect(arcaDirectProvider.ultimoAutorizado).toHaveBeenCalledWith(CREDS, 3, 6)
      expect(insercion.insert).not.toHaveBeenCalled()
      expect(arcaDirectProvider.emitirNotaCredito).not.toHaveBeenCalled()
    })

    it("un 'no existe' que NO se puede confirmar no se toma por cierto: 502 si el último autorizado falla", async () => {
      const { insercion } = montar()
      vi.mocked(arcaDirectProvider.consultar).mockResolvedValue({ existe: false })
      vi.mocked(arcaDirectProvider.ultimoAutorizado).mockRejectedValue(new Error(MENSAJE_ERROR_TECNICO))

      const { status } = await anular()

      expect(status).toBe(502)
      expect(insercion.insert).not.toHaveBeenCalled()
    })

    it("ni se toma por cierto si ARCA dice que ya autorizó ese número (la consulta quedó muda): 502", async () => {
      const { insercion } = montar()
      vi.mocked(arcaDirectProvider.consultar).mockResolvedValue({ existe: false })
      vi.mocked(arcaDirectProvider.ultimoAutorizado).mockResolvedValue(1)

      const { status } = await anular()

      expect(status).toBe(502)
      expect(insercion.insert).not.toHaveBeenCalled()
      expect(arcaDirectProvider.emitirNotaCredito).not.toHaveBeenCalled()
    })

    it("el CAE se compara sin espacios sobrantes (la columna es texto libre)", async () => {
      montar({ factura: { ...FACTURA, cae: ` ${CAE_FACTURA} ` } })

      expect((await anular()).status).toBe(200)
    })

    it("422 si el CAE de ARCA no es el guardado: no se emite nada", async () => {
      const { insercion } = montar()
      vi.mocked(arcaDirectProvider.consultar).mockResolvedValue({ ...CONSULTA_B, cae: "75000000000000" })

      const { status, body } = await anular()

      expect(status).toBe(422)
      expect(body.error).toMatch(/CAE/)
      expect(insercion.insert).not.toHaveBeenCalled()
      expect(arcaDirectProvider.emitirNotaCredito).not.toHaveBeenCalled()
    })

    it("422 con el motivo de negocio cuando el IVA no encaja en ninguna alícuota; nada se escribe", async () => {
      const { insercion } = montar()
      vi.mocked(arcaDirectProvider.consultar).mockResolvedValue({ ...CONSULTA_B, impIva: 100, impNeto: 1110 })

      const { status, body } = await anular()

      expect(status).toBe(422)
      expect(body.error).toMatch(/alícuota/i)
      expect(insercion.insert).not.toHaveBeenCalled()
      expect(arcaDirectProvider.emitirNotaCredito).not.toHaveBeenCalled()
    })

    it("los importes salen de ARCA, no de la factura guardada ni de la venta", async () => {
      const { insercion } = montar({ factura: { ...FACTURA, total: 1000, importe_total: 1000 } })

      await anular()

      expect(payloads(insercion, "insert")[0]).toMatchObject({ total: 1210, importe_total: 1210, importe_neto: 1000, importe_iva: 210 })
    })
  })

  // ------------------------------------------------------ numeración y reserva

  describe("numeración explícita y reserva de la NC", () => {
    it("pide el último autorizado de la NC B (8) en el punto de venta de las credenciales", async () => {
      await anular()

      expect(arcaDirectProvider.ultimoAutorizado).toHaveBeenCalledWith(CREDS, 3, 8)
    })

    it("para una factura C pide el de la NC C (13)", async () => {
      montar({ factura: FACTURA_C })
      vi.mocked(arcaDirectProvider.consultar).mockResolvedValue(CONSULTA_C)
      vi.mocked(cargarCredencialesArca).mockResolvedValue({
        ok: true,
        provider: "arca",
        creds: { ...CREDS, condicionFiscal: "MONOTRIBUTO" },
      })

      await anular()

      expect(arcaDirectProvider.ultimoAutorizado).toHaveBeenLastCalledWith(expect.anything(), 3, 13)
    })

    it("502 y nada escrito si no se puede saber el último autorizado de la NC", async () => {
      const { insercion } = montar()
      vi.mocked(arcaDirectProvider.ultimoAutorizado).mockRejectedValue(new Error(MENSAJE_ERROR_TECNICO))

      const { status } = await anular()

      expect(status).toBe(502)
      expect(insercion.insert).not.toHaveBeenCalled()
      expect(arcaDirectProvider.emitirNotaCredito).not.toHaveBeenCalled()
    })

    it("INSERT de la NC pendiente: es el candado, con el número pedido (último + 1) y la foto de lo que se va a enviar", async () => {
      const { insercion } = montar()

      await anular({ motivo: "error_factura" })

      const [fila] = payloads(insercion, "insert")
      expect(fila).toEqual({
        organization_id: ORG,
        venta_id: "venta-1",
        tipo: "B",
        punto_venta: 3,
        provider: "arca",
        estado: "pendiente",
        total: 1210,
        receptor_doc_tipo: "CONSUMIDOR FINAL",
        receptor_doc_nro: "0",
        receptor_condicion_iva: "CF",
        // foto fiscal de la NC
        fecha_emision: "2026-10-20",
        cuit_emisor: CUIT_EMISOR,
        cbte_tipo: 8,
        concepto: 1,
        moneda: "PES",
        cotizacion: 1,
        importe_neto: 1000,
        importe_iva: 210,
        importe_total: 1210,
        receptor_doc_tipo_cod: 99,
        receptor_doc_nro_cod: "0",
        detalle: DETALLE,
        // anulación
        comprobante_asociado_id: FACTURA_ID,
        cbte_nro_solicitado: 5,
        motivo: "error_factura",
        motivo_detalle: null,
      })
      expect(insercion.select).toHaveBeenCalledWith("id")
    })

    it("la fila de la NC no trae número, CAE ni respuesta del proveedor antes de enviar", async () => {
      const { insercion } = montar()

      await anular()

      const [fila] = payloads(insercion, "insert")
      for (const clave of ["numero", "cae", "cae_vencimiento", "provider_response", "anulado_at", "error_msg", "id"]) {
        expect(fila).not.toHaveProperty(clave)
      }
    })

    it("una factura C reserva una NC C (13) por el total, sin IVA", async () => {
      const { insercion } = montar({ factura: FACTURA_C })
      vi.mocked(arcaDirectProvider.consultar).mockResolvedValue(CONSULTA_C)
      vi.mocked(cargarCredencialesArca).mockResolvedValue({
        ok: true,
        provider: "arca",
        creds: { ...CREDS, condicionFiscal: "MONOTRIBUTO" },
      })

      await anular()

      expect(payloads(insercion, "insert")[0]).toMatchObject({
        tipo: "C",
        cbte_tipo: 13,
        total: 500,
        importe_neto: 500,
        importe_iva: 0,
      })
    })

    it("la letra de la NC sigue a la de la factura original aunque las credenciales hoy sean de otra condición", async () => {
      const { insercion } = montar()
      vi.mocked(cargarCredencialesArca).mockResolvedValue({
        ok: true,
        provider: "arca",
        creds: { ...CREDS, condicionFiscal: "MONOTRIBUTO" },
      })

      await anular()

      expect(payloads(insercion, "insert")[0]).toMatchObject({ tipo: "B", cbte_tipo: 8 })
    })

    it("una factura legada (sin foto fiscal) se anula con los datos de ARCA y una línea sintética por el total", async () => {
      const { insercion } = montar({ factura: FACTURA_LEGADA })

      const { status } = await anular()

      expect(status).toBe(200)
      expect(payloads(insercion, "insert")[0]).toMatchObject({
        importe_total: 1210,
        receptor_doc_tipo_cod: 99,
        detalle: [
          {
            cantidad: 1,
            descripcion: "Anulación de la factura B 0003-00000001",
            importe: 1210,
          },
        ],
      })
    })

    it("el INSERT se hace ANTES de enviar a ARCA", async () => {
      const { insercion } = montar()

      await anular()

      const antes = vi.mocked(insercion.insert).mock.invocationCallOrder[0]
      const envio = vi.mocked(arcaDirectProvider.emitirNotaCredito).mock.invocationCallOrder[0]
      expect(antes).toBeLessThan(envio)
    })

    it("la factura original NO recibe el motivo ni se actualiza antes de que ARCA autorice", async () => {
      const { carga, activa } = montar({ despues: [createChainMock(null, null)] })
      vi.mocked(arcaDirectProvider.emitirNotaCredito).mockResolvedValue({ kind: "incierta", error: "x" })

      await anular({ motivo: "otro", motivoDetalle: "detalle" })

      expect(carga.update).not.toHaveBeenCalled()
      expect(activa.update).not.toHaveBeenCalled()
    })

    it("envía a ARCA UNA nota de crédito con el número reservado como CbteDesde y CbteHasta", async () => {
      await anular()

      expect(arcaDirectProvider.emitirNotaCredito).toHaveBeenCalledTimes(1)
      const [creds, voucher] = vi.mocked(arcaDirectProvider.emitirNotaCredito).mock.calls[0]
      expect(creds).toEqual(CREDS)
      expect(voucher).toMatchObject({
        PtoVta: 3,
        CbteTipo: 8,
        CbteDesde: 5,
        CbteHasta: 5,
        Concepto: 1,
        DocTipo: 99,
        DocNro: 0,
        CbteFch: "20261020",
        ImpTotal: 1210,
        ImpNeto: 1000,
        ImpIVA: 210,
        MonId: "PES",
        MonCotiz: 1,
        CbtesAsoc: [{ Tipo: 6, PtoVta: 3, Nro: 1, Cuit: CUIT_EMISOR, CbteFch: "20261015" }],
        Iva: [{ Id: 5, BaseImp: 1000, Importe: 210 }],
      })
    })

    it("con las credenciales en otro punto de venta, la NC sale por ese y apunta al punto de venta de la factura", async () => {
      vi.mocked(cargarCredencialesArca).mockResolvedValue({ ok: true, provider: "arca", creds: { ...CREDS, puntoVenta: 9 } })
      const { insercion } = montar({ factura: { ...FACTURA, numero: "0004-00000001" } })

      await anular()

      expect(payloads(insercion, "insert")[0]).toMatchObject({ punto_venta: 9 })
      // La numeración de la NC es la de SU punto de venta (el de las credenciales), no el de la factura.
      expect(arcaDirectProvider.ultimoAutorizado).toHaveBeenLastCalledWith(expect.anything(), 9, 8)
      const [, voucher] = vi.mocked(arcaDirectProvider.emitirNotaCredito).mock.calls[0]
      expect(voucher).toMatchObject({ PtoVta: 9, CbtesAsoc: [expect.objectContaining({ PtoVta: 4, Nro: 1 })] })
    })
  })

  // ------------------------------------------------------ carreras e INSERT fallido

  describe("cuando el INSERT falla", () => {
    const unica = (indice: string) => ({
      code: "23505",
      message: `duplicate key value violates unique constraint "${indice}"`,
    })

    it("uq_comprobante_nc_activa: 409 con la NC que ganó la carrera; no se envía nada a ARCA", async () => {
      const ganadora = { ...NC_EMITIDA, estado: "pendiente", numero: null, cae: null }
      const reintento = createChainMock(ganadora)
      montar({ insertError: unica("uq_comprobante_nc_activa"), despues: [reintento] })

      const { status, body } = await anular()

      expect(status).toBe(409)
      expect(body.conflicto).toBe("nc_activa")
      expect(body.notaCredito).toEqual(ganadora)
      expect(reintento.eq).toHaveBeenCalledWith("comprobante_asociado_id", FACTURA_ID)
      escritoSobreOrg(reintento)
      expect(arcaDirectProvider.emitirNotaCredito).not.toHaveBeenCalled()
    })

    it("uq_comprobante_nc_activa sin poder leer a la ganadora: 409 igual, sin NC en el cuerpo", async () => {
      montar({ insertError: unica("uq_comprobante_nc_activa"), despues: [createChainMock(null, { message: "boom" })] })

      const { status, body } = await anular()

      expect(status).toBe(409)
      expect(body.conflicto).toBe("nc_activa")
      expect(body).not.toHaveProperty("notaCredito")
    })

    it("uq_comprobante_nc_en_vuelo: 409 que manda a verificar la NC pendiente; no revela de quién es", async () => {
      montar({ insertError: unica("uq_comprobante_nc_en_vuelo") })

      const { status, body } = await anular()

      expect(status).toBe(409)
      expect(body.conflicto).toBe("nc_en_vuelo")
      expect(body.error).toMatch(/pendiente de verificación/i)
      expect(body).not.toHaveProperty("notaCredito")
      expect(arcaDirectProvider.emitirNotaCredito).not.toHaveBeenCalled()
    })

    it("uq_comprobante_nc_numero: 409, el número ya lo usó otra NC", async () => {
      montar({ insertError: unica("uq_comprobante_nc_numero") })

      const { status, body } = await anular()

      expect(status).toBe(409)
      expect(body.conflicto).toBe("nc_numero")
      expect(arcaDirectProvider.emitirNotaCredito).not.toHaveBeenCalled()
    })

    it("una violación única desconocida también es 409", async () => {
      montar({ insertError: unica("otro_indice") })

      const { status, body } = await anular()

      expect(status).toBe(409)
      expect(body.conflicto).toBe("otro")
      expect(arcaDirectProvider.emitirNotaCredito).not.toHaveBeenCalled()
    })

    it("PGRST204 (columna de la migración que no existe): 503 sin enviar nada", async () => {
      montar({ insertError: { code: "PGRST204", message: "Could not find the 'cbte_nro_solicitado' column" } })

      const { status, body } = await anular()

      expect(status).toBe(503)
      expect(body.error).toMatch(/todavía no está disponible/i)
      expect(arcaDirectProvider.emitirNotaCredito).not.toHaveBeenCalled()
    })

    it("cualquier otro error de base de datos: 500 sin enviar nada", async () => {
      montar({ insertError: { code: "57014", message: "statement timeout" } })

      const { status } = await anular()

      expect(status).toBe(500)
      expect(arcaDirectProvider.emitirNotaCredito).not.toHaveBeenCalled()
    })

    it("un INSERT que no devuelve la fila: 500 sin enviar nada", async () => {
      montar({ insertData: null })

      const { status } = await anular()

      expect(status).toBe(500)
      expect(arcaDirectProvider.emitirNotaCredito).not.toHaveBeenCalled()
    })
  })

  // ------------------------------------------------------ ARCA autoriza

  describe("ARCA autoriza la nota de crédito", () => {
    it("confirma con el RPC atómico (NC emitida + factura anulada) y devuelve la NC", async () => {
      const { despues } = montar()

      const { status, body } = await anular()

      expect(status).toBe(200)
      expect(supabaseAdmin.rpc).toHaveBeenCalledWith("confirmar_nota_credito_fiscal", {
        p_org_id: ORG,
        p_nc_id: NC_ID,
        p_numero: "0003-00000005",
        p_cae: CAE_NC,
        p_cae_vencimiento: "20261030",
        p_provider_response: AUTORIZADA.raw,
      })
      expect(body.comprobante).toEqual(NC_EMITIDA)
      expect(body.anulado).toEqual({ id: FACTURA_ID })
      // La NC se relee por id y organización, sin la respuesta cruda del proveedor.
      escritoSobreOrg(despues[0])
      expect(despues[0].eq).toHaveBeenCalledWith("id", NC_ID)
      const [columnas] = vi.mocked(despues[0].select).mock.calls[0] as [string]
      expect(columnas).not.toContain("provider_response")
    })

    it("desde TypeScript NO escribe estados: la transición es solo del RPC", async () => {
      montar()

      await anular()

      expect(escrituras("update")).toHaveLength(0)
      expect(escrituras("delete")).toHaveLength(0)
    })

    it("si el RPC confirma pero no se puede releer la NC, igual responde 200 con lo que ARCA autorizó", async () => {
      montar({ despues: [createChainMock(null, { message: "relectura caída" })] })

      const { status, body } = await anular()

      expect(status).toBe(200)
      expect(body.comprobante).toMatchObject({ id: NC_ID, estado: "emitido", numero: "0003-00000005", cae: CAE_NC })
    })

    it("si el RPC falla con el CAE ya emitido: 500 con CAE y número, la fila queda pendiente y NUNCA se borra", async () => {
      const consola = vi.spyOn(console, "error").mockImplementation(() => {})
      montar()
      vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: null, error: { code: "P0001", message: "La factura asociada no está emitida" } } as never)

      const { status, body } = await anular()

      expect(status).toBe(500)
      expect(body).toMatchObject({ cae: CAE_NC, numero: "0003-00000005", comprobanteId: NC_ID })
      expect(escrituras("delete")).toHaveLength(0)
      expect(escrituras("update")).toHaveLength(0)
      expect(consola).toHaveBeenCalledWith(
        expect.stringContaining("autorizada"),
        expect.objectContaining({ ncId: NC_ID, cae: CAE_NC, numero: "0003-00000005" })
      )
      consola.mockRestore()
    })

    it("queda un registro de auditoría de la anulación (quién, qué factura, qué NC)", async () => {
      await anular({ motivo: "devolucion_total" })

      expect(createAuditLogger).toHaveBeenCalledWith(ORG, "user-1", expect.any(Request))
      expect(auditUpdate).toHaveBeenCalledWith(
        "comprobantes_fiscales",
        FACTURA_ID,
        { estado: "emitido" },
        expect.objectContaining({ estado: "anulado", notaCredito: "0003-00000005", motivo: "devolucion_total" })
      )
    })

    it("una auditoría caída no tumba una anulación que ya salió bien", async () => {
      const consola = vi.spyOn(console, "error").mockImplementation(() => {})
      auditUpdate.mockRejectedValue(new Error("audit_logs caída"))

      const { status } = await anular()

      expect(status).toBe(200)
      consola.mockRestore()
    })

    it("no toca stock, caja, cuenta corriente ni la venta: solo comprobantes_fiscales y el RPC de confirmación", async () => {
      await anular()

      const tablas = new Set(vi.mocked(supabaseAdmin.from).mock.calls.map((c) => c[0]))
      expect([...tablas]).toEqual(["comprobantes_fiscales"])
      const funciones = vi.mocked(supabaseAdmin.rpc).mock.calls.map((c) => c[0])
      expect(funciones).toEqual(["confirmar_nota_credito_fiscal"])
    })
  })

  // ------------------------------------------------------ ARCA rechaza

  describe("ARCA rechaza la nota de crédito", () => {
    const rechazada = {
      kind: "rechazada" as const,
      errores: ["10016: El numero de comprobante no es el proximo", "10197: Falta el comprobante asociado"],
      raw: { FeCabResp: { Resultado: "R" } },
    }

    it("422 con el mensaje de ARCA y la NC pasa a rechazado con un UPDATE condicional (solo si sigue pendiente)", async () => {
      const rechazo = createChainMock({ ...NC_EMITIDA, estado: "rechazado", numero: null, cae: null })
      montar({ despues: [rechazo] })
      vi.mocked(arcaDirectProvider.emitirNotaCredito).mockResolvedValue(rechazada)

      const { status, body } = await anular()

      expect(status).toBe(422)
      expect(body.error).toBe("10016: El numero de comprobante no es el proximo; 10197: Falta el comprobante asociado")
      expect(body.comprobante.estado).toBe("rechazado")
      const [cambio] = payloads(rechazo, "update")
      expect(cambio).toMatchObject({
        estado: "rechazado",
        error_msg: "10016: El numero de comprobante no es el proximo; 10197: Falta el comprobante asociado",
        provider_response: rechazada.raw,
      })
      expect(cambio).toHaveProperty("updated_at")
      expect(rechazo.eq).toHaveBeenCalledWith("id", NC_ID)
      expect(rechazo.eq).toHaveBeenCalledWith("estado", "pendiente")
      escritoSobreOrg(rechazo)
    })

    it("la factura original sigue emitida: el RPC no se llama, no se audita y nada se borra", async () => {
      const rechazo = createChainMock({ ...NC_EMITIDA, estado: "rechazado" })
      const { carga } = montar({ despues: [rechazo] })
      vi.mocked(arcaDirectProvider.emitirNotaCredito).mockResolvedValue(rechazada)

      await anular()

      expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
      expect(auditUpdate).not.toHaveBeenCalled()
      expect(escrituras("delete")).toHaveLength(0)
      expect(carga.update).not.toHaveBeenCalled()
      // El único UPDATE es el de la NC a rechazado.
      expect(escrituras("update")).toHaveLength(1)
    })

    it("la respuesta no incluye provider_response", async () => {
      montar({ despues: [createChainMock({ ...NC_EMITIDA, estado: "rechazado" })] })
      vi.mocked(arcaDirectProvider.emitirNotaCredito).mockResolvedValue(rechazada)

      const { body } = await anular()

      expect(JSON.stringify(body)).not.toContain("provider_response")
    })

    it("si ni siquiera se puede registrar el rechazo (sin CAE, certero) se borra la fila pendiente y se responde 422 igual", async () => {
      const consola = vi.spyOn(console, "error").mockImplementation(() => {})
      const fallido = createChainMock(null, { message: "update caído" })
      const borrado = createChainMock(null, null)
      montar({ despues: [fallido, borrado] })
      vi.mocked(arcaDirectProvider.emitirNotaCredito).mockResolvedValue(rechazada)

      const { status, body } = await anular()

      expect(status).toBe(422)
      expect(body.error).toContain("10016")
      expect(borrado.delete).toHaveBeenCalled()
      expect(borrado.eq).toHaveBeenCalledWith("id", NC_ID)
      expect(borrado.eq).toHaveBeenCalledWith("estado", "pendiente")
      escritoSobreOrg(borrado)
      consola.mockRestore()
    })

    it("un fallo previo al envío (ARCA nunca la recibió) es un rechazo: se puede reintentar", async () => {
      const rechazo = createChainMock({ ...NC_EMITIDA, estado: "rechazado" })
      montar({ despues: [rechazo] })
      vi.mocked(arcaDirectProvider.emitirNotaCredito).mockResolvedValue({
        kind: "rechazada",
        errores: [MENSAJE_ERROR_TECNICO],
        raw: null,
      })

      const { status } = await anular()

      expect(status).toBe(422)
      expect(payloads(rechazo, "update")[0]).toMatchObject({ estado: "rechazado", error_msg: MENSAJE_ERROR_TECNICO })
    })
  })

  // ------------------------------------------------------ resultado incierto

  describe("el envío queda incierto", () => {
    const incierta = { kind: "incierta" as const, error: "ARCA respondió sin confirmar la nota de crédito. Verificala." }

    it("502 que identifica la NC pendiente y manda a verificar; NO la pasa a rechazado, ni siquiera tocando el estado", async () => {
      const marca = createChainMock(null, null)
      montar({ despues: [marca] })
      vi.mocked(arcaDirectProvider.emitirNotaCredito).mockResolvedValue(incierta)

      const { status, body } = await anular()

      expect(status).toBe(502)
      expect(body.verificar).toBe(true)
      expect(body.comprobante).toMatchObject({ id: NC_ID, estado: "pendiente", cbte_nro_solicitado: 5 })
      expect(body.error).toMatch(/No vuelvas a intentarlo/i)
      const cambios = payloads(marca, "update")
      expect(cambios).toHaveLength(1)
      expect(cambios[0]).toMatchObject({ error_msg: incierta.error })
      expect(cambios[0]).toHaveProperty("updated_at")
      expect(cambios[0]).not.toHaveProperty("estado")
    })

    it("el UPDATE solo toca esa fila pendiente de la organización y no se borra nada", async () => {
      const marca = createChainMock(null, null)
      montar({ despues: [marca] })
      vi.mocked(arcaDirectProvider.emitirNotaCredito).mockResolvedValue(incierta)

      await anular()

      expect(marca.eq).toHaveBeenCalledWith("id", NC_ID)
      expect(marca.eq).toHaveBeenCalledWith("estado", "pendiente")
      escritoSobreOrg(marca)
      // Ni esa fila ni ninguna otra se borra: ARCA pudo haberla emitido.
      expect(escrituras("delete")).toHaveLength(0)
    })

    it("jamás escribe 'rechazado' en ninguna cadena, ni llama al RPC de confirmación", async () => {
      const marca = createChainMock(null, null)
      montar({ despues: [marca] })
      vi.mocked(arcaDirectProvider.emitirNotaCredito).mockResolvedValue(incierta)

      await anular()

      for (const cambio of escrituras("update")) expect(cambio?.estado).not.toBe("rechazado")
      expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
      expect(auditUpdate).not.toHaveBeenCalled()
    })

    it("si el proveedor lanzara igual (no debería), se trata como incierto: nunca rechazado ni 500 sin identificar la NC", async () => {
      const consola = vi.spyOn(console, "error").mockImplementation(() => {})
      const marca = createChainMock(null, null)
      montar({ despues: [marca] })
      vi.mocked(arcaDirectProvider.emitirNotaCredito).mockRejectedValue(new Error("socket hang up"))

      const { status, body } = await anular()

      expect(status).toBe(502)
      expect(body.verificar).toBe(true)
      expect(body.comprobante).toMatchObject({ id: NC_ID, estado: "pendiente" })
      expect(payloads(marca, "update")[0]).not.toHaveProperty("estado")
      expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
      consola.mockRestore()
    })

    it("si no se puede dejar la marca, igual responde 502 verificar (la fila ya existe y se verifica por su número)", async () => {
      const consola = vi.spyOn(console, "error").mockImplementation(() => {})
      montar({ despues: [createChainMock(null, { message: "update caído" })] })
      vi.mocked(arcaDirectProvider.emitirNotaCredito).mockResolvedValue(incierta)

      const { status, body } = await anular()

      expect(status).toBe(502)
      expect(body.verificar).toBe(true)
      consola.mockRestore()
    })
  })

  // ------------------------------------------------------ plazo RG 4540

  describe("aviso del plazo de 15 días (RG 4540): informa, no bloquea", () => {
    it.each([
      ["hoy", "2026-10-20", 0, false],
      ["15 días", "2026-10-05", 15, false],
      ["16 días", "2026-10-04", 16, true],
      ["40 días", "2026-09-10", 40, true],
    ])("factura de %s", async (_titulo, fecha, dias, fuera) => {
      montar({ factura: { ...FACTURA, fecha_emision: fecha } })

      const { status, body } = await anular()

      expect(status).toBe(200)
      expect(body.diasDesdeEmision).toBe(dias)
      expect(body.fueraDePlazo).toBe(fuera)
    })

    it("una factura de 40 días se anula igual: el servidor no rechaza por antigüedad", async () => {
      montar({ factura: { ...FACTURA, fecha_emision: "2026-09-10" } })

      await anular()

      expect(arcaDirectProvider.emitirNotaCredito).toHaveBeenCalledTimes(1)
    })

    it("una factura legada sin fecha_emision usa la fecha que tiene ARCA", async () => {
      montar({ factura: FACTURA_LEGADA })
      vi.mocked(arcaDirectProvider.consultar).mockResolvedValue({ ...CONSULTA_B, cbteFch: "20261004" })

      const { body } = await anular()

      expect(body.diasDesdeEmision).toBe(16)
      expect(body.fueraDePlazo).toBe(true)
    })

    it("cuenta con el día de Argentina: a las 02:30 UTC todavía es el día anterior", async () => {
      vi.setSystemTime(new Date("2026-10-20T02:30:00Z")) // 23:30 del 19/10 en Buenos Aires
      montar({ factura: { ...FACTURA, fecha_emision: "2026-10-04" } })

      const { body } = await anular()

      expect(body.diasDesdeEmision).toBe(15)
      expect(body.fueraDePlazo).toBe(false)
    })

    it("también viaja en la respuesta de una NC incierta", async () => {
      montar({ factura: { ...FACTURA, fecha_emision: "2026-10-04" }, despues: [createChainMock(null, null)] })
      vi.mocked(arcaDirectProvider.emitirNotaCredito).mockResolvedValue({ kind: "incierta", error: "x" })

      const { body } = await anular()

      expect(body.fueraDePlazo).toBe(true)
    })
  })

  // ------------------------------------------------------ aislamiento

  describe("aislamiento entre organizaciones", () => {
    it("todas las queries de la ruta feliz llevan organization_id de la sesión", async () => {
      const { carga, activa, insercion, despues } = montar()

      await anular()

      escritoSobreOrg(carga)
      escritoSobreOrg(activa)
      escritoSobreOrg(despues[0])
      // El INSERT escribe la organización de la sesión, nunca una que venga en el cuerpo.
      expect(payloads(insercion, "insert")[0].organization_id).toBe(ORG)
    })

    it("un organization_id en el cuerpo se ignora", async () => {
      const { insercion } = montar()

      await anular({ organization_id: "org-ajena", ventaId: "venta-ajena", total: 1 })

      const [fila] = payloads(insercion, "insert")
      expect(fila.organization_id).toBe(ORG)
      expect(fila.venta_id).toBe("venta-1")
      expect(fila.total).toBe(1210)
    })
  })
})
