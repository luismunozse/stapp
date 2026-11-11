// @vitest-environment node
/**
 * Tests: POST /api/facturacion-electronica/emitir
 *
 * ADMIN-only endpoint. Gate is re-checked server-side (never trusts the
 * client). Idempotent: returns 409 without re-emitting when an `emitido`
 * comprobante already exists for the venta.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { MENSAJE_ERROR_TECNICO } from "@/lib/facturacion/errores"
import { FILTRO_SIN_NC } from "@/lib/facturacion/cbte-tipo"
import {
  mockAuthSuccess,
  mockAuthError,
  createChainMock,
  createPostRequest,
  parseResponse,
} from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

vi.mock("@/lib/facturacion/access", () => ({
  canEmitirFacturaElectronica: vi.fn(),
}))

vi.mock("@/lib/facturacion/crypto", () => ({
  decryptSecret: (s: string) => s,
}))

vi.mock("@/lib/facturacion/tusfacturas-provider", () => ({
  tusFacturasProvider: { emitir: vi.fn() },
}))

vi.mock("@/lib/facturacion/arca/stapp-cert", () => ({
  getCertificadoStapp: vi.fn(),
  ArcaStappCertError: class ArcaStappCertError extends Error {},
}))

// Los casos ARCA (número explícito, resultado incierto) viven en
// facturacion-electronica-emitir-arca-numerada.test.ts.
vi.mock("@/lib/facturacion/arca/arca-direct-provider", () => ({
  arcaDirectProvider: { emitir: vi.fn(), armarFactura: vi.fn(), ultimoAutorizado: vi.fn(), emitirFacturaNumerada: vi.fn() },
}))

vi.mock("@/lib/facturacion/map-venta", () => ({
  mapVentaToEmitirInput: vi.fn(),
}))

// Passthrough espiado: la emision tiene que sacar la letra de la misma regla
// compartida que usa el listado para anunciarla (`tipoEmision`).
vi.mock("@/lib/facturacion/derive", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/facturacion/derive")>()
  return { ...real, deriveTipo: vi.fn(real.deriveTipo) }
})

import { canEmitirFacturaElectronica } from "@/lib/facturacion/access"
import { tusFacturasProvider } from "@/lib/facturacion/tusfacturas-provider"
import { arcaDirectProvider } from "@/lib/facturacion/arca/arca-direct-provider"
import { getCertificadoStapp, ArcaStappCertError } from "@/lib/facturacion/arca/stapp-cert"
import { mapVentaToEmitirInput } from "@/lib/facturacion/map-venta"
import { deriveTipo, tipoEmisionDeFila } from "@/lib/facturacion/derive"
import { POST } from "@/app/api/facturacion-electronica/emitir/route"

/**
 * Some tables (comprobantes_fiscales in particular) are queried more than
 * once per request with different intents (select existing, insert
 * pendiente, update final). `mockSupabaseFrom` from helpers.ts maps one
 * chain per table, which can't represent that. This sequences one chain
 * per call, in call order, per table.
 */
function mockSupabaseSequenced(sequence: Record<string, ReturnType<typeof createChainMock>[]>) {
  const counters: Record<string, number> = {}
  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    const chains = sequence[table]
    // Sin devoluciones salvo que el test diga otra cosa
    if (table === "devoluciones_venta" && !chains) return createChainMock(null, null, 0) as any
    if (!chains || chains.length === 0) {
      return createChainMock(null, { message: `No mock for table: ${table}` }) as any
    }
    const idx = counters[table] ?? 0
    counters[table] = idx + 1
    return (chains[idx] ?? chains[chains.length - 1]) as any
  })
}

const VENTA = { id: "venta-1", organization_id: "org-1", estado: "COMPLETADA", total: 100, cliente_nombre: "Juan Perez", iva_tasa: 21 }
const ITEMS = [{ id: "it-1", venta_id: "venta-1", descripcion: "Servicio", cantidad: 1, precio_unitario: 100 }]
const CREDENCIALES = {
  organization_id: "org-1",
  apitoken_enc: "tok-enc",
  apikey_enc: "key-enc",
  usertoken_enc: "user-enc",
  punto_venta: 3,
  condicion_fiscal: "MONOTRIBUTO",
}
const CREDENCIALES_ARCA = {
  organization_id: "org-1",
  provider: "arca",
  cuit: "23944498389",
  cert_pem_enc: "cert-enc",
  key_pem_enc: "key-enc",
  apitoken_enc: null,
  apikey_enc: null,
  usertoken_enc: null,
  punto_venta: 3,
  condicion_fiscal: "MONOTRIBUTO",
}
const CREDENCIALES_DELEGADO = {
  organization_id: "org-1",
  provider: "arca_delegado",
  estado: "conectado",
  cuit: "30710955057",
  cert_pem_enc: null,
  key_pem_enc: null,
  apitoken_enc: null,
  apikey_enc: null,
  usertoken_enc: null,
  punto_venta: 2,
  condicion_fiscal: "RESPONSABLE_INSCRIPTO",
}
const MAPPED_INPUT = {
  ventaId: "venta-1",
  moneda: "PES",
  total: 100,
  receptor: { razonSocial: "Juan Perez", documentoTipo: "CONSUMIDOR FINAL", documentoNro: "0", condicionIva: "CF" },
  items: [{ cantidad: 1, descripcion: "Servicio", importeUnitario: 100, alicuotaIva: 21 }],
}

// Debe coincidir exactamente con la lista de columnas seguras del route:
// nunca incluye provider_response (nunca se devuelve al cliente).
const SAFE_COLUMNS =
  "id, venta_id, tipo, punto_venta, numero, cae, cae_vencimiento, estado, pdf_url, receptor_doc_tipo, receptor_doc_nro, receptor_condicion_iva, total, provider, error_msg, created_at, updated_at"

describe("POST /api/facturacion-electronica/emitir", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(mapVentaToEmitirInput).mockReturnValue(MAPPED_INPUT as any)
  })

  it("401 unauthenticated", async () => {
    mockAuthError()

    const { status } = await parseResponse(await POST(createPostRequest({ ventaId: "venta-1" })))

    expect(status).toBe(401)
  })

  it("403 when facturacion electronica gate is disabled", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    vi.mocked(canEmitirFacturaElectronica).mockResolvedValue(false)

    const { status, body } = await parseResponse(await POST(createPostRequest({ ventaId: "venta-1" })))

    expect(status).toBe(403)
    expect(body.error).toBeDefined()
    expect(tusFacturasProvider.emitir).not.toHaveBeenCalled()
  })

  it("400 when ventaId is missing", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    vi.mocked(canEmitirFacturaElectronica).mockResolvedValue(true)

    const { status, body } = await parseResponse(await POST(createPostRequest({})))

    expect(status).toBe(400)
    expect(body.error).toBeDefined()
  })

  it("409 when an emitido comprobante already exists (idempotent, does not re-emit)", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    vi.mocked(canEmitirFacturaElectronica).mockResolvedValue(true)
    const existing = { id: "cmp-0", venta_id: "venta-1", estado: "emitido", cae: "111" }
    mockSupabaseSequenced({
      comprobantes_fiscales: [createChainMock(existing)],
    })

    const { status, body } = await parseResponse(await POST(createPostRequest({ ventaId: "venta-1" })))

    expect(status).toBe(409)
    expect(body.yaEmitido).toBe(true)
    expect(body.comprobante).toEqual(existing)
    expect(body.comprobante).not.toHaveProperty("provider_response")
    expect(tusFacturasProvider.emitir).not.toHaveBeenCalled()
  })

  it("409 sin emitir cuando la venta está anulada", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    vi.mocked(canEmitirFacturaElectronica).mockResolvedValue(true)
    mockSupabaseSequenced({
      comprobantes_fiscales: [createChainMock(null)],
      ventas: [createChainMock({ ...VENTA, estado: "ANULADA" })],
    })

    const { status, body } = await parseResponse(await POST(createPostRequest({ ventaId: "venta-1" })))

    expect(status).toBe(409)
    expect(body.error).toMatch(/completadas/)
    expect(tusFacturasProvider.emitir).not.toHaveBeenCalled()
  })

  it("409 sin emitir cuando la venta tiene devoluciones (facturaría el total original)", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    vi.mocked(canEmitirFacturaElectronica).mockResolvedValue(true)
    mockSupabaseSequenced({
      comprobantes_fiscales: [createChainMock(null)],
      ventas: [createChainMock(VENTA)],
      devoluciones_venta: [createChainMock(null, null, 1)],
    })

    const { status, body } = await parseResponse(await POST(createPostRequest({ ventaId: "venta-1" })))

    expect(status).toBe(409)
    expect(body.error).toMatch(/devoluciones/)
    expect(tusFacturasProvider.emitir).not.toHaveBeenCalled()
  })

  it.each([0, -50, null])("422 sin crear comprobante cuando la venta es de cero o menos (total %s)", async (total) => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    vi.mocked(canEmitirFacturaElectronica).mockResolvedValue(true)
    mockSupabaseSequenced({
      comprobantes_fiscales: [createChainMock(null)],
      ventas: [createChainMock({ ...VENTA, total })],
      items_venta: [createChainMock(ITEMS)],
      facturacion_credenciales: [createChainMock(CREDENCIALES)],
    })

    const { status, body } = await parseResponse(await POST(createPostRequest({ ventaId: "venta-1" })))

    expect(status).toBe(422)
    expect(body.error).toBe("No se puede facturar una venta en $0")
    // Solo la consulta de idempotencia: nunca se llegó al INSERT del pendiente.
    const tablas = vi.mocked(supabaseAdmin.from).mock.calls.map((c) => c[0])
    expect(tablas.filter((t) => t === "comprobantes_fiscales")).toHaveLength(1)
    expect(tusFacturasProvider.emitir).not.toHaveBeenCalled()
    expect(arcaDirectProvider.emitir).not.toHaveBeenCalled()
  })

  it("409 when insert hits a unique violation (23505) — in-flight/duplicate, does not call the provider", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    vi.mocked(canEmitirFacturaElectronica).mockResolvedValue(true)
    const active = { id: "cmp-active", venta_id: "venta-1", estado: "pendiente", cae: null }
    mockSupabaseSequenced({
      comprobantes_fiscales: [
        createChainMock(null), // existing check -> none
        createChainMock(null, {
          code: "23505",
          message: 'duplicate key value violates unique constraint "uq_comprobante_venta_activo"',
        }), // insert -> unique violation (another active comprobante already exists)
        createChainMock(active), // race re-fetch -> the active row
      ],
      ventas: [createChainMock(VENTA)],
      items_venta: [createChainMock(ITEMS)],
      facturacion_credenciales: [createChainMock(CREDENCIALES)],
    })

    const { status, body } = await parseResponse(await POST(createPostRequest({ ventaId: "venta-1" })))

    expect(status).toBe(409)
    expect(body.yaEmitido).toBe(true)
    expect(body.comprobante).toEqual(active)
    expect(body.comprobante).not.toHaveProperty("provider_response")
    expect(tusFacturasProvider.emitir).not.toHaveBeenCalled()
  })

  it("200 + estado emitido on provider success", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    vi.mocked(canEmitirFacturaElectronica).mockResolvedValue(true)
    vi.mocked(tusFacturasProvider.emitir).mockResolvedValue({
      ok: true,
      cae: "1",
      numero: "0003-1",
      tipo: "C",
      pdfUrl: "http://p",
      raw: {},
    } as any)
    const updated = { id: "cmp-1", estado: "emitido", cae: "1", numero: "0003-1", pdf_url: "http://p" }
    const insertChain = createChainMock({ id: "cmp-1" })
    const updateChain = createChainMock(updated)
    mockSupabaseSequenced({
      comprobantes_fiscales: [
        createChainMock(null), // existing check -> none
        insertChain, // insert pendiente
        updateChain, // update -> emitido
      ],
      ventas: [createChainMock(VENTA)],
      items_venta: [createChainMock(ITEMS)],
      facturacion_credenciales: [createChainMock(CREDENCIALES)],
    })

    const { status, body } = await parseResponse(await POST(createPostRequest({ ventaId: "venta-1" })))

    expect(status).toBe(200)
    expect(body.comprobante.estado).toBe("emitido")
    expect(body.comprobante.cae).toBe("1")
    expect(tusFacturasProvider.emitir).toHaveBeenCalledTimes(1)
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ estado: "emitido", cae: "1", numero: "0003-1" })
    )
    expect(updateChain.select).toHaveBeenCalledWith(SAFE_COLUMNS)
    expect(body.comprobante).not.toHaveProperty("provider_response")
  })

  it.each([
    ["MONOTRIBUTO", "C"],
    ["RESPONSABLE_INSCRIPTO", "B"],
    [null, "C"],
  ])("el pendiente se inserta con la letra de la regla compartida (condicion %s -> %s)", async (condicion, letra) => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    vi.mocked(canEmitirFacturaElectronica).mockResolvedValue(true)
    vi.mocked(tusFacturasProvider.emitir).mockResolvedValue({ ok: false, errores: ["x"], raw: {} } as any)
    const insertChain = createChainMock({ id: "cmp-1" })
    const fila = { ...CREDENCIALES, condicion_fiscal: condicion }
    mockSupabaseSequenced({
      comprobantes_fiscales: [createChainMock(null), insertChain, createChainMock({ id: "cmp-1", estado: "rechazado" })],
      ventas: [createChainMock(VENTA)],
      items_venta: [createChainMock(ITEMS)],
      facturacion_credenciales: [createChainMock(fila)],
    })

    await POST(createPostRequest({ ventaId: "venta-1" }))

    expect(deriveTipo).toHaveBeenCalled()
    expect(insertChain.insert).toHaveBeenCalledWith(expect.objectContaining({ tipo: letra }))
    expect(tipoEmisionDeFila(fila)).toBe(letra)
  })

  it("422 + estado rechazado on provider failure", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    vi.mocked(canEmitirFacturaElectronica).mockResolvedValue(true)
    vi.mocked(tusFacturasProvider.emitir).mockResolvedValue({
      ok: false,
      errores: ["CUIT invalido"],
      raw: {},
    } as any)
    const rejected = { id: "cmp-1", estado: "rechazado", error_msg: "CUIT invalido" }
    const updateChain = createChainMock(rejected)
    mockSupabaseSequenced({
      comprobantes_fiscales: [
        createChainMock(null), // existing check -> none
        createChainMock({ id: "cmp-1" }), // insert pendiente
        updateChain, // update -> rechazado
      ],
      ventas: [createChainMock(VENTA)],
      items_venta: [createChainMock(ITEMS)],
      facturacion_credenciales: [createChainMock(CREDENCIALES)],
    })

    const { status, body } = await parseResponse(await POST(createPostRequest({ ventaId: "venta-1" })))

    expect(status).toBe(422)
    expect(body.comprobante.estado).toBe("rechazado")
    expect(body.error).toBeDefined()
    expect(updateChain.select).toHaveBeenCalledWith(SAFE_COLUMNS)
    expect(body.comprobante).not.toHaveProperty("provider_response")
  })

  it("409 without a leaked undefined comprobante when the active re-fetch after a 23505 conflict errors", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    vi.mocked(canEmitirFacturaElectronica).mockResolvedValue(true)
    mockSupabaseSequenced({
      comprobantes_fiscales: [
        createChainMock(null), // existing check -> none
        createChainMock(null, {
          code: "23505",
          message: 'duplicate key value violates unique constraint "uq_comprobante_venta_activo"',
        }), // insert -> unique violation
        createChainMock(null, { message: "re-fetch failed" }), // race re-fetch -> errors
      ],
      ventas: [createChainMock(VENTA)],
      items_venta: [createChainMock(ITEMS)],
      facturacion_credenciales: [createChainMock(CREDENCIALES)],
    })

    const { status, body } = await parseResponse(await POST(createPostRequest({ ventaId: "venta-1" })))

    expect(status).toBe(409)
    expect(body.error).toBeDefined()
    expect(body).not.toHaveProperty("comprobante")
    expect(tusFacturasProvider.emitir).not.toHaveBeenCalled()
  })

  it("422 when the provider throws and the rechazado-recovery update succeeds (no pendiente cleanup)", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    vi.mocked(canEmitirFacturaElectronica).mockResolvedValue(true)
    vi.mocked(tusFacturasProvider.emitir).mockRejectedValue(new Error("boom"))
    const updateChain = createChainMock({ id: "cmp-1", estado: "rechazado" })
    mockSupabaseSequenced({
      comprobantes_fiscales: [
        createChainMock(null), // existing check -> none
        createChainMock({ id: "cmp-1" }), // insert pendiente
        updateChain, // update -> rechazado succeeds
      ],
      ventas: [createChainMock(VENTA)],
      items_venta: [createChainMock(ITEMS)],
      facturacion_credenciales: [createChainMock(CREDENCIALES)],
    })

    const { status, body } = await parseResponse(await POST(createPostRequest({ ventaId: "venta-1" })))

    expect(status).toBe(422)
    expect(body.error).toBeDefined()
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ estado: "rechazado", error_msg: MENSAJE_ERROR_TECNICO })
    )
    expect(updateChain.delete).not.toHaveBeenCalled()
  })

  it("502 when the provider throws and the rechazado-recovery update also fails (deletes the stuck pendiente)", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    vi.mocked(canEmitirFacturaElectronica).mockResolvedValue(true)
    vi.mocked(tusFacturasProvider.emitir).mockRejectedValue(new Error("boom"))
    const failedUpdateChain = createChainMock(null, { message: "update failed" })
    const deleteChain = createChainMock(null)
    mockSupabaseSequenced({
      comprobantes_fiscales: [
        createChainMock(null), // existing check -> none
        createChainMock({ id: "cmp-1" }), // insert pendiente
        failedUpdateChain, // update -> rechazado attempt fails (no CAE was ever confirmed)
        deleteChain, // cleanup delete of the stuck pendiente
      ],
      ventas: [createChainMock(VENTA)],
      items_venta: [createChainMock(ITEMS)],
      facturacion_credenciales: [createChainMock(CREDENCIALES)],
    })

    const { status, body } = await parseResponse(await POST(createPostRequest({ ventaId: "venta-1" })))

    expect(status).toBe(502)
    expect(body.error).toBeDefined()
    expect(deleteChain.delete).toHaveBeenCalled()
    expect(deleteChain.eq).toHaveBeenCalledWith("id", "cmp-1")
  })

  it("500 when the provider returns ok:false and the rechazado update fails (deletes the stuck pendiente)", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    vi.mocked(canEmitirFacturaElectronica).mockResolvedValue(true)
    vi.mocked(tusFacturasProvider.emitir).mockResolvedValue({
      ok: false,
      errores: ["CUIT invalido"],
      raw: {},
    } as any)
    const failedUpdateChain = createChainMock(null, { message: "update failed" })
    const deleteChain = createChainMock(null)
    mockSupabaseSequenced({
      comprobantes_fiscales: [
        createChainMock(null), // existing check -> none
        createChainMock({ id: "cmp-1" }), // insert pendiente
        failedUpdateChain, // update -> rechazado attempt fails (no CAE was ever issued)
        deleteChain, // cleanup delete of the stuck pendiente
      ],
      ventas: [createChainMock(VENTA)],
      items_venta: [createChainMock(ITEMS)],
      facturacion_credenciales: [createChainMock(CREDENCIALES)],
    })

    const { status, body } = await parseResponse(await POST(createPostRequest({ ventaId: "venta-1" })))

    expect(status).toBe(500)
    expect(body.error).toBeDefined()
    expect(deleteChain.delete).toHaveBeenCalled()
    expect(deleteChain.eq).toHaveBeenCalledWith("id", "cmp-1")
  })

  it("500 with cae/numero for manual reconciliation when the emitido update fails after a real CAE was issued (never deletes)", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    vi.mocked(canEmitirFacturaElectronica).mockResolvedValue(true)
    vi.mocked(tusFacturasProvider.emitir).mockResolvedValue({
      ok: true,
      cae: "cae-123",
      numero: "0003-1",
      tipo: "C",
      pdfUrl: "http://p",
      raw: {},
    } as any)
    const failedUpdateChain = createChainMock(null, { message: "update failed" })
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    mockSupabaseSequenced({
      comprobantes_fiscales: [
        createChainMock(null), // existing check -> none
        createChainMock({ id: "cmp-1" }), // insert pendiente
        failedUpdateChain, // update -> emitido fails (CAE is real, must NOT delete)
      ],
      ventas: [createChainMock(VENTA)],
      items_venta: [createChainMock(ITEMS)],
      facturacion_credenciales: [createChainMock(CREDENCIALES)],
    })

    const { status, body } = await parseResponse(await POST(createPostRequest({ ventaId: "venta-1" })))

    expect(status).toBe(500)
    expect(body.cae).toBe("cae-123")
    expect(body.numero).toBe("0003-1")
    expect(failedUpdateChain.delete).not.toHaveBeenCalled()
    expect(consoleSpy).toHaveBeenCalledWith(
      "[facturacion] emitido pero fallo el update",
      expect.objectContaining({ cae: "cae-123", numero: "0003-1" })
    )
    consoleSpy.mockRestore()
  })

  /**
   * La fila de credenciales decide el proveedor. Una fila `arca` tiene los
   * tokens legacy en NULL, así que si el despacho se equivocara la ruta
   * moriría en `decryptSecret(null)` en vez de emitir.
   */
  /**
   * Si faltan las env vars del certificado de plataforma, TODAS las orgs
   * delegadas dejan de facturar a la vez. Un 500 generico manda a leer logs;
   * el mensaje propio dice que es configuracion y no un problema del taller.
   */
  it("500 con mensaje propio cuando falta el certificado de plataforma", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    vi.mocked(canEmitirFacturaElectronica).mockResolvedValue(true)
    vi.mocked(getCertificadoStapp).mockImplementation(() => {
      throw new ArcaStappCertError("ARCA_STAPP_CERT_B64 no configurada")
    })
    mockSupabaseSequenced({
      comprobantes_fiscales: [createChainMock(null)],
      ventas: [createChainMock(VENTA)],
      items_venta: [createChainMock(ITEMS)],
      facturacion_credenciales: [createChainMock(CREDENCIALES_DELEGADO)],
    })

    const { status, body } = await parseResponse(await POST(createPostRequest({ ventaId: "venta-1" })))

    expect(status).toBe(500)
    expect(body.error).toMatch(/certificado de plataforma/i)
  })

  const SNAPSHOT_KEYS = [
    "fecha_emision", "cuit_emisor", "cbte_tipo", "concepto", "moneda", "cotizacion",
    "importe_neto", "importe_iva", "importe_total", "receptor_doc_tipo_cod", "receptor_doc_nro_cod", "detalle",
  ]
  const updatePayloads = (chain: ReturnType<typeof createChainMock>) =>
    vi.mocked(chain.update).mock.calls.map((c) => c[0] as Record<string, unknown>)

  it("un proveedor sin foto fiscal (TusFacturas) escribe la UPDATE de siempre, sin columnas nuevas", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    vi.mocked(canEmitirFacturaElectronica).mockResolvedValue(true)
    vi.mocked(tusFacturasProvider.emitir).mockResolvedValue({
      ok: true, cae: "1", numero: "0003-1", tipo: "C", pdfUrl: "http://p", raw: {},
    } as any)
    const update = createChainMock({ id: "cmp-1", estado: "emitido" })
    mockSupabaseSequenced({
      comprobantes_fiscales: [createChainMock(null), createChainMock({ id: "cmp-1" }), update],
      ventas: [createChainMock(VENTA)],
      items_venta: [createChainMock(ITEMS)],
      facturacion_credenciales: [createChainMock(CREDENCIALES)],
    })

    const { status } = await parseResponse(await POST(createPostRequest({ ventaId: "venta-1" })))

    expect(status).toBe(200)
    const payloads = updatePayloads(update)
    expect(payloads).toHaveLength(1)
    for (const key of SNAPSHOT_KEYS) expect(Object.keys(payloads[0])).not.toContain(key)
  })

  /**
   * Anular una factura deja en la MISMA venta una nota de crédito fiscal
   * (cbte_tipo 8/13) además de la factura. Emitir decide "¿ya está emitida?"
   * mirando comprobantes de la venta: si cuenta la NC, una venta con factura
   * anulada + NC emitida respondería "ya emitida" con la NC y no se podría
   * refacturar; y con varias filas históricas un `maybeSingle` pelado falla.
   */
  describe("ignora las notas de crédito fiscales", () => {
    const FACTURA_VIGENTE = { id: "cmp-2", venta_id: "venta-1", estado: "emitido", cae: "222" }

    it("el atajo 'ya emitida' mira solo facturas de ESTA venta y organización", async () => {
      mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
      vi.mocked(canEmitirFacturaElectronica).mockResolvedValue(true)
      const existente = createChainMock(FACTURA_VIGENTE)
      mockSupabaseSequenced({ comprobantes_fiscales: [existente] })

      const { status, body } = await parseResponse(await POST(createPostRequest({ ventaId: "venta-1" })))

      expect(status).toBe(409)
      expect(body.yaEmitido).toBe(true)
      expect(body.comprobante).toEqual(FACTURA_VIGENTE)
      expect(existente.or).toHaveBeenCalledWith(FILTRO_SIN_NC)
      expect(existente.eq).toHaveBeenCalledWith("estado", "emitido")
      expect(existente.eq).toHaveBeenCalledWith("venta_id", "venta-1")
      expect(existente.eq).toHaveBeenCalledWith("organization_id", "org-1")
      expect(existente.select).toHaveBeenCalledWith(SAFE_COLUMNS)
    })

    it("con varias filas históricas pide UNA (la más nueva) en vez de reventar en maybeSingle", async () => {
      mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
      vi.mocked(canEmitirFacturaElectronica).mockResolvedValue(true)
      const existente = createChainMock(FACTURA_VIGENTE)
      mockSupabaseSequenced({ comprobantes_fiscales: [existente] })

      await POST(createPostRequest({ ventaId: "venta-1" }))

      expect(existente.order).toHaveBeenCalledWith("created_at", { ascending: false })
      expect(existente.limit).toHaveBeenCalledWith(1)
    })

    it("el atajo se omite SOLO si falta cbte_tipo (migración 370 sin aplicar): reintenta sin el filtro y sigue emitiendo", async () => {
      mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
      vi.mocked(canEmitirFacturaElectronica).mockResolvedValue(true)
      const conFiltro = createChainMock(null, { code: "42703", message: "column comprobantes_fiscales.cbte_tipo does not exist" })
      const sinFiltro = createChainMock(FACTURA_VIGENTE)
      mockSupabaseSequenced({ comprobantes_fiscales: [conFiltro, sinFiltro] })

      const { status, body } = await parseResponse(await POST(createPostRequest({ ventaId: "venta-1" })))

      expect(status).toBe(409)
      expect(body.comprobante).toEqual(FACTURA_VIGENTE)
      expect(sinFiltro.or).not.toHaveBeenCalled()
      expect(sinFiltro.eq).toHaveBeenCalledWith("estado", "emitido")
      expect(sinFiltro.eq).toHaveBeenCalledWith("organization_id", "org-1")
    })

    it("otro error de base de datos en el atajo no se reintenta: 500", async () => {
      mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
      vi.mocked(canEmitirFacturaElectronica).mockResolvedValue(true)
      const consulta = createChainMock(null, { code: "57014", message: "statement timeout" })
      const reintento = createChainMock(FACTURA_VIGENTE)
      mockSupabaseSequenced({ comprobantes_fiscales: [consulta, reintento] })

      const { status } = await parseResponse(await POST(createPostRequest({ ventaId: "venta-1" })))

      expect(status).toBe(500)
      expect(reintento.eq).not.toHaveBeenCalled()
    })

    it("al perder la carrera (23505) devuelve la factura activa, nunca una NC en vuelo", async () => {
      mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
      vi.mocked(canEmitirFacturaElectronica).mockResolvedValue(true)
      const activa = createChainMock({ id: "cmp-2", venta_id: "venta-1", estado: "pendiente", cae: null })
      mockSupabaseSequenced({
        comprobantes_fiscales: [
          createChainMock(null),
          createChainMock(null, { code: "23505", message: 'duplicate key value violates unique constraint "uq_comprobante_venta_activo"' }),
          activa,
        ],
        ventas: [createChainMock(VENTA)],
        items_venta: [createChainMock(ITEMS)],
        facturacion_credenciales: [createChainMock(CREDENCIALES)],
      })

      const { status, body } = await parseResponse(await POST(createPostRequest({ ventaId: "venta-1" })))

      expect(status).toBe(409)
      expect(body.comprobante.id).toBe("cmp-2")
      expect(activa.or).toHaveBeenCalledWith(FILTRO_SIN_NC)
      expect(activa.in).toHaveBeenCalledWith("estado", ["pendiente", "emitido"])
      expect(activa.eq).toHaveBeenCalledWith("organization_id", "org-1")
      expect(activa.order).toHaveBeenCalledWith("created_at", { ascending: false })
      expect(activa.limit).toHaveBeenCalledWith(1)
    })

    it("la consulta de devoluciones NO se toca: sigue siendo solo por venta, sin filtro de NC", async () => {
      mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
      vi.mocked(canEmitirFacturaElectronica).mockResolvedValue(true)
      const devoluciones = createChainMock(null, null, 1)
      mockSupabaseSequenced({
        comprobantes_fiscales: [createChainMock(null)],
        ventas: [createChainMock(VENTA)],
        devoluciones_venta: [devoluciones],
      })

      await POST(createPostRequest({ ventaId: "venta-1" }))

      expect(devoluciones.eq).toHaveBeenCalledWith("venta_id", "venta-1")
      expect(devoluciones.or).not.toHaveBeenCalled()
    })
  })
})
