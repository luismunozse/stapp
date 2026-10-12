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
      // Saldo a favor: la venta tiene que tener cliente
      if (table === "ventas") return createChainMock({ ...BASE_VENTA, cliente_id: "c1" }, null) as any
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

    // 1ª consulta: la búsqueda previa de la ruta no encuentra nada (el otro
    // pedido todavía no selló); 2ª: el insert de la barrera choca; 3ª: el
    // select lee la respuesta ya sellada.
    const idemLookupChain = createChainMock(null, null)
    const idemInsertChain = createChainMock(null, { code: "23505", message: "duplicate key value" })
    const idemSelectChain = createChainMock({ response: STORED_RESPONSE }, null)

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ventas") return createChainMock(BASE_VENTA, null) as any
      if (table === "pago_idempotency") {
        const callCount = vi.mocked(supabaseAdmin.from).mock.calls.filter(c => c[0] === "pago_idempotency").length
        return (callCount <= 1 ? idemLookupChain : callCount === 2 ? idemInsertChain : idemSelectChain) as any
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

  // ── Reintentos y cliente (mig 331) ───────────────────────────────────────

  it("un reintento de un cobro ya hecho devuelve la respuesta guardada aunque el pendiente haya bajado", async () => {
    mockAuthSuccess()
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      // El primer envío ya cobró los 1000: no queda pendiente
      if (table === "ventas") return createChainMock({ ...BASE_VENTA, monto_abonado: "1000" }, null) as any
      if (table === "pago_idempotency") return createChainMock({ response: STORED_RESPONSE }, null) as any
      return createChainMock(null, null) as any
    })

    const req = createPostRequest(
      { pagos: [{ monto: 1000, metodo: "EFECTIVO" }], idempotencyKey: "k-ya-cobrado" },
      "http://localhost:3000/api/ventas/v1/pagos"
    )
    const { status, body } = await parseResponse(await POST(req, createParams("v1")))

    expect(status).toBe(200)
    expect(body).toEqual(STORED_RESPONSE)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("el cobro va siempre a la cuenta del cliente de la venta (ignora clienteId del body)", async () => {
    mockAuthSuccess()
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ventas") return createChainMock({ ...BASE_VENTA, cliente_id: "c1" }, null) as any
      return createChainMock(null, null) as any
    })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValueOnce({
      data: { replayed: false, response: STORED_RESPONSE },
      error: null,
    } as any)

    const req = createPostRequest(
      { pagos: [{ monto: 500, metodo: "EFECTIVO" }], clienteId: "otro-cliente" },
      "http://localhost:3000/api/ventas/v1/pagos"
    )
    await POST(req, createParams("v1"))

    expect(vi.mocked(supabaseAdmin.rpc).mock.calls[0][1]).toMatchObject({ p_cliente_id: null })
  })

  it("saldo a favor en una venta sin cliente: 400 sin llamar al RPC", async () => {
    mockAuthSuccess()
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ventas") return createChainMock(BASE_VENTA, null) as any
      return createChainMock(null, null) as any
    })

    const req = createPostRequest(
      { pagos: [{ monto: 500, metodo: "CUENTA_CORRIENTE" }] },
      "http://localhost:3000/api/ventas/v1/pagos"
    )
    const { status, body } = await parseResponse(await POST(req, createParams("v1")))

    expect(status).toBe(400)
    expect(body.error).toMatch(/tiene que tener un cliente/)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("lo que cancelaron las devoluciones no se vuelve a cobrar", async () => {
    mockAuthSuccess()
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ventas") {
        return createChainMock(
          { ...BASE_VENTA, devoluciones_venta: [{ monto_devolucion: "600", monto_aplicado_deuda: "600" }] },
          null
        ) as any
      }
      return createChainMock(null, null) as any
    })

    const req = createPostRequest(
      { pagos: [{ monto: 1000, metodo: "EFECTIVO" }] },
      "http://localhost:3000/api/ventas/v1/pagos"
    )
    const { status, body } = await parseResponse(await POST(req, createParams("v1")))

    expect(status).toBe(400)
    expect(body.error).toMatch(/excede el pendiente \(400\.00\)/)
  })
})
