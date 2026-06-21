/**
 * Tests: Bug E — runJsFallback leaves poison idempotency rows
 *
 * When the RPC is missing and JS fallback is used:
 * - If claim succeeds but a mutation fails (CC error, pagos_venta insert error, etc.),
 *   the pago_idempotency row must be DELETED so retries can re-claim (not 409 forever).
 * - If the mutation succeeds, the row must be SEALED (UPDATE with response), NOT deleted.
 *
 * This test forces the function-missing path (42883) so the JS fallback runs,
 * then fails a mutation step and asserts the cleanup delete was called.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  createPostRequest,
  parseResponse,
} from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

import { POST } from "@/app/api/ventas/[id]/pagos/route"

function createParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

const FUNCTION_MISSING_ERROR = {
  code: "42883",
  message: "function registrar_pagos_venta_atomica does not exist",
}

const BASE_VENTA = {
  id: "v1",
  organization_id: "org-1",
  estado: "COMPLETADA",
  total: "1000",
  monto_abonado: "0",
  cliente_id: "c1",
}

const IDEMPOTENCY_KEY = "cleanup-test-key-001"

// ---------------------------------------------------------------------------
// Bug E — cleanup on mutation failure
// ---------------------------------------------------------------------------

describe("runJsFallback — poison row cleanup (bug E)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("claim succeeds + pagos_venta insert fails → pago_idempotency DELETE called", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    // RPC → function missing → triggers JS fallback
    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "registrar_pagos_venta_atomica") {
        return Promise.resolve({ data: null, error: FUNCTION_MISSING_ERROR })
      }
      return Promise.resolve({ data: null, error: null })
    }) as any)

    const deleteChain = createChainMock(null)
    const deleteSpy = vi.fn().mockReturnValue(deleteChain)

    // Track pago_idempotency calls to detect claim insert vs delete
    let idemCallCount = 0
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ventas") return createChainMock(BASE_VENTA) as any

      if (table === "pago_idempotency") {
        idemCallCount++
        // First call is the INSERT (claim) — succeeds
        const chain: any = {
          insert: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          delete: deleteSpy,
          then: (resolve: any) => Promise.resolve({ data: null, error: null }).then(resolve),
          catch: (reject: any) => Promise.resolve({ data: null, error: null }).catch(reject),
        }
        return chain as any
      }

      if (table === "pagos_venta") {
        // pagos_venta INSERT → fails → triggers the cleanup path
        const failChain: any = {
          insert: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { message: "DB constraint violation on pagos_venta" },
          }),
          then: (resolve: any) =>
            Promise.resolve({ data: null, error: { message: "DB constraint violation" } }).then(resolve),
          catch: (reject: any) => Promise.resolve({ data: null, error: null }).catch(reject),
        }
        return failChain as any
      }

      return createChainMock(null) as any
    })

    const req = createPostRequest(
      { pagos: [{ monto: 500, metodo: "EFECTIVO" }], idempotencyKey: IDEMPOTENCY_KEY },
      "http://localhost/api/ventas/v1/pagos"
    )
    const res = await POST(req, createParams("v1"))
    await parseResponse(res)

    // The delete spy must have been invoked (cleaning the poison row)
    expect(deleteSpy).toHaveBeenCalled()
  })

  it("claim succeeds + CC error → pago_idempotency DELETE called", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "registrar_pagos_venta_atomica") {
        return Promise.resolve({ data: null, error: FUNCTION_MISSING_ERROR })
      }
      // usar_cuenta_corriente fails
      if (fn === "usar_cuenta_corriente") {
        return Promise.resolve({
          data: null,
          error: { message: "Saldo insuficiente" },
        })
      }
      return Promise.resolve({ data: null, error: null })
    }) as any)

    const deleteChain = createChainMock(null)
    const deleteSpy = vi.fn().mockReturnValue(deleteChain)

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ventas") return createChainMock(BASE_VENTA) as any

      if (table === "pago_idempotency") {
        const chain: any = {
          insert: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          delete: deleteSpy,
          then: (resolve: any) => Promise.resolve({ data: null, error: null }).then(resolve),
          catch: (reject: any) => Promise.resolve({ data: null, error: null }).catch(reject),
        }
        return chain as any
      }

      return createChainMock(null) as any
    })

    const req = createPostRequest(
      { pagos: [{ monto: 500, metodo: "CUENTA_CORRIENTE" }], idempotencyKey: IDEMPOTENCY_KEY },
      "http://localhost/api/ventas/v1/pagos"
    )
    const res = await POST(req, createParams("v1"))
    await parseResponse(res)

    expect(deleteSpy).toHaveBeenCalled()
  })

  it("success path: pago_idempotency sealed (UPDATE called), NOT deleted", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    const pagoCreado = {
      id: "pago-1",
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
      if (fn === "registrar_pagos_venta_atomica") {
        return Promise.resolve({ data: null, error: FUNCTION_MISSING_ERROR })
      }
      return Promise.resolve({ data: null, error: null })
    }) as any)

    const deleteSpy = vi.fn()
    const updateSpy = vi.fn()

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ventas") return createChainMock(BASE_VENTA) as any

      if (table === "pago_idempotency") {
        const updateEqChain: any = {
          eq: vi.fn().mockReturnThis(),
          then: (resolve: any) => Promise.resolve({ data: null, error: null }).then(resolve),
          catch: (reject: any) => Promise.resolve({ data: null, error: null }).catch(reject),
        }
        const updateChain: any = {
          eq: vi.fn().mockImplementation(() => updateEqChain),
        }
        const chain: any = {
          insert: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          delete: deleteSpy,
          update: vi.fn().mockImplementation((payload: any) => {
            updateSpy(payload)
            return updateChain
          }),
          then: (resolve: any) => Promise.resolve({ data: null, error: null }).then(resolve),
          catch: (reject: any) => Promise.resolve({ data: null, error: null }).catch(reject),
        }
        return chain as any
      }

      if (table === "pagos_venta") {
        return createChainMock(pagoCreado) as any
      }

      // ventas UPDATE succeeds
      return createChainMock(null) as any
    })

    const req = createPostRequest(
      { pagos: [{ monto: 500, metodo: "EFECTIVO" }], idempotencyKey: IDEMPOTENCY_KEY },
      "http://localhost/api/ventas/v1/pagos"
    )
    const res = await POST(req, createParams("v1"))
    const { status } = await parseResponse(res)

    expect(status).toBe(201)
    // On success: seal UPDATE was called, delete was NOT called
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ response: expect.any(Object) }))
    expect(deleteSpy).not.toHaveBeenCalled()
  })
})
