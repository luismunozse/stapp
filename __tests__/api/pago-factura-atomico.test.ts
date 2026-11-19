/**
 * Tests: POST /api/pagos — pago registrado desde el remito de una orden.
 *
 * El pago es un cobro de la orden (registrar_cobros_orden_atomica), no un
 * pagos_parciales: la plata de una orden vive en un solo libro y la migración
 * 417 lleva lo cobrado al remito. Antes, una orden ya cobrada dejaba el remito
 * PENDIENTE y registrar el pago cargaba la misma plata dos veces en caja.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createPostRequest,
  parseResponse,
} from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

vi.mock("@/lib/onboarding/practica", () => ({
  rejectIfPractica: vi.fn().mockResolvedValue(null),
}))
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }))

import { POST } from "@/app/api/pagos/route"

function facturaRow(over: Partial<any> = {}) {
  return {
    id: "f1",
    orden_id: "o1",
    total: 1000,
    monto_abonado: 500,
    estado_pago: "PAGADO_PARCIAL",
    ordenes_servicio: { organization_id: "org-1" },
    ...over,
  }
}

const COBRO_RESPONSE = {
  cobros: [{ id: "c1", monto: 500, metodo: "EFECTIVO", cuotas: null }],
  orden: { totalCobrado: 500, estadoCobro: "PARCIAL", descuento: 0 },
}

const VALID_PAYLOAD = {
  facturaId: "f1",
  pagos: [{ monto: 500, metodo: "EFECTIVO" }],
  idempotencyKey: "test-idem-001",
}

function mockRpc(result: { data: unknown; error: unknown }) {
  vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
    if (fn === "registrar_cobros_orden_atomica") return Promise.resolve(result)
    return Promise.resolve({ data: null, error: null })
  }) as any)
}

describe("POST /api/pagos — el pago del remito es un cobro de la orden", () => {
  beforeEach(() => vi.clearAllMocks())

  it("registra un cobro de la orden y devuelve el estado del remito", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({ facturas: createChainMock(facturaRow()) })
    mockRpc({ data: { replayed: false, response: COBRO_RESPONSE }, error: null })

    const res = await POST(createPostRequest(VALID_PAYLOAD))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(201)
    expect(body.cobros).toHaveLength(1)
    expect(body.factura).toEqual({ montoAbonado: 500, estadoPago: "PAGADO_PARCIAL", pendiente: 500 })

    const llamadas = vi.mocked(supabaseAdmin.rpc).mock.calls
    const cobro = llamadas.find(([fn]) => fn === "registrar_cobros_orden_atomica")
    expect(cobro![1]).toMatchObject({
      p_org_id: "org-1",
      p_orden_id: "o1",
      p_descuento: 0,
      p_idempotency_key: "test-idem-001",
      p_pagos: [expect.objectContaining({ monto: 500, metodo: "EFECTIVO" })],
    })
    // Nunca el libro viejo: ni el RPC de pago de factura ni pagos_parciales.
    expect(llamadas.map(([fn]) => fn)).not.toContain("registrar_pago_factura_atomica")
    expect(vi.mocked(supabaseAdmin.from).mock.calls.map(([t]) => t)).not.toContain("pagos_parciales")
  })

  it("sin idempotencyKey → p_idempotency_key null", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({ facturas: createChainMock(facturaRow()) })
    mockRpc({ data: { replayed: false, response: COBRO_RESPONSE }, error: null })

    const res = await POST(createPostRequest({ facturaId: "f1", pagos: [{ monto: 100, metodo: "EFECTIVO" }] }))
    expect(res.status).toBe(201)
    const cobro = vi.mocked(supabaseAdmin.rpc).mock.calls.find(([fn]) => fn === "registrar_cobros_orden_atomica")
    expect((cobro![1] as any).p_idempotency_key).toBeNull()
  })

  it("acepta el formato viejo de un solo pago", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({ facturas: createChainMock(facturaRow()) })
    mockRpc({ data: { replayed: false, response: COBRO_RESPONSE }, error: null })

    const res = await POST(createPostRequest({ facturaId: "f1", monto: 300, metodoPago: "TRANSFERENCIA", numeroReferencia: "op-9" }))
    expect(res.status).toBe(201)
    const cobro = vi.mocked(supabaseAdmin.rpc).mock.calls.find(([fn]) => fn === "registrar_cobros_orden_atomica")
    expect((cobro![1] as any).p_pagos).toEqual([
      expect.objectContaining({ monto: 300, metodo: "TRANSFERENCIA", referencia: "op-9" }),
    ])
  })

  it("reintento con la misma clave → 200 sin volver a agendar cuotas", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({ facturas: createChainMock(facturaRow()) })
    mockRpc({
      data: { replayed: true, response: { ...COBRO_RESPONSE, cobros: [{ id: "c1", monto: 500, metodo: "TARJETA_CREDITO", cuotas: 3 }] } },
      error: null,
    })

    const res = await POST(createPostRequest({ ...VALID_PAYLOAD, idempotencyKey: "replay-key" }))
    expect(res.status).toBe(200)
    expect(vi.mocked(supabaseAdmin.from).mock.calls.map(([t]) => t)).not.toContain("cuotas_cobro")
  })

  it("cobro en cuotas → agenda el calendario de cuotas de la orden", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({
      facturas: createChainMock(facturaRow()),
      organizations: createChainMock({ zona_horaria: "America/Argentina/Buenos_Aires" }),
      cuotas_cobro: createChainMock(null),
    })
    mockRpc({
      data: { replayed: false, response: { ...COBRO_RESPONSE, cobros: [{ id: "c1", monto: 600, metodo: "TARJETA_CREDITO", cuotas: 3 }] } },
      error: null,
    })

    const res = await POST(createPostRequest({ facturaId: "f1", pagos: [{ monto: 600, metodo: "TARJETA_CREDITO", cuotas: 3 }] }))
    expect(res.status).toBe(201)
    expect(vi.mocked(supabaseAdmin.from).mock.calls.map(([t]) => t)).toContain("cuotas_cobro")
  })

  it("remito anulado → 400 sin cobrar", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({ facturas: createChainMock(facturaRow({ estado_pago: "ANULADA" })) })
    mockRpc({ data: null, error: null })

    const res = await POST(createPostRequest(VALID_PAYLOAD))
    expect(res.status).toBe(400)
    expect(vi.mocked(supabaseAdmin.rpc)).not.toHaveBeenCalled()
  })

  it("remito de otra organización → 403 sin cobrar", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({ facturas: createChainMock(facturaRow({ ordenes_servicio: { organization_id: "otra" } })) })
    mockRpc({ data: null, error: null })

    const res = await POST(createPostRequest(VALID_PAYLOAD))
    expect(res.status).toBe(403)
    expect(vi.mocked(supabaseAdmin.rpc)).not.toHaveBeenCalled()
  })

  it("solo ADMIN registra pagos", async () => {
    mockAuthSuccess({ role: "VENDEDOR" })
    const res = await POST(createPostRequest(VALID_PAYLOAD))
    expect(res.status).toBe(403)
  })

  it.each([
    ["El monto total (2000.00) excede el pendiente (500.00)", 400],
    ["Saldo insuficiente en cuenta corriente", 400],
    ["Orden no encontrada", 404],
    ["No autorizado", 403],
    ["algo raro", 500],
  ])("error del cobro '%s' → %i", async (message, esperado) => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({ facturas: createChainMock(facturaRow()) })
    mockRpc({ data: null, error: { code: "P0001", message } })

    const res = await POST(createPostRequest(VALID_PAYLOAD))
    expect(res.status).toBe(esperado)
  })
})
