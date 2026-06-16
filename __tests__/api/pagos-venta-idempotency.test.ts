import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createPostRequest,
  parseResponse,
} from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

import { POST } from "@/app/api/ventas/[id]/pagos/route"

function createParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

const BASE_VENTA = {
  id: "v1",
  organization_id: "org-1",
  estado: "COMPLETADA",
  total: "1000",
  monto_abonado: "0",
  cliente_id: null,
}

const VALID_PAYLOAD = {
  pagos: [{ monto: 500, metodo: "EFECTIVO" }],
  idempotencyKey: "test-uuid-1234",
}

// Stored response that would be written after a successful first call
const STORED_RESPONSE = {
  pagos: [{ id: "pago-1", monto: 500, metodoPago: "EFECTIVO", referencia: null, fecha: "2024-01-01", cuotas: null, recargoPorcentaje: null, montoOriginal: null, costoFinancieroPorcentaje: null, costoFinancieroMonto: null }],
  venta: { montoAbonado: 500, estadoPago: "PAGADO_PARCIAL", pendiente: 500 },
}

describe("POST /api/ventas/[id]/pagos — idempotency barrier", () => {
  beforeEach(() => vi.clearAllMocks())

  it("processes normally and claims barrier row on first call", async () => {
    mockAuthSuccess()

    const ventaChain = createChainMock(BASE_VENTA, null)
    const idemInsertChain = createChainMock(null, null)  // insert succeeds (claimed)
    const pagoChain = createChainMock(
      { id: "pago-1", monto: 500, metodo_pago: "EFECTIVO", numero_referencia: null, fecha: "2024-01-01", cuotas: null, recargo_porcentaje: null, monto_original: null, costo_financiero_porcentaje: null, costo_financiero_monto: null, observaciones: null },
      null
    )
    const ventaUpdateChain = createChainMock(null, null)
    const idemUpdateChain = createChainMock(null, null)  // update response succeeds

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ventas") return ventaChain as any
      if (table === "pago_idempotency") {
        // First call is insert (claim), second call is update (store response)
        const callCount = vi.mocked(supabaseAdmin.from).mock.calls.filter(c => c[0] === "pago_idempotency").length
        return callCount <= 1 ? idemInsertChain as any : idemUpdateChain as any
      }
      if (table === "pagos_venta") return pagoChain as any
      return createChainMock(null, null) as any
    })

    const req = createPostRequest(VALID_PAYLOAD, "http://localhost:3000/api/ventas/v1/pagos")
    const res = await POST(req, createParams("v1"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(201)
    expect(body.pagos).toHaveLength(1)
    expect(body.venta.montoAbonado).toBe(500)
  })

  it("replays stored response on duplicate key (already processed)", async () => {
    mockAuthSuccess()

    const ventaChain = createChainMock(BASE_VENTA, null)
    // Insert fails with 23505 (duplicate PK)
    const idemInsertChain = createChainMock(null, { code: "23505", message: "duplicate key value" })
    // SELECT returns non-null stored response
    const idemSelectChain = createChainMock({ response: STORED_RESPONSE }, null)

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ventas") return ventaChain as any
      if (table === "pago_idempotency") {
        const callCount = vi.mocked(supabaseAdmin.from).mock.calls.filter(c => c[0] === "pago_idempotency").length
        // First call: insert (23505), second call: select to read stored response
        return callCount <= 1 ? idemInsertChain as any : idemSelectChain as any
      }
      // pagos_venta should NOT be called (replay path)
      return createChainMock(null, { message: "Should not be called" }) as any
    })

    const req = createPostRequest(VALID_PAYLOAD, "http://localhost:3000/api/ventas/v1/pagos")
    const res = await POST(req, createParams("v1"))
    const { status, body } = await parseResponse(res)

    // Replay must return 200 (not 201) with the original response body
    expect(status).toBe(200)
    expect(body.pagos).toHaveLength(1)
    expect(body.pagos[0].id).toBe("pago-1")
    // Verify pagos_venta was never inserted (replay, no re-processing)
    const pagosVentaCalls = vi.mocked(supabaseAdmin.from).mock.calls.filter(c => c[0] === "pagos_venta")
    expect(pagosVentaCalls).toHaveLength(0)
  })

  it("returns 409 when barrier row exists with null response (in-flight)", async () => {
    mockAuthSuccess()

    const ventaChain = createChainMock(BASE_VENTA, null)
    const idemInsertChain = createChainMock(null, { code: "23505", message: "duplicate key value" })
    // SELECT returns row with null response = in-flight
    const idemSelectChain = createChainMock({ response: null }, null)

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ventas") return ventaChain as any
      if (table === "pago_idempotency") {
        const callCount = vi.mocked(supabaseAdmin.from).mock.calls.filter(c => c[0] === "pago_idempotency").length
        return callCount <= 1 ? idemInsertChain as any : idemSelectChain as any
      }
      return createChainMock(null, null) as any
    })

    const req = createPostRequest(VALID_PAYLOAD, "http://localhost:3000/api/ventas/v1/pagos")
    const res = await POST(req, createParams("v1"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(409)
    expect(body.error).toMatch(/proceso/i)
  })

  it("skips barrier and processes normally when table does not exist (pre-migration)", async () => {
    mockAuthSuccess()

    const ventaChain = createChainMock(BASE_VENTA, null)
    // Insert fails with 42P01 (table does not exist)
    const idemInsertChain = createChainMock(null, { code: "42P01", message: "relation does not exist" })
    const pagoChain = createChainMock(
      { id: "pago-1", monto: 500, metodo_pago: "EFECTIVO", numero_referencia: null, fecha: "2024-01-01", cuotas: null, recargo_porcentaje: null, monto_original: null, costo_financiero_porcentaje: null, costo_financiero_monto: null, observaciones: null },
      null
    )

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ventas") return ventaChain as any
      if (table === "pago_idempotency") return idemInsertChain as any
      if (table === "pagos_venta") return pagoChain as any
      return createChainMock(null, null) as any
    })

    const req = createPostRequest(VALID_PAYLOAD, "http://localhost:3000/api/ventas/v1/pagos")
    const res = await POST(req, createParams("v1"))
    const { status, body } = await parseResponse(res)

    // Must succeed despite missing table — deploy-safe fallback
    expect(status).toBe(201)
    expect(body.pagos).toHaveLength(1)
  })

  it("works without idempotencyKey (no barrier attempt)", async () => {
    mockAuthSuccess()

    const ventaChain = createChainMock(BASE_VENTA, null)
    const pagoChain = createChainMock(
      { id: "pago-1", monto: 500, metodo_pago: "EFECTIVO", numero_referencia: null, fecha: "2024-01-01", cuotas: null, recargo_porcentaje: null, monto_original: null, costo_financiero_porcentaje: null, costo_financiero_monto: null, observaciones: null },
      null
    )

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ventas") return ventaChain as any
      if (table === "pagos_venta") return pagoChain as any
      return createChainMock(null, null) as any
    })

    const payload = { pagos: [{ monto: 500, metodo: "EFECTIVO" }] }
    const req = createPostRequest(payload, "http://localhost:3000/api/ventas/v1/pagos")
    const res = await POST(req, createParams("v1"))
    const { status } = await parseResponse(res)

    expect(status).toBe(201)
    // pago_idempotency was never touched
    const idemCalls = vi.mocked(supabaseAdmin.from).mock.calls.filter(c => c[0] === "pago_idempotency")
    expect(idemCalls).toHaveLength(0)
  })
})
