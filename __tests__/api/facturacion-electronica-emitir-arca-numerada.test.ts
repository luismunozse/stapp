// @vitest-environment node
/**
 * Tests: POST /api/facturacion-electronica/emitir con credenciales ARCA.
 *
 * La factura ARCA se emite con número explícito (último autorizado + 1), grabado
 * en la fila `pendiente` ANTES de enviar. Un envío incierto (timeout, red) queda
 * pendiente y se verifica con ARCA: nunca se marca rechazado, porque reintentar
 * emitiría una segunda factura con otro CAE.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { MENSAJE_ERROR_TECNICO } from "@/lib/facturacion/errores"
import { mockAuthSuccess, createChainMock, createPostRequest, parseResponse } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

vi.mock("@/lib/facturacion/access", () => ({ canEmitirFacturaElectronica: vi.fn().mockResolvedValue(true) }))
vi.mock("@/lib/facturacion/crypto", () => ({ decryptSecret: (s: string) => s }))
vi.mock("@/lib/facturacion/tusfacturas-provider", () => ({ tusFacturasProvider: { emitir: vi.fn() } }))
vi.mock("@/lib/facturacion/arca/stapp-cert", () => ({
  getCertificadoStapp: vi.fn().mockReturnValue({
    cuit: "23944498389",
    certPem: "CERT-PLATAFORMA",
    keyPem: "KEY-PLATAFORMA",
    notAfter: "2028-09-12T22:16:31.000Z",
    subject: "CN=stapp-prod",
  }),
  ArcaStappCertError: class ArcaStappCertError extends Error {},
}))
vi.mock("@/lib/facturacion/arca/arca-direct-provider", () => ({
  arcaDirectProvider: {
    emitir: vi.fn(),
    armarFactura: vi.fn(),
    ultimoAutorizado: vi.fn(),
    emitirFacturaNumerada: vi.fn(),
  },
}))
vi.mock("@/lib/facturacion/map-venta", () => ({ mapVentaToEmitirInput: vi.fn() }))

import { canEmitirFacturaElectronica } from "@/lib/facturacion/access"
import { tusFacturasProvider } from "@/lib/facturacion/tusfacturas-provider"
import { arcaDirectProvider } from "@/lib/facturacion/arca/arca-direct-provider"
import { mapVentaToEmitirInput } from "@/lib/facturacion/map-venta"
import { POST } from "@/app/api/facturacion-electronica/emitir/route"

/** Una cadena por llamada, en orden, por tabla. */
function mockSupabaseSequenced(sequence: Record<string, ReturnType<typeof createChainMock>[]>) {
  const counters: Record<string, number> = {}
  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    const chains = sequence[table]
    if (table === "devoluciones_venta" && !chains) return createChainMock(null, null, 0) as any
    if (!chains || chains.length === 0) return createChainMock(null, { message: `No mock for table: ${table}` }) as any
    const idx = counters[table] ?? 0
    counters[table] = idx + 1
    return (chains[idx] ?? chains[chains.length - 1]) as any
  })
}

const VENTA = { id: "venta-1", organization_id: "org-1", estado: "COMPLETADA", total: 100 }
const ITEMS = [{ id: "it-1", venta_id: "venta-1", descripcion: "Servicio", cantidad: 1, precio_unitario: 100 }]
const CREDENCIALES_ARCA = {
  organization_id: "org-1",
  provider: "arca",
  cuit: "23944498389",
  cert_pem_enc: "cert-enc",
  key_pem_enc: "key-enc",
  punto_venta: 3,
  condicion_fiscal: "MONOTRIBUTO",
}
const CREDENCIALES_DELEGADO = {
  organization_id: "org-1",
  provider: "arca_delegado",
  cuit: "30710955057",
  estado: "conectado",
  punto_venta: 2,
  condicion_fiscal: "RESPONSABLE_INSCRIPTO",
}
const INPUT = {
  ventaId: "venta-1",
  moneda: "PES",
  total: 100,
  receptor: { razonSocial: "Juan Perez", documentoTipo: "CONSUMIDOR FINAL", documentoNro: "0", condicionIva: "CF" },
  items: [{ cantidad: 1, descripcion: "Servicio", importeUnitario: 100, alicuotaIva: 21 }],
}
const VOUCHER = {
  CantReg: 1,
  PtoVta: 3,
  CbteTipo: 11,
  Concepto: 1,
  DocTipo: 99,
  DocNro: "0",
  CbteFch: "20261110",
  ImpTotal: 100,
  ImpTotConc: 0,
  ImpNeto: 100,
  ImpOpEx: 0,
  ImpIVA: 0,
  ImpTrib: 0,
  MonId: "PES",
  MonCotiz: 1,
  CondicionIVAReceptorId: 5,
}

const AUTORIZADA = { kind: "autorizada", numero: "00003-00000008", cae: "75123456789012", caeVencimiento: "20261120", raw: { ok: 1 } }

function arrancar(comprobantes: ReturnType<typeof createChainMock>[], credenciales: object = CREDENCIALES_ARCA) {
  mockSupabaseSequenced({
    comprobantes_fiscales: [createChainMock(null), ...comprobantes],
    ventas: [createChainMock(VENTA)],
    items_venta: [createChainMock(ITEMS)],
    facturacion_credenciales: [createChainMock(credenciales)],
  })
}

const llamar = async () => parseResponse(await POST(createPostRequest({ ventaId: "venta-1" })))

describe("POST /api/facturacion-electronica/emitir — ARCA con número explícito", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    vi.mocked(canEmitirFacturaElectronica).mockResolvedValue(true)
    vi.mocked(mapVentaToEmitirInput).mockReturnValue(INPUT as any)
    vi.mocked(arcaDirectProvider.armarFactura).mockReturnValue(VOUCHER as any)
    vi.mocked(arcaDirectProvider.ultimoAutorizado).mockResolvedValue(7)
    vi.mocked(arcaDirectProvider.emitirFacturaNumerada).mockResolvedValue(AUTORIZADA as any)
  })

  it("graba la pendiente con el número pedido y la foto fiscal ANTES de enviar, y envía ese número", async () => {
    const insert = createChainMock({ id: "cmp-1" })
    const update = createChainMock({ id: "cmp-1", estado: "emitido", cae: AUTORIZADA.cae })
    arrancar([insert, update])

    const { status, body } = await llamar()

    expect(status).toBe(200)
    expect(body.comprobante.estado).toBe("emitido")
    expect(insert.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        estado: "pendiente",
        provider: "arca",
        cbte_nro_solicitado: 8,
        cbte_tipo: 11,
        cuit_emisor: "23944498389",
        importe_total: 100,
        fecha_emision: "2026-11-10",
        detalle: INPUT.items,
      })
    )
    expect(arcaDirectProvider.ultimoAutorizado).toHaveBeenCalledWith(expect.anything(), 3, 11)
    expect(arcaDirectProvider.emitirFacturaNumerada).toHaveBeenCalledWith(
      expect.objectContaining({ cuit: "23944498389", certPem: "cert-enc", puntoVenta: 3 }),
      expect.objectContaining({ CbteDesde: 8, CbteHasta: 8, PtoVta: 3, CbteTipo: 11 })
    )
    // El insert va antes del envío.
    expect(vi.mocked(insert.insert).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(arcaDirectProvider.emitirFacturaNumerada).mock.invocationCallOrder[0]
    )
    expect(arcaDirectProvider.emitir).not.toHaveBeenCalled()
    expect(tusFacturasProvider.emitir).not.toHaveBeenCalled()
  })

  it("autorizada: pasa a emitido solo si sigue pendiente (UPDATE condicional)", async () => {
    const update = createChainMock({ id: "cmp-1", estado: "emitido" })
    arrancar([createChainMock({ id: "cmp-1" }), update])

    await llamar()

    expect(update.update).toHaveBeenCalledWith(
      expect.objectContaining({ estado: "emitido", numero: "00003-00000008", cae: AUTORIZADA.cae, cae_vencimiento: "20261120" })
    )
    expect(update.in).toHaveBeenCalledWith("estado", ["pendiente"])
    expect(update.eq).toHaveBeenCalledWith("organization_id", "org-1")
  })

  it("delegada: el CUIT emisor es el representado", async () => {
    const insert = createChainMock({ id: "cmp-1" })
    arrancar([insert, createChainMock({ id: "cmp-1", estado: "emitido" })], CREDENCIALES_DELEGADO)

    const { status } = await llamar()

    expect(status).toBe(200)
    expect(insert.insert).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "arca_delegado", cuit_emisor: "30710955057" })
    )
  })

  it("incierta: 502 con verificar, la fila SIGUE pendiente y nunca se marca rechazada ni se borra", async () => {
    vi.mocked(arcaDirectProvider.emitirFacturaNumerada).mockResolvedValue({ kind: "incierta", error: "timeout" } as any)
    const marca = createChainMock(null)
    arrancar([createChainMock({ id: "cmp-1" }), marca])

    const { status, body } = await llamar()

    expect(status).toBe(502)
    expect(body.verificar).toBe(true)
    expect(body.comprobante).toMatchObject({ id: "cmp-1", estado: "pendiente", cbte_nro_solicitado: 8 })
    const payload = vi.mocked(marca.update).mock.calls[0][0] as Record<string, unknown>
    expect(payload).not.toHaveProperty("estado")
    expect(payload.error_msg).toBe("timeout")
    expect(marca.eq).toHaveBeenCalledWith("estado", "pendiente")
    expect(marca.delete).not.toHaveBeenCalled()
  })

  it("si el proveedor lanza igual se trata como incierta", async () => {
    vi.mocked(arcaDirectProvider.emitirFacturaNumerada).mockRejectedValue(new Error("boom"))
    const marca = createChainMock(null)
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    arrancar([createChainMock({ id: "cmp-1" }), marca])

    const { status, body } = await llamar()

    expect(status).toBe(502)
    expect(body.verificar).toBe(true)
    expect(marca.delete).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it("rechazada: 422 y la fila pasa a rechazado (solo si sigue pendiente)", async () => {
    vi.mocked(arcaDirectProvider.emitirFacturaNumerada).mockResolvedValue({
      kind: "rechazada",
      errores: ["10016: número no correlativo"],
      raw: {},
    } as any)
    const update = createChainMock({ id: "cmp-1", estado: "rechazado", error_msg: "10016: número no correlativo" })
    arrancar([createChainMock({ id: "cmp-1" }), update])

    const { status, body } = await llamar()

    expect(status).toBe(422)
    expect(body.comprobante.estado).toBe("rechazado")
    expect(update.update).toHaveBeenCalledWith(expect.objectContaining({ estado: "rechazado", error_msg: "10016: número no correlativo" }))
    expect(update.eq).toHaveBeenCalledWith("estado", "pendiente")
  })

  it("si no se puede leer el último autorizado: 502 y no se escribe nada", async () => {
    vi.mocked(arcaDirectProvider.ultimoAutorizado).mockRejectedValue(new Error("ARCA caída"))
    const insert = createChainMock({ id: "cmp-1" })
    arrancar([insert])

    const { status, body } = await llamar()

    expect(status).toBe(502)
    expect(body.error).toBe(MENSAJE_ERROR_TECNICO)
    expect(insert.insert).not.toHaveBeenCalled()
    expect(arcaDirectProvider.emitirFacturaNumerada).not.toHaveBeenCalled()
  })

  it("otra factura en vuelo en el mismo punto de venta: 409 sin enviar", async () => {
    arrancar([
      createChainMock(null, {
        code: "23505",
        message: 'duplicate key value violates unique constraint "uq_comprobante_factura_en_vuelo"',
      }),
    ])

    const { status, body } = await llamar()

    expect(status).toBe(409)
    expect(body.conflicto).toBe("en_vuelo")
    expect(arcaDirectProvider.emitirFacturaNumerada).not.toHaveBeenCalled()
  })

  it("la venta ya tiene una factura activa: 409 con esa factura, sin enviar", async () => {
    const activa = { id: "cmp-0", estado: "pendiente" }
    arrancar([
      createChainMock(null, { code: "23505", message: 'violates unique constraint "uq_comprobante_venta_activo"' }),
      createChainMock(activa),
    ])

    const { status, body } = await llamar()

    expect(status).toBe(409)
    expect(body.yaEmitido).toBe(true)
    expect(body.comprobante).toEqual(activa)
    expect(arcaDirectProvider.emitirFacturaNumerada).not.toHaveBeenCalled()
  })

  it("sin la migración 389 (el CHECK rechaza el número pedido): 503 sin enviar", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    arrancar([createChainMock(null, { code: "23514", message: 'violates check constraint "comprobantes_fiscales_nc_check"' })])

    const { status } = await llamar()

    expect(status).toBe(503)
    expect(arcaDirectProvider.emitirFacturaNumerada).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it("autorizada pero falla el registro: 500 con el CAE y la fila NUNCA se borra", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const update = createChainMock(null, { message: "connection reset" })
    arrancar([createChainMock({ id: "cmp-1" }), update])

    const { status, body } = await llamar()

    expect(status).toBe(500)
    expect(body.cae).toBe(AUTORIZADA.cae)
    expect(body.comprobanteId).toBe("cmp-1")
    expect(update.delete).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })
})
