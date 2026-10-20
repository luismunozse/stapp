// @vitest-environment node
/**
 * Tests: POST /api/facturacion-electronica/comprobantes/[id]/verificar
 *
 * "Verificar con ARCA" concilia una nota de crédito electrónica que quedó sin
 * resolver (pendiente: el envío se cortó; rechazado: por si ARCA igual la emitió)
 * con lo que ARCA tiene. Lo que estos tests protegen:
 *  - NUNCA crea un comprobante en ARCA ni una fila nueva: solo consulta;
 *  - un `null` de la consulta o un error técnico no se toman como "ARCA no la emitió":
 *    sin confirmación, la NC queda como está (y reintentar emitiría una SEGUNDA NC);
 *  - no se rechaza dentro del período de gracia desde el último envío;
 *  - lo que ARCA tiene solo se adopta si coincide con lo que mandamos;
 *  - todo se filtra por la organización de la sesión.
 *
 * Los tests miran los filtros y los payloads de las queries (no cuántas veces se
 * llamó a cada cosa). Fixtures inventados: ningún CUIT ni dato de cliente real.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { CONTACT_EMAIL } from "@/lib/contact"
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
import { POST } from "@/app/api/facturacion-electronica/comprobantes/[id]/verificar/route"

// ---------------------------------------------------------------- fixtures

const ORG = "org-1"
const NC_ID = "nc-1"
const FACTURA_ID = "fac-1"
const CUIT_EMISOR = "20111111112"
const CAE_NC = "75999999999999"

const HOY = new Date("2026-10-20T15:00:00Z")
const MINUTO = 60_000
const hace = (ms: number) => new Date(HOY.getTime() - ms).toISOString()

const CREDS = {
  organizationId: ORG,
  cuit: CUIT_EMISOR,
  certPem: "CERT",
  keyPem: "KEY",
  puntoVenta: 3,
  condicionFiscal: "RESPONSABLE_INSCRIPTO" as const,
  production: false,
}

/**
 * NC B por 1210 (neto 1000 + IVA 210) que se mandó a ARCA como número 5 y quedó sin
 * confirmar hace 10 minutos (ya pasó el período de gracia).
 */
const NC_PENDIENTE = {
  id: NC_ID,
  venta_id: "venta-1",
  tipo: "B",
  punto_venta: 3,
  numero: null,
  cae: null,
  cae_vencimiento: null,
  estado: "pendiente",
  pdf_url: null,
  receptor_doc_tipo: "CONSUMIDOR FINAL",
  receptor_doc_nro: "0",
  receptor_condicion_iva: "CF",
  total: 1210,
  provider: "arca",
  error_msg: "No pudimos confirmar si ARCA emitió la nota de crédito.",
  created_at: hace(11 * MINUTO),
  updated_at: hace(10 * MINUTO),
  fecha_emision: "2026-10-20",
  cuit_emisor: CUIT_EMISOR,
  cbte_tipo: 8,
  importe_total: 1210,
  receptor_doc_tipo_cod: 99,
  receptor_doc_nro_cod: "0",
  comprobante_asociado_id: FACTURA_ID,
  cbte_nro_solicitado: 5,
  motivo: "error_factura",
  motivo_detalle: null,
  anulado_at: null,
}

const NC_RECHAZADA = { ...NC_PENDIENTE, estado: "rechazado", error_msg: "10016: no es el próximo número" }

const NC_EMITIDA_FILA = {
  ...NC_PENDIENTE,
  estado: "emitido",
  numero: "0003-00000005",
  cae: CAE_NC,
  cae_vencimiento: "20261030",
  error_msg: null,
}

/** Lo que la ruta devuelve de la NC: columnas seguras + las de anulación. */
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

/** NC C por 500 que se mandó como número 7 en el punto de venta 9. */
const NC_C_PENDIENTE = {
  ...NC_PENDIENTE,
  tipo: "C",
  punto_venta: 9,
  total: 500,
  cbte_tipo: 13,
  importe_total: 500,
  cbte_nro_solicitado: 7,
}

/** Lo que ARCA tiene como la nota de crédito número 5: coincide con la fila. */
const CONSULTA_NC = {
  existe: true,
  cbteNro: 5,
  cae: CAE_NC,
  caeVencimiento: "20261030",
  resultado: "A",
  cbteFch: "20261020",
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

const NO_EXISTE = { existe: false }

// ---------------------------------------------------------------- helpers

const params = (id: string = NC_ID) => ({ params: Promise.resolve({ id }) })

const verificar = (id: string = NC_ID) =>
  POST(new Request("http://localhost:3000/api/test", { method: "POST" }), params(id)).then(parseResponse)

type Cadena = ReturnType<typeof createChainMock>

/** Toda cadena que la ruta recibió de `supabaseAdmin.from`, incluidas las "de más". */
let entregadas: Cadena[] = []

/**
 * `comprobantes_fiscales` se consulta varias veces por request con intenciones
 * distintas (cargar la NC, actualizarla, releerla): una cadena por llamada, en el
 * orden en que la ruta las hace. Una llamada de más falla en voz alta en vez de
 * reutilizar la última, y queda en `entregadas` para que "nunca se borra / nunca se
 * escribe X" valga también para ella.
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
const escrituras = (metodo: "update" | "delete" | "insert" | "upsert") =>
  entregadas.flatMap((c) => vi.mocked(c[metodo]).mock.calls.map((llamada) => llamada[0] as Record<string, unknown> | undefined))

interface Escenario {
  nc?: unknown
  ncError?: unknown
  despues?: Cadena[]
}

/** Arma las cadenas de la ruta feliz; `despues` son las que siguen a la carga de la NC. */
function montar(e: Escenario = {}) {
  const carga = createChainMock(e.nc === undefined ? NC_PENDIENTE : e.nc, e.ncError ?? null)
  const despues = e.despues ?? [createChainMock(NC_EMITIDA)]
  montarTablas([carga, ...despues])
  return { carga, despues }
}

const payloads = (cadena: Cadena, metodo: "insert" | "update") =>
  vi.mocked(cadena[metodo]).mock.calls.map((c) => c[0] as Record<string, unknown>)

function sinEscrituras() {
  expect(escrituras("update")).toHaveLength(0)
  expect(escrituras("delete")).toHaveLength(0)
  expect(escrituras("insert")).toHaveLength(0)
  expect(escrituras("upsert")).toHaveLength(0)
  expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  expect(auditUpdate).not.toHaveBeenCalled()
}

function sinLlamadasAArca() {
  expect(arcaDirectProvider.consultar).not.toHaveBeenCalled()
  expect(arcaDirectProvider.ultimoAutorizado).not.toHaveBeenCalled()
}

/** ARCA tiene la NC pedida y coincide: el camino de la adopción. */
function arcaTieneLaNc(nc: unknown = NC_PENDIENTE, consulta: unknown = CONSULTA_NC) {
  const montado = montar({ nc })
  vi.mocked(arcaDirectProvider.consultar).mockResolvedValue(consulta as never)
  return montado
}

/** ARCA no tiene ese número y el último autorizado es anterior. */
function arcaNoLaTiene(nc: unknown = NC_PENDIENTE, ultimo = 4, despues?: Cadena[]) {
  const montado = montar({ nc, despues })
  vi.mocked(arcaDirectProvider.consultar).mockResolvedValue(NO_EXISTE)
  vi.mocked(arcaDirectProvider.ultimoAutorizado).mockResolvedValue(ultimo)
  return montado
}

// ---------------------------------------------------------------- tests

describe("POST /api/facturacion-electronica/comprobantes/[id]/verificar", () => {
  let consolaError: ReturnType<typeof vi.spyOn>
  let consolaWarn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(HOY)
    consolaError = vi.spyOn(console, "error").mockImplementation(() => {})
    consolaWarn = vi.spyOn(console, "warn").mockImplementation(() => {})

    mockAuthSuccess({ role: "ADMIN", organizationId: ORG, userId: "user-1" })
    vi.mocked(canEmitirFacturaElectronica).mockResolvedValue(true)
    vi.mocked(cargarCredencialesArca).mockResolvedValue({ ok: true, provider: "arca", creds: CREDS })
    vi.mocked(arcaDirectProvider.consultar).mockResolvedValue(CONSULTA_NC)
    vi.mocked(arcaDirectProvider.ultimoAutorizado).mockResolvedValue(4)
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { id: NC_ID, asociadoId: FACTURA_ID, replayed: false }, error: null } as never)
    auditUpdate.mockResolvedValue(undefined)
    montar()
  })

  afterEach(() => {
    // Invariantes de TODA respuesta: verificar nunca crea nada en ARCA ni en la base...
    expect(arcaDirectProvider.emitirNotaCredito).not.toHaveBeenCalled()
    expect(escrituras("insert")).toHaveLength(0)
    expect(escrituras("upsert")).toHaveLength(0)
    expect(escrituras("delete")).toHaveLength(0)
    // ...toca solo comprobantes_fiscales y el RPC de confirmación...
    expect([...new Set(vi.mocked(supabaseAdmin.from).mock.calls.map((c) => c[0]))].filter((t) => t !== "comprobantes_fiscales")).toEqual([])
    expect([...new Set(vi.mocked(supabaseAdmin.rpc).mock.calls.map((c) => c[0]))].filter((f) => f !== "confirmar_nota_credito_fiscal")).toEqual([])
    // ...filtra por la organización de la sesión en toda consulta o escritura...
    for (const cadena of entregadas) {
      const usada = ["select", "update"].some((m) => vi.mocked(cadena[m]).mock.calls.length > 0)
      if (usada) expect(cadena.eq).toHaveBeenCalledWith("organization_id", ORG)
    }
    // ...y nunca pide la respuesta cruda del proveedor.
    for (const cadena of entregadas) {
      for (const [columnas] of vi.mocked(cadena.select).mock.calls) {
        expect(String(columnas)).not.toContain("provider_response")
        expect(String(columnas)).not.toContain("*")
      }
    }
    consolaError.mockRestore()
    consolaWarn.mockRestore()
    vi.useRealTimers()
  })

  // ------------------------------------------------------ acceso

  describe("acceso", () => {
    it("401 sin sesión: no toca la base ni ARCA", async () => {
      mockAuthError()

      const { status } = await verificar()

      expect(status).toBe(401)
      expect(supabaseAdmin.from).not.toHaveBeenCalled()
      sinLlamadasAArca()
    })

    it("403 para quien no es Admin", async () => {
      mockAuthSuccess({ role: "VENDEDOR", organizationId: ORG })

      const { status } = await verificar()

      expect(status).toBe(403)
      expect(supabaseAdmin.from).not.toHaveBeenCalled()
      sinLlamadasAArca()
    })

    it("NO exige el gate de facturación: una baja de plan no deja trabada una NC incierta", async () => {
      vi.mocked(canEmitirFacturaElectronica).mockResolvedValue(false)
      arcaTieneLaNc()

      const { status, body } = await verificar()

      expect(status).toBe(200)
      expect(body.resultado).toBe("adoptada")
      expect(canEmitirFacturaElectronica).not.toHaveBeenCalled()
    })

    it.each(["../etc/passwd", "a b", "x".repeat(65), ""])("404 sin tocar la base para un id imposible (%j)", async (id) => {
      const { status } = await verificar(id)

      expect(status).toBe(404)
      expect(supabaseAdmin.from).not.toHaveBeenCalled()
      sinLlamadasAArca()
    })
  })

  // ------------------------------------------------------ la nota de crédito

  describe("la nota de crédito a verificar", () => {
    it("se carga por id Y organización, con la foto fiscal que se mandó (sin provider_response)", async () => {
      const { carga } = arcaTieneLaNc()

      await verificar()

      expect(carga.eq).toHaveBeenCalledWith("id", NC_ID)
      expect(carga.eq).toHaveBeenCalledWith("organization_id", ORG)
      const [columnas] = vi.mocked(carga.select).mock.calls[0] as [string]
      for (const columna of [
        "estado",
        "punto_venta",
        "cbte_nro_solicitado",
        "comprobante_asociado_id",
        "cbte_tipo",
        "importe_total",
        "receptor_doc_tipo_cod",
        "receptor_doc_nro_cod",
        "fecha_emision",
        "cuit_emisor",
        "created_at",
        "updated_at",
      ]) {
        expect(columnas).toContain(columna)
      }
      expect(columnas).not.toContain("provider_response")
    })

    it("404 cuando no existe en la organización (un id de otra org se ve igual que uno inexistente)", async () => {
      montar({ nc: null })

      const { status } = await verificar()

      expect(status).toBe(404)
      expect(cargarCredencialesArca).not.toHaveBeenCalled()
      sinLlamadasAArca()
    })

    it.each([
      ["42703", { code: "42703", message: 'column "cbte_nro_solicitado" does not exist' }],
      ["PGRST204", { code: "PGRST204", message: "Could not find the column in the schema cache" }],
    ])("503 sin la migración 371 (%s): no hay escalón de respaldo y no se llama a ARCA", async (_codigo, ncError) => {
      montar({ nc: null, ncError })

      const { status, body } = await verificar()

      expect(status).toBe(503)
      expect(body.error).toContain("todavía no está disponible")
      expect(cargarCredencialesArca).not.toHaveBeenCalled()
      sinLlamadasAArca()
      sinEscrituras()
    })

    it("500 ante cualquier otro error de base de datos", async () => {
      montar({ nc: null, ncError: { code: "57014", message: "statement timeout" } })

      const { status } = await verificar()

      expect(status).toBe(500)
      sinLlamadasAArca()
    })

    it.each([
      ["una factura (sin comprobante asociado)", { ...NC_PENDIENTE, comprobante_asociado_id: null, cbte_tipo: 6 }],
      ["una fila con asociado pero con tipo de factura", { ...NC_PENDIENTE, cbte_tipo: 6 }],
      ["una fila con asociado pero sin tipo", { ...NC_PENDIENTE, cbte_tipo: null }],
      ["una fila de tipo NC sin comprobante asociado", { ...NC_PENDIENTE, comprobante_asociado_id: null }],
    ])("422 si el comprobante no es una nota de crédito: %s", async (_titulo, nc) => {
      montar({ nc })

      const { status, body } = await verificar()

      expect(status).toBe(422)
      expect(body.error).toContain("nota de crédito")
      expect(cargarCredencialesArca).not.toHaveBeenCalled()
      sinLlamadasAArca()
      sinEscrituras()
    })

    it.each([
      ["pendiente", NC_PENDIENTE],
      ["rechazado", NC_RECHAZADA],
    ])("409 si la NC %s no tiene el número que se pidió a ARCA", async (_estado, base) => {
      for (const solicitado of [null, 0, -3, 2.5]) {
        montar({ nc: { ...base, cbte_nro_solicitado: solicitado } })

        const { status, body } = await verificar()

        expect(status, `cbte_nro_solicitado=${solicitado}`).toBe(409)
        expect(body.error).toContain(CONTACT_EMAIL)
      }
      sinLlamadasAArca()
      sinEscrituras()
    })

    it.each(["anulado", "borrador"])("409 si la NC está en un estado que no se verifica (%s)", async (estado) => {
      montar({ nc: { ...NC_PENDIENTE, estado } })

      const { status } = await verificar()

      expect(status).toBe(409)
      sinLlamadasAArca()
      sinEscrituras()
    })
  })

  // ------------------------------------------------------ la NC ya está emitida

  describe("NC ya emitida (idempotente)", () => {
    it("completa la anulación con el RPC y el CAE guardado: no pide credenciales ni llama a ARCA", async () => {
      const { despues } = montar({ nc: NC_EMITIDA_FILA })

      const { status, body } = await verificar()

      expect(status).toBe(200)
      expect(supabaseAdmin.rpc).toHaveBeenCalledWith("confirmar_nota_credito_fiscal", {
        p_org_id: ORG,
        p_nc_id: NC_ID,
        p_numero: "0003-00000005",
        p_cae: CAE_NC,
        p_cae_vencimiento: "20261030",
        p_provider_response: null,
      })
      expect(body.resultado).toBe("emitida")
      expect(body.comprobante).toEqual(NC_EMITIDA)
      expect(body.anulado).toEqual({ id: FACTURA_ID })
      expect(cargarCredencialesArca).not.toHaveBeenCalled()
      sinLlamadasAArca()
      // La NC se relee por id y organización.
      expect(despues[0].eq).toHaveBeenCalledWith("id", NC_ID)
    })

    it("desde TypeScript no escribe estados: la transición es solo del RPC", async () => {
      montar({ nc: NC_EMITIDA_FILA })

      await verificar()

      expect(escrituras("update")).toHaveLength(0)
    })

    it("verificar dos veces da el mismo resultado y no cambia nada", async () => {
      montar({ nc: NC_EMITIDA_FILA })
      const primera = await verificar()
      montar({ nc: NC_EMITIDA_FILA })
      vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { id: NC_ID, asociadoId: FACTURA_ID, replayed: true }, error: null } as never)
      const segunda = await verificar()

      expect(segunda.status).toBe(200)
      expect(segunda.body).toEqual(primera.body)
      expect(escrituras("update")).toHaveLength(0)
    })

    it("audita la anulación solo cuando el RPC realmente la hizo (no en una repetición)", async () => {
      montar({ nc: NC_EMITIDA_FILA })
      vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { id: NC_ID, asociadoId: FACTURA_ID, replayed: true }, error: null } as never)

      await verificar()

      expect(auditUpdate).not.toHaveBeenCalled()

      montar({ nc: NC_EMITIDA_FILA })
      vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { id: NC_ID, asociadoId: FACTURA_ID, replayed: false }, error: null } as never)

      await verificar()

      expect(auditUpdate).toHaveBeenCalledTimes(1)
    })

    it.each([
      ["número", { numero: null }],
      ["CAE", { cae: null }],
      ["vencimiento del CAE", { cae_vencimiento: null }],
    ])("409 si la NC emitida no tiene %s guardado: no se llama al RPC", async (_dato, faltante) => {
      montar({ nc: { ...NC_EMITIDA_FILA, ...faltante } })

      const { status, body } = await verificar()

      expect(status).toBe(409)
      expect(body.error).toContain(CONTACT_EMAIL)
      sinEscrituras()
    })
  })

  // ------------------------------------------------------ credenciales y emisor

  describe("credenciales y emisor", () => {
    it("pide las credenciales de la organización de la sesión", async () => {
      arcaTieneLaNc()

      await verificar()

      expect(cargarCredencialesArca).toHaveBeenCalledWith(ORG)
    })

    it.each([
      [400, "Credenciales no configuradas"],
      [409, "La facturación de esta organización no es directa con ARCA"],
      [500, "No se pudieron leer las credenciales"],
    ] as const)("reenvía la falla de credenciales tal cual (%i) sin llamar a ARCA", async (status, error) => {
      montar()
      vi.mocked(cargarCredencialesArca).mockResolvedValue({ ok: false, status, error })

      const respuesta = await verificar()

      expect(respuesta.status).toBe(status)
      expect(respuesta.body.error).toBe(error)
      sinLlamadasAArca()
      sinEscrituras()
    })

    it.each([
      ["otro CUIT emisor", "30222222223"],
      ["sin CUIT emisor guardado", null],
    ])("409 sin consultar a ARCA cuando la NC fue emitida con %s: otro emisor daría un 'no existe' falso", async (_titulo, cuit) => {
      montar({ nc: { ...NC_PENDIENTE, cuit_emisor: cuit } })

      const { status, body } = await verificar()

      expect(status).toBe(409)
      expect(body.error).toContain(CONTACT_EMAIL)
      sinLlamadasAArca()
      sinEscrituras()
    })

    it("compara el CUIT solo por dígitos", async () => {
      arcaTieneLaNc({ ...NC_PENDIENTE, cuit_emisor: "20-11111111-2" })

      const { status } = await verificar()

      expect(status).toBe(200)
    })

    it("con delegación el emisor es el CUIT representado, no el de la plataforma", async () => {
      arcaTieneLaNc()
      vi.mocked(cargarCredencialesArca).mockResolvedValue({
        ok: true,
        provider: "arca_delegado",
        creds: { ...CREDS, cuit: "30999999990", cuitRepresentado: CUIT_EMISOR },
      })

      const { status } = await verificar()

      expect(status).toBe(200)
      expect(arcaDirectProvider.consultar).toHaveBeenCalled()
    })

    it("con delegación 409 si el representado no es el emisor de la NC", async () => {
      montar()
      vi.mocked(cargarCredencialesArca).mockResolvedValue({
        ok: true,
        provider: "arca_delegado",
        creds: { ...CREDS, cuit: CUIT_EMISOR, cuitRepresentado: "30999999990" },
      })

      const { status } = await verificar()

      expect(status).toBe(409)
      sinLlamadasAArca()
    })
  })

  // ------------------------------------------------------ la consulta a ARCA

  describe("la consulta a ARCA", () => {
    it("pregunta por el punto de venta, el tipo y el número DE LA NC (no los de las credenciales)", async () => {
      arcaTieneLaNc({ ...NC_C_PENDIENTE }, { ...CONSULTA_NC, cbteNro: 7, impTotal: 500 })

      await verificar()

      expect(arcaDirectProvider.consultar).toHaveBeenCalledWith(CREDS, { puntoVenta: 9, cbteTipoAfip: 13, cbteNro: 7 })
    })

    it("una NC B se consulta como tipo 8", async () => {
      arcaTieneLaNc()

      await verificar()

      expect(arcaDirectProvider.consultar).toHaveBeenCalledWith(CREDS, { puntoVenta: 3, cbteTipoAfip: 8, cbteNro: 5 })
    })

    it("si ARCA la tiene no pide el último autorizado", async () => {
      arcaTieneLaNc()

      await verificar()

      expect(arcaDirectProvider.ultimoAutorizado).not.toHaveBeenCalled()
    })

    it("si ARCA no la devuelve, confirma con el último autorizado de ESE punto de venta y tipo", async () => {
      arcaNoLaTiene({ ...NC_C_PENDIENTE }, 6)

      await verificar()

      expect(arcaDirectProvider.ultimoAutorizado).toHaveBeenCalledWith(CREDS, 9, 13)
    })

    it("502 genérico y NADA escrito si la consulta falla (un error técnico no prueba que ARCA no la emitió)", async () => {
      arcaTieneLaNc()
      vi.mocked(arcaDirectProvider.consultar).mockRejectedValue(new Error("socket hang up"))

      const { status, body } = await verificar()

      expect(status).toBe(502)
      expect(body.error).toBe(MENSAJE_ERROR_TECNICO)
      sinEscrituras()
    })

    it("502 y NADA escrito si falla el último autorizado después de un 'no existe'", async () => {
      arcaNoLaTiene()
      vi.mocked(arcaDirectProvider.ultimoAutorizado).mockRejectedValue(new Error("WSAA caído"))

      const { status, body } = await verificar()

      expect(status).toBe(502)
      expect(body.error).toBe(MENSAJE_ERROR_TECNICO)
      sinEscrituras()
    })
  })

  // ------------------------------------------------------ ARCA tiene la NC

  describe("ARCA tiene la nota de crédito: se adopta", () => {
    it("confirma con el RPC atómico usando el número, el CAE y el vencimiento que dio ARCA", async () => {
      const { despues } = arcaTieneLaNc()

      const { status, body } = await verificar()

      expect(status).toBe(200)
      expect(supabaseAdmin.rpc).toHaveBeenCalledWith("confirmar_nota_credito_fiscal", {
        p_org_id: ORG,
        p_nc_id: NC_ID,
        p_numero: "0003-00000005",
        p_cae: CAE_NC,
        p_cae_vencimiento: "20261030",
        p_provider_response: { origen: "verificacion", consulta: CONSULTA_NC },
      })
      expect(body.resultado).toBe("adoptada")
      expect(body.comprobante).toEqual(NC_EMITIDA)
      expect(body.anulado).toEqual({ id: FACTURA_ID })
      // La NC se relee por id y organización, sin la respuesta cruda del proveedor.
      expect(despues[0].eq).toHaveBeenCalledWith("id", NC_ID)
      const [columnas] = vi.mocked(despues[0].select).mock.calls[0] as [string]
      expect(columnas).not.toContain("provider_response")
    })

    it("el número sale del punto de venta y del número pedido de la NC", async () => {
      arcaTieneLaNc({ ...NC_C_PENDIENTE }, { ...CONSULTA_NC, cbteNro: 7, impTotal: 500 })

      await verificar()

      expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
        "confirmar_nota_credito_fiscal",
        expect.objectContaining({ p_numero: "0009-00000007" })
      )
    })

    it("desde TypeScript NO escribe estados: la transición es solo del RPC", async () => {
      arcaTieneLaNc()

      await verificar()

      expect(escrituras("update")).toHaveLength(0)
    })

    it("también adopta dentro del período de gracia: que ARCA la tenga es prueba suficiente", async () => {
      arcaTieneLaNc({ ...NC_PENDIENTE, updated_at: hace(10_000) })

      const { status, body } = await verificar()

      expect(status).toBe(200)
      expect(body.resultado).toBe("adoptada")
    })

    it("adopta una NC que ya estaba rechazada (ARCA la emitió después de que se dio por perdida)", async () => {
      arcaTieneLaNc(NC_RECHAZADA)

      const { status, body } = await verificar()

      expect(status).toBe(200)
      expect(body.resultado).toBe("adoptada")
      expect(supabaseAdmin.rpc).toHaveBeenCalledTimes(1)
    })

    it("compara con el importe de la foto fiscal (importe_total) y tolera un NUMERIC que llega como texto", async () => {
      arcaTieneLaNc({ ...NC_PENDIENTE, total: 999, importe_total: "1210.00" })

      const { status, body } = await verificar()

      expect(status).toBe(200)
      expect(body.resultado).toBe("adoptada")
    })

    it("compara con el documento de la foto fiscal (códigos de ARCA), no con el texto de pantalla", async () => {
      arcaTieneLaNc(
        {
          ...NC_PENDIENTE,
          receptor_doc_tipo: "DNI",
          receptor_doc_nro: "12.345.678",
          receptor_doc_tipo_cod: 96,
          receptor_doc_nro_cod: "12345678",
        },
        { ...CONSULTA_NC, docTipo: 96, docNro: "12345678" }
      )

      const { status, body } = await verificar()

      expect(status).toBe(200)
      expect(body.resultado).toBe("adoptada")
    })

    it("compara la fecha de la foto fiscal (AAAA-MM-DD) con la de ARCA (AAAAMMDD)", async () => {
      arcaTieneLaNc({ ...NC_PENDIENTE, fecha_emision: "2026-10-19" }, { ...CONSULTA_NC, cbteFch: "20261019" })

      const { status } = await verificar()

      expect(status).toBe(200)
    })

    it("queda un registro de auditoría de la anulación (quién, qué factura, qué NC, qué motivo)", async () => {
      arcaTieneLaNc({ ...NC_PENDIENTE, motivo: "devolucion_total" })

      await verificar()

      expect(createAuditLogger).toHaveBeenCalledWith(ORG, "user-1", expect.any(Request))
      expect(auditUpdate).toHaveBeenCalledWith(
        "comprobantes_fiscales",
        FACTURA_ID,
        { estado: "emitido" },
        expect.objectContaining({ estado: "anulado", notaCredito: "0003-00000005", cae: CAE_NC, motivo: "devolucion_total" })
      )
    })

    it("una repetición del RPC (replayed) no vuelve a auditar", async () => {
      arcaTieneLaNc()
      vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { id: NC_ID, asociadoId: FACTURA_ID, replayed: true }, error: null } as never)

      const { status } = await verificar()

      expect(status).toBe(200)
      expect(auditUpdate).not.toHaveBeenCalled()
    })

    it("una auditoría caída no tumba una adopción que ya salió bien", async () => {
      arcaTieneLaNc()
      auditUpdate.mockRejectedValue(new Error("audit_logs caída"))

      const { status } = await verificar()

      expect(status).toBe(200)
    })

    it("si el RPC confirma pero no se puede releer la NC, igual responde 200 con lo que ARCA tiene", async () => {
      arcaTieneLaNc()
      montarTablas([createChainMock(NC_PENDIENTE), createChainMock(null, { message: "relectura caída" })])

      const { status, body } = await verificar()

      expect(status).toBe(200)
      expect(body.comprobante).toMatchObject({ id: NC_ID, estado: "emitido", numero: "0003-00000005", cae: CAE_NC })
    })

    it.each([
      ["el importe", { impTotal: 1000 }],
      ["el documento", { docNro: "20123456" }],
      ["el tipo de documento", { docTipo: 96 }],
      ["la fecha", { cbteFch: "20261019" }],
      ["el número (es de otro comprobante)", { cbteNro: 6 }],
      ["el resultado (no está autorizada)", { resultado: "R" }],
      ["el CAE (falta)", { cae: undefined }],
    ])("409 a soporte, sin RPC, cuando ARCA tiene ese número pero no coincide %s", async (_titulo, difiere) => {
      arcaTieneLaNc(NC_PENDIENTE, { ...CONSULTA_NC, ...difiere })

      const { status, body } = await verificar()

      expect(status).toBe(409)
      expect(body.resultado).toBe("soporte")
      expect(body.razon).toBe("datos_distintos")
      sinEscrituras()
    })

    it.each([
      [null, 0],
      ["", 0],
      ["   ", 0],
      ["no es un número", 0],
      // Dos infinitos serían "iguales": un valor no finito tampoco es legible.
      ["Infinity", Number.POSITIVE_INFINITY],
      [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
    ])("sin un importe legible en la foto fiscal (%s) no adopta nada: nunca se adivina", async (importe, impTotal) => {
      arcaTieneLaNc({ ...NC_PENDIENTE, importe_total: importe }, { ...CONSULTA_NC, impTotal })

      const { status, body } = await verificar()

      expect(status).toBe(409)
      expect(body.razon).toBe("datos_distintos")
      sinEscrituras()
    })
  })

  // ------------------------------------------------------ el RPC de confirmación falla

  describe.each([
    ["al adoptar lo que tiene ARCA", () => arcaTieneLaNc()],
    ["al completar una NC ya emitida", () => montar({ nc: NC_EMITIDA_FILA })],
  ])("el RPC de confirmación falla %s", (_titulo, preparar) => {
    it.each([
      ["otra NC activa o el número ya lo tiene otra NC emitida (23505)", { code: "23505", message: 'duplicate key value violates unique constraint "uq_comprobante_nc_activa"' }],
      ["la factura ya no está emitida", { code: "P0001", message: "La factura asociada no está emitida" }],
      ["la NC ya tiene otro CAE", { code: "P0001", message: "La nota de crédito ya está emitida con otro CAE" }],
    ])("409 a soporte y la fila no se toca: %s", async (_motivo, rpcError) => {
      preparar()
      vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: null, error: rpcError } as never)

      const { status, body } = await verificar()

      expect(status).toBe(409)
      expect(body.resultado).toBe("soporte")
      expect(body.razon).toBe("no_registrable")
      expect(body.error).toContain(CONTACT_EMAIL)
      expect(escrituras("update")).toHaveLength(0)
      expect(auditUpdate).not.toHaveBeenCalled()
    })

    it.each([
      ["un corte de la base", { code: "57014", message: "statement timeout" }],
      ["una validación interna del RPC (P0001 que no es un choque de negocio)", { code: "P0001", message: "El número de la nota de crédito no coincide con el pedido a ARCA" }],
    ])("500 con el CAE y el número cuando falla por otra causa (%s): la fila queda y se puede reintentar", async (_causa, rpcError) => {
      preparar()
      vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: null, error: rpcError } as never)

      const { status, body } = await verificar()

      expect(status).toBe(500)
      expect(body).toMatchObject({ cae: CAE_NC, numero: "0003-00000005", comprobanteId: NC_ID })
      expect(consolaError).toHaveBeenCalledWith(
        expect.stringContaining("confirmación"),
        expect.objectContaining({ ncId: NC_ID, cae: CAE_NC, numero: "0003-00000005", code: rpcError.code })
      )
      expect(escrituras("update")).toHaveLength(0)
      expect(auditUpdate).not.toHaveBeenCalled()
    })
  })

  // ------------------------------------------------------ ARCA no la emitió

  describe("ARCA no emitió la nota de crédito: se rechaza", () => {
    it("pasa a rechazado con un UPDATE condicional (solo si sigue pendiente) y responde 200", async () => {
      const rechazo = createChainMock({ ...NC_EMITIDA, estado: "rechazado", numero: null, cae: null, cae_vencimiento: null })
      arcaNoLaTiene(NC_PENDIENTE, 4, [rechazo])

      const { status, body } = await verificar()

      expect(status).toBe(200)
      expect(body.resultado).toBe("rechazada")
      expect(body.mensaje).toBe("ARCA no emitió la nota de crédito. Podés volver a anular la factura.")
      expect(body.comprobante).toMatchObject({ id: NC_ID, estado: "rechazado" })

      expect(payloads(rechazo, "update")).toEqual([
        { estado: "rechazado", error_msg: expect.stringContaining("ARCA no emitió"), updated_at: HOY.toISOString() },
      ])
      expect(rechazo.eq).toHaveBeenCalledWith("id", NC_ID)
      expect(rechazo.eq).toHaveBeenCalledWith("organization_id", ORG)
      expect(rechazo.eq).toHaveBeenCalledWith("estado", "pendiente")
      const [columnas] = vi.mocked(rechazo.select).mock.calls[0] as [string]
      expect(columnas).not.toContain("provider_response")
    })

    it("no hay RPC, ni auditoría, ni borrado: la factura sigue emitida y la fila queda como historial", async () => {
      arcaNoLaTiene(NC_PENDIENTE, 4, [createChainMock({ ...NC_EMITIDA, estado: "rechazado" })])

      await verificar()

      expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
      expect(auditUpdate).not.toHaveBeenCalled()
      expect(escrituras("delete")).toHaveLength(0)
      expect(escrituras("update")).toHaveLength(1)
    })

    it("usa created_at cuando la fila nunca se actualizó para medir el período de gracia", async () => {
      arcaNoLaTiene({ ...NC_PENDIENTE, updated_at: null, created_at: hace(20 * MINUTO) }, 4, [createChainMock({ ...NC_EMITIDA, estado: "rechazado" })])

      const { status, body } = await verificar()

      expect(status).toBe(200)
      expect(body.resultado).toBe("rechazada")
    })

    it("si otro request la cambió mientras tanto (el UPDATE no toca filas): 409 con la fila actual, sin pisarla", async () => {
      const sinFilas = createChainMock(null)
      const actual = createChainMock(NC_EMITIDA)
      arcaNoLaTiene(NC_PENDIENTE, 4, [sinFilas, actual])

      const { status, body } = await verificar()

      expect(status).toBe(409)
      expect(body.resultado).toBe("cambio")
      expect(body.comprobante).toEqual(NC_EMITIDA)
      expect(escrituras("update")).toHaveLength(1)
      expect(actual.eq).toHaveBeenCalledWith("id", NC_ID)
    })

    it("500 si el UPDATE falla (la fila sigue pendiente)", async () => {
      arcaNoLaTiene(NC_PENDIENTE, 4, [createChainMock(null, { code: "57014", message: "statement timeout" })])

      const { status } = await verificar()

      expect(status).toBe(500)
    })

    it("una NC que ya estaba rechazada responde 200 sin escribir nada (idempotente)", async () => {
      arcaNoLaTiene(NC_RECHAZADA, 4, [createChainMock({ ...NC_EMITIDA, estado: "rechazado", numero: null })])

      const { status, body } = await verificar()

      expect(status).toBe(200)
      expect(body.resultado).toBe("rechazada")
      expect(body.comprobante).toMatchObject({ estado: "rechazado" })
      sinEscrituras()
    })

    it("una NC rechazada sigue sin rechazarse otra vez aunque esté dentro de la gracia", async () => {
      arcaNoLaTiene({ ...NC_RECHAZADA, updated_at: hace(5_000) }, 4, [createChainMock({ ...NC_EMITIDA, estado: "rechazado" })])

      const { status, body } = await verificar()

      expect(status).toBe(200)
      expect(body.resultado).toBe("rechazada")
      sinEscrituras()
    })
  })

  // ------------------------------------------------------ período de gracia

  describe("período de gracia desde el último envío", () => {
    it("dentro de la gracia: 409 'probá en unos minutos' y NO escribe nada", async () => {
      arcaNoLaTiene({ ...NC_PENDIENTE, updated_at: hace(2 * MINUTO) })

      const { status, body } = await verificar()

      expect(status).toBe(409)
      expect(body.resultado).toBe("esperar")
      expect(body.error).toContain("probá en unos minutos")
      sinEscrituras()
    })

    it("a 4:59 del envío espera; a 5:01 ya rechaza", async () => {
      arcaNoLaTiene({ ...NC_PENDIENTE, updated_at: hace(4 * MINUTO + 59_000) })
      const espera = await verificar()

      expect(espera.body.resultado).toBe("esperar")
      sinEscrituras()

      arcaNoLaTiene({ ...NC_PENDIENTE, updated_at: hace(5 * MINUTO + 1_000) }, 4, [createChainMock({ ...NC_EMITIDA, estado: "rechazado" })])
      const rechaza = await verificar()

      expect(rechaza.body.resultado).toBe("rechazada")
    })

    it("sin fecha de último envío legible no se rechaza: se espera", async () => {
      arcaNoLaTiene({ ...NC_PENDIENTE, updated_at: null, created_at: null })

      const { status, body } = await verificar()

      expect(status).toBe(409)
      expect(body.resultado).toBe("esperar")
      sinEscrituras()
    })
  })

  // ------------------------------------------------------ soporte

  describe("casos que requieren a una persona", () => {
    it("ARCA tiene ese número con otros datos: 409 con el correo de soporte, la NC queda pendiente", async () => {
      arcaTieneLaNc(NC_PENDIENTE, { ...CONSULTA_NC, impTotal: 1000 })

      const { status, body } = await verificar()

      expect(status).toBe(409)
      expect(body.resultado).toBe("soporte")
      expect(body.razon).toBe("datos_distintos")
      expect(body.error).toContain("ARCA tiene una nota de crédito con ese número pero no coincide con la que enviamos")
      expect(body.error).toContain(CONTACT_EMAIL)
      sinEscrituras()
    })

    it.each([5, 9])(
      "ARCA ya autorizó hasta el %i pero no devolvió el número 5: no se rechaza, 409 a soporte",
      async (ultimo) => {
        arcaNoLaTiene(NC_PENDIENTE, ultimo)

        const { status, body } = await verificar()

        expect(status).toBe(409)
        expect(body.resultado).toBe("soporte")
        expect(body.razon).toBe("numero_ocupado")
        expect(body.error).toContain(CONTACT_EMAIL)
        sinEscrituras()
      }
    )

    it("no se rechaza ni siquiera una NC rechazada si el número está ocupado", async () => {
      arcaNoLaTiene(NC_RECHAZADA, 6)

      const { status, body } = await verificar()

      expect(status).toBe(409)
      expect(body.razon).toBe("numero_ocupado")
      sinEscrituras()
    })

    it("un último autorizado ilegible no rechaza: 409 a soporte", async () => {
      arcaNoLaTiene(NC_PENDIENTE, Number.NaN)

      const { status, body } = await verificar()

      expect(status).toBe(409)
      expect(body.razon).toBe("sin_confirmacion")
      expect(body.error).toContain(CONTACT_EMAIL)
      sinEscrituras()
    })

    it("deja constancia en el log para soporte, sin datos del cliente", async () => {
      arcaTieneLaNc(NC_PENDIENTE, { ...CONSULTA_NC, impTotal: 1000 })

      await verificar()

      expect(consolaWarn).toHaveBeenCalledWith(expect.stringContaining("soporte"), { ncId: NC_ID, razon: "datos_distintos" })
    })
  })

  // ------------------------------------------------------ aislamiento

  describe("aislamiento entre organizaciones", () => {
    it("toda consulta lleva la organización de la sesión, aunque el cuerpo traiga otra", async () => {
      arcaTieneLaNc()

      const respuesta = await POST(
        new Request("http://localhost:3000/api/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ organization_id: "org-ajena", organizationId: "org-ajena" }),
        }),
        params()
      )

      expect(respuesta.status).toBe(200)
      expect(cargarCredencialesArca).toHaveBeenCalledWith(ORG)
      expect(supabaseAdmin.rpc).toHaveBeenCalledWith("confirmar_nota_credito_fiscal", expect.objectContaining({ p_org_id: ORG }))
      for (const cadena of entregadas) {
        expect(cadena.eq).not.toHaveBeenCalledWith("organization_id", "org-ajena")
      }
    })
  })
})
