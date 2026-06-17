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

const STORED_RESPONSE = {
  pagos: [{
    id: "pago-1", monto: 500, metodoPago: "EFECTIVO", referencia: null,
    fecha: "2024-01-01", cuotas: null, recargoPorcentaje: null,
    montoOriginal: null, costoFinancieroPorcentaje: null, costoFinancieroMonto: null,
  }],
  venta: { montoAbonado: 500, estadoPago: "PAGADO_PARCIAL", pendiente: 500 },
}

describe("POST /api/ventas/[id]/pagos — atomic RPC + idempotency", () => {
  beforeEach(() => vi.clearAllMocks())

  // ── RPC path ──────────────────────────────────────────────────────────────

  it("calls RPC and returns 201 on fresh request", async () => {
    mockAuthSuccess()

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ventas") return createChainMock(BASE_VENTA, null) as any
      return createChainMock(null, { message: `Unexpected table: ${table}` }) as any
    })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValueOnce({
      data: { replayed: false, response: STORED_RESPONSE },
      error: null,
    } as any)

    const req = createPostRequest(VALID_PAYLOAD, "http://localhost:3000/api/ventas/v1/pagos")
    const res = await POST(req, createParams("v1"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(201)
    expect(body.pagos).toHaveLength(1)
    expect(body.venta.montoAbonado).toBe(500)

    // RPC was called with the right function name
    expect(vi.mocked(supabaseAdmin.rpc)).toHaveBeenCalledWith(
      "registrar_pagos_venta_atomica",
      expect.objectContaining({ p_idempotency_key: "test-uuid-1234" })
    )
  })

  it("returns 200 on replayed request (RPC returns replayed: true)", async () => {
    mockAuthSuccess()

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ventas") return createChainMock(BASE_VENTA, null) as any
      return createChainMock(null, { message: `Unexpected table: ${table}` }) as any
    })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValueOnce({
      data: { replayed: true, response: STORED_RESPONSE },
      error: null,
    } as any)

    const req = createPostRequest(VALID_PAYLOAD, "http://localhost:3000/api/ventas/v1/pagos")
    const res = await POST(req, createParams("v1"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.pagos[0].id).toBe("pago-1")
    // No pagos_venta table access on replay
    const pagosVentaCalls = vi.mocked(supabaseAdmin.from).mock.calls.filter(c => c[0] === "pagos_venta")
    expect(pagosVentaCalls).toHaveLength(0)
  })

  it("maps Saldo insuficiente RPC error to 400", async () => {
    mockAuthSuccess()

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ventas") return createChainMock(BASE_VENTA, null) as any
      return createChainMock(null, null) as any
    })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "Saldo insuficiente. Disponible: 100" },
    } as any)

    const req = createPostRequest(
      { pagos: [{ monto: 500, metodo: "CUENTA_CORRIENTE" }], idempotencyKey: "key-1" },
      "http://localhost:3000/api/ventas/v1/pagos"
    )
    const res = await POST(req, createParams("v1"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body.error).toMatch(/saldo insuficiente/i)
  })

  it("maps venta anulada RPC error to 400", async () => {
    mockAuthSuccess()

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ventas") return createChainMock(BASE_VENTA, null) as any
      return createChainMock(null, null) as any
    })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "No se pueden registrar pagos en una venta anulada" },
    } as any)

    const req = createPostRequest(VALID_PAYLOAD, "http://localhost:3000/api/ventas/v1/pagos")
    const res = await POST(req, createParams("v1"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body.error).toMatch(/anulada/i)
  })

  it("works without idempotencyKey — RPC called without key", async () => {
    mockAuthSuccess()

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ventas") return createChainMock(BASE_VENTA, null) as any
      return createChainMock(null, null) as any
    })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValueOnce({
      data: { replayed: false, response: STORED_RESPONSE },
      error: null,
    } as any)

    const payload = { pagos: [{ monto: 500, metodo: "EFECTIVO" }] }
    const req = createPostRequest(payload, "http://localhost:3000/api/ventas/v1/pagos")
    const res = await POST(req, createParams("v1"))
    const { status } = await parseResponse(res)

    expect(status).toBe(201)
    const rpcArgs = vi.mocked(supabaseAdmin.rpc).mock.calls[0][1] as any
    expect(rpcArgs.p_idempotency_key).toBeNull()
  })

  // ── JS fallback path (migration 237 not yet applied) ─────────────────────

  it("falls back to JS path when RPC function does not exist (PGRST202)", async () => {
    mockAuthSuccess()

    const pagoCreado = {
      id: "pago-1", monto: 500, metodo_pago: "EFECTIVO", numero_referencia: null,
      fecha: "2024-01-01", cuotas: null, recargo_porcentaje: null, monto_original: null,
      costo_financiero_porcentaje: null, costo_financiero_monto: null,
    }

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ventas") return createChainMock(BASE_VENTA, null) as any
      if (table === "pago_idempotency") return createChainMock(null, null) as any  // insert succeeds
      if (table === "pagos_venta") return createChainMock(pagoCreado, null) as any
      return createChainMock(null, null) as any
    })

    // First rpc call = registrar_pagos_venta_atomica → function missing
    vi.mocked(supabaseAdmin.rpc)
      .mockResolvedValueOnce({
        data: null,
        error: { code: "PGRST202", message: "Could not find the function" },
      } as any)
      // subsequent rpc calls in JS fallback (pagar_fiado_cuenta_corriente) → success
      .mockResolvedValue({ data: {}, error: null } as any)

    const req = createPostRequest(VALID_PAYLOAD, "http://localhost:3000/api/ventas/v1/pagos")
    const res = await POST(req, createParams("v1"))
    const { status, body } = await parseResponse(res)

    // Fallback must succeed
    expect(status).toBe(201)
    expect(body.pagos).toHaveLength(1)
  })

  it("falls back to JS path when RPC function does not exist (42883)", async () => {
    mockAuthSuccess()

    const pagoCreado = {
      id: "pago-1", monto: 300, metodo_pago: "TRANSFERENCIA", numero_referencia: null,
      fecha: "2024-01-01", cuotas: null, recargo_porcentaje: null, monto_original: null,
      costo_financiero_porcentaje: null, costo_financiero_monto: null,
    }

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ventas") return createChainMock(BASE_VENTA, null) as any
      if (table === "pago_idempotency") return createChainMock(null, null) as any
      if (table === "pagos_venta") return createChainMock(pagoCreado, null) as any
      return createChainMock(null, null) as any
    })

    vi.mocked(supabaseAdmin.rpc)
      .mockResolvedValueOnce({
        data: null,
        error: { code: "42883", message: "function registrar_pagos_venta_atomica does not exist" },
      } as any)
      .mockResolvedValue({ data: {}, error: null } as any)

    const payload = { pagos: [{ monto: 300, metodo: "TRANSFERENCIA" }], idempotencyKey: "key-42883" }
    const req = createPostRequest(payload, "http://localhost:3000/api/ventas/v1/pagos")
    const res = await POST(req, createParams("v1"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(201)
    expect(body.pagos).toHaveLength(1)
  })

  it("JS fallback: replays on duplicate idempotency key (23505)", async () => {
    mockAuthSuccess()

    const idemInsertChain = createChainMock(null, { code: "23505", message: "duplicate key value" })
    const idemSelectChain = createChainMock({ response: STORED_RESPONSE }, null)

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ventas") return createChainMock(BASE_VENTA, null) as any
      if (table === "pago_idempotency") {
        const callCount = vi.mocked(supabaseAdmin.from).mock.calls.filter(c => c[0] === "pago_idempotency").length
        return callCount <= 1 ? idemInsertChain as any : idemSelectChain as any
      }
      return createChainMock(null, { message: "Should not be called" }) as any
    })

    // First rpc = registrar_pagos_venta_atomica → function missing → JS fallback
    vi.mocked(supabaseAdmin.rpc).mockResolvedValueOnce({
      data: null,
      error: { code: "PGRST202", message: "Could not find the function" },
    } as any)

    const req = createPostRequest(VALID_PAYLOAD, "http://localhost:3000/api/ventas/v1/pagos")
    const res = await POST(req, createParams("v1"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.pagos[0].id).toBe("pago-1")
    // pagos_venta never called (replay)
    const pagosVentaCalls = vi.mocked(supabaseAdmin.from).mock.calls.filter(c => c[0] === "pagos_venta")
    expect(pagosVentaCalls).toHaveLength(0)
  })
})
