/**
 * Tests: atomic RPC path for POST /api/pagos (factura payments)
 *
 * Guards:
 *   Bug D (CRITICAL): POST must be atomic — usar_cuenta_corriente + pagos_parciales insert
 *     + facturas update must all succeed or all fail. No partial-state window.
 *   D1: migration 243 adds registrar_pago_factura_atomica RPC.
 *   D2: route calls the RPC, returns 201 on fresh / 200 on replay,
 *       maps business errors, falls back to JS when function is missing.
 *   Fallback hardening: facturas update error must propagate (not silently ignored).
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

import { POST } from "@/app/api/pagos/route"

const FUNCTION_MISSING_ERROR = {
  code: "42883",
  message: "function registrar_pago_factura_atomica does not exist",
}

function facturaRow(over: Partial<any> = {}) {
  return {
    id: "f1",
    orden_id: "o1",
    total: 1000,
    monto_abonado: 0,
    estado_pago: "PENDIENTE",
    ordenes_servicio: {
      organization_id: "org-1",
      cliente_id: "c1",
      sucursal_id: "suc-1",
    },
    ...over,
  }
}

const STORED_RESPONSE = {
  pagos: [
    {
      id: "pp1",
      monto: 500,
      metodoPago: "EFECTIVO",
      referencia: null,
      fecha: "2024-01-01",
      cuotas: null,
      recargoPorcentaje: null,
      montoOriginal: null,
      costoFinancieroPorcentaje: null,
      costoFinancieroMonto: null,
    },
  ],
  factura: { montoAbonado: 500, estadoPago: "PAGADO_PARCIAL", pendiente: 500 },
}

const VALID_PAYLOAD = {
  facturaId: "f1",
  pagos: [{ monto: 500, metodo: "EFECTIVO" }],
  idempotencyKey: "test-idem-001",
}

// ---------------------------------------------------------------------------
// RPC happy path
// ---------------------------------------------------------------------------

describe("POST /api/pagos — atomic RPC path", () => {
  beforeEach(() => vi.clearAllMocks())

  it("happy path: calls registrar_pago_factura_atomica and returns 201", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    mockSupabaseFrom({
      facturas: createChainMock(facturaRow()),
    })

    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "registrar_pago_factura_atomica") {
        return Promise.resolve({
          data: { replayed: false, response: STORED_RESPONSE },
          error: null,
        })
      }
      return Promise.resolve({ data: null, error: null })
    }) as any)

    const res = await POST(createPostRequest(VALID_PAYLOAD))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(201)
    expect(body.pagos).toHaveLength(1)
    expect(body.factura.montoAbonado).toBe(500)

    const rpcCalls = vi.mocked(supabaseAdmin.rpc).mock.calls
    const atomicCall = rpcCalls.find(([fn]) => fn === "registrar_pago_factura_atomica")
    expect(atomicCall).toBeDefined()
    expect(atomicCall![1]).toMatchObject({
      p_org_id: "org-1",
      p_factura_id: "f1",
      p_idempotency_key: "test-idem-001",
    })
  })

  it("replayed: rpc returns replayed=true → 200 without re-running mutations", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    mockSupabaseFrom({
      facturas: createChainMock(facturaRow()),
    })

    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "registrar_pago_factura_atomica") {
        return Promise.resolve({
          data: { replayed: true, response: STORED_RESPONSE },
          error: null,
        })
      }
      return Promise.resolve({ data: null, error: null })
    }) as any)

    const res = await POST(createPostRequest({ ...VALID_PAYLOAD, idempotencyKey: "replay-key" }))
    const { status } = await parseResponse(res)

    expect(status).toBe(200)

    // pagos_parciales must NOT have been touched (replay)
    const fromCalls = vi.mocked(supabaseAdmin.from).mock.calls.map(([t]) => t)
    expect(fromCalls).not.toContain("pagos_parciales")
  })

  it("rpc business error 'excede el pendiente' → 400", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    mockSupabaseFrom({
      facturas: createChainMock(facturaRow()),
    })

    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "registrar_pago_factura_atomica") {
        return Promise.resolve({
          data: null,
          error: { code: "P0001", message: "El monto total (2000.00) excede el pendiente (1000.00)" },
        })
      }
      return Promise.resolve({ data: null, error: null })
    }) as any)

    const res = await POST(createPostRequest(VALID_PAYLOAD))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body.error).toMatch(/excede el pendiente/i)
  })

  it("rpc business error 'Factura no encontrada' → 404", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    mockSupabaseFrom({
      facturas: createChainMock(facturaRow()),
    })

    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "registrar_pago_factura_atomica") {
        return Promise.resolve({
          data: null,
          error: { code: "P0001", message: "Factura no encontrada" },
        })
      }
      return Promise.resolve({ data: null, error: null })
    }) as any)

    const res = await POST(createPostRequest(VALID_PAYLOAD))
    const { status } = await parseResponse(res)

    expect(status).toBe(404)
  })

  it("rpc business error 'No autorizado' → 403", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    mockSupabaseFrom({
      facturas: createChainMock(facturaRow()),
    })

    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "registrar_pago_factura_atomica") {
        return Promise.resolve({
          data: null,
          error: { code: "P0001", message: "No autorizado" },
        })
      }
      return Promise.resolve({ data: null, error: null })
    }) as any)

    const res = await POST(createPostRequest(VALID_PAYLOAD))
    const { status } = await parseResponse(res)

    expect(status).toBe(403)
  })

  it("rpc business error 'saldo insuficiente' → 400", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    mockSupabaseFrom({
      facturas: createChainMock(facturaRow()),
    })

    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "registrar_pago_factura_atomica") {
        return Promise.resolve({
          data: null,
          error: { code: "P0001", message: "Saldo insuficiente. Disponible: 100" },
        })
      }
      return Promise.resolve({ data: null, error: null })
    }) as any)

    const res = await POST(
      createPostRequest({
        ...VALID_PAYLOAD,
        pagos: [{ monto: 500, metodo: "CUENTA_CORRIENTE" }],
      })
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body.error).toMatch(/saldo insuficiente/i)
  })

  it("unexpected rpc error → 500", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    mockSupabaseFrom({
      facturas: createChainMock(facturaRow()),
    })

    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "registrar_pago_factura_atomica") {
        return Promise.resolve({
          data: null,
          error: { code: "XX000", message: "Internal error" },
        })
      }
      return Promise.resolve({ data: null, error: null })
    }) as any)

    const res = await POST(createPostRequest(VALID_PAYLOAD))
    const { status } = await parseResponse(res)

    expect(status).toBe(500)
  })
})

// ---------------------------------------------------------------------------
// JS fallback path (function missing → code 42883)
// ---------------------------------------------------------------------------

describe("POST /api/pagos — JS fallback (function missing)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("fallback happy path: returns 201", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    const pagoCreado = {
      id: "pp1",
      monto: 500,
      metodo_pago: "EFECTIVO",
      numero_referencia: null,
      fecha: "2024-01-01",
      cuotas: null,
      recargo_porcentaje: null,
      monto_original: null,
      costo_financiero_porcentaje: null,
      costo_financiero_monto: null,
    }

    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "registrar_pago_factura_atomica") {
        return Promise.resolve({ data: null, error: FUNCTION_MISSING_ERROR })
      }
      // usar_cuenta_corriente would go here if needed
      return Promise.resolve({ data: null, error: null })
    }) as any)

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "facturas") {
        return createChainMock(facturaRow()) as any
      }
      if (table === "pagos_parciales") {
        return createChainMock(pagoCreado) as any
      }
      return createChainMock(null) as any
    })

    const payload = {
      facturaId: "f1",
      pagos: [{ monto: 500, metodo: "EFECTIVO" }],
    }
    const res = await POST(createPostRequest(payload))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(201)
    expect(body.pagos).toHaveLength(1)
    expect(body.factura.montoAbonado).toBe(500)
  })

  it("fallback: CUENTA_CORRIENTE pago calls usar_cuenta_corriente with p_sucursal_id from the parent orden", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    const pagoCreado = {
      id: "pp1",
      monto: 500,
      metodo_pago: "CUENTA_CORRIENTE",
      numero_referencia: null,
      fecha: "2024-01-01",
      cuotas: null,
      recargo_porcentaje: null,
      monto_original: null,
      costo_financiero_porcentaje: null,
      costo_financiero_monto: null,
    }

    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "registrar_pago_factura_atomica") {
        return Promise.resolve({ data: null, error: FUNCTION_MISSING_ERROR })
      }
      return Promise.resolve({ data: null, error: null })
    }) as any)

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "facturas") {
        return createChainMock(facturaRow()) as any
      }
      if (table === "pagos_parciales") {
        return createChainMock(pagoCreado) as any
      }
      return createChainMock(null) as any
    })

    const payload = {
      facturaId: "f1",
      pagos: [{ monto: 500, metodo: "CUENTA_CORRIENTE" }],
      clienteId: "c1",
    }
    const res = await POST(createPostRequest(payload))
    const { status } = await parseResponse(res)

    expect(status).toBe(201)

    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "usar_cuenta_corriente",
      expect.objectContaining({
        p_cliente_id: "c1", p_monto: 500, p_referencia_tipo: "FACTURA", p_referencia_id: "f1",
        p_sucursal_id: "suc-1",
      })
    )
  })

  it("fallback: facturas UPDATE error → 500 (proves fallback checks update error)", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    const pagoCreado = {
      id: "pp1",
      monto: 500,
      metodo_pago: "EFECTIVO",
      numero_referencia: null,
      fecha: "2024-01-01",
      cuotas: null,
      recargo_porcentaje: null,
      monto_original: null,
      costo_financiero_porcentaje: null,
      costo_financiero_monto: null,
    }

    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "registrar_pago_factura_atomica") {
        return Promise.resolve({ data: null, error: FUNCTION_MISSING_ERROR })
      }
      return Promise.resolve({ data: null, error: null })
    }) as any)

    // Track how many times facturas is called: first for SELECT, second for UPDATE (which fails)
    let facturaCallCount = 0
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "facturas") {
        facturaCallCount++
        if (facturaCallCount === 1) {
          // Initial SELECT: return the factura
          return createChainMock(facturaRow()) as any
        }
        // Second call is the UPDATE — fail it
        const failChain = createChainMock(null, { message: "DB write error" })
        failChain.then = (resolve: any) =>
          Promise.resolve({ data: null, error: { message: "DB write error" } }).then(resolve)
        return failChain as any
      }
      if (table === "pagos_parciales") {
        return createChainMock(pagoCreado) as any
      }
      return createChainMock(null) as any
    })

    const payload = {
      facturaId: "f1",
      pagos: [{ monto: 500, metodo: "EFECTIVO" }],
    }
    const res = await POST(createPostRequest(payload))
    const { status } = await parseResponse(res)

    // With the fix, update error must propagate as 500
    expect(status).toBe(500)
  })
})
