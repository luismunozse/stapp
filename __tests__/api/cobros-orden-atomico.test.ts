/**
 * Tests: atomic RPC path for POST and DELETE /api/ordenes/[id]/cobros
 *
 * Guards:
 *   Bug A (CRITICAL): POST must check cobros_orden insert error — fixed by the RPC path.
 *     The fallback hardening test proves the silent-insert bug is gone.
 *   Bug B (HIGH): DELETE must call devolver_cuenta_corriente BEFORE committing the
 *     anulado update so a devolución failure rolls back the whole operation — fixed
 *     by the RPC path. The fallback hardening test proves bug B is fixed there too.
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

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  unstable_cache: vi.fn((fn: any) => fn),
}))

vi.mock("@/lib/audit", () => ({
  createAuditLogger: vi.fn(() => ({
    create: vi.fn().mockResolvedValue(undefined),
  })),
}))

import { POST, DELETE } from "@/app/api/ordenes/[id]/cobros/route"

function createParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ordenRow(over: Partial<any> = {}) {
  return {
    id: "o1",
    costo_final: "1000",
    total_cobrado: "0",
    estado_cobro: "PENDIENTE",
    descuento_cobro: "0",
    cliente_id: "c1",
    organization_id: "org-1",
    estado: "EN_REPARACION",
    ...over,
  }
}

const FUNCTION_MISSING_ERROR = { code: "42883", message: "function registrar_cobros_orden_atomica does not exist" }
const ANULAR_FUNCTION_MISSING_ERROR = { code: "42883", message: "function anular_cobro_orden_atomica does not exist" }

// RPC result for a successful cobros registration (one EFECTIVO payment)
function makeRpcResult(overrides: Partial<any> = {}) {
  return {
    replayed: false,
    response: {
      cobros: [{ id: "cob1", monto: 100, metodo: "EFECTIVO", cuotas: null }],
      orden: { totalCobrado: 100, estadoCobro: "COBRADO", descuento: 0 },
      ...overrides,
    },
  }
}

// ---------------------------------------------------------------------------
// POST — RPC happy path
// ---------------------------------------------------------------------------

describe("POST /api/ordenes/[id]/cobros — atomic RPC path", () => {
  beforeEach(() => vi.clearAllMocks())

  it("happy path: calls registrar_cobros_orden_atomica and returns 201", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({
      ordenes_servicio: createChainMock(ordenRow()),
    })

    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "registrar_cobros_orden_atomica") {
        return Promise.resolve({ data: makeRpcResult(), error: null })
      }
      return Promise.resolve({ data: null, error: null })
    }) as any)

    const idempotencyKey = "idem-key-001"
    const response = await POST(
      createPostRequest(
        { pagos: [{ monto: 100, metodo: "EFECTIVO" }], idempotencyKey },
        "http://localhost/api/ordenes/o1/cobros"
      ),
      createParams("o1")
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(201)
    expect(body.totalCobrado).toBe(100)
    expect(body.estadoCobro).toBe("COBRADO")

    const rpcCalls = vi.mocked(supabaseAdmin.rpc).mock.calls
    const atomicCall = rpcCalls.find(([fn]) => fn === "registrar_cobros_orden_atomica")
    expect(atomicCall).toBeDefined()
    expect(atomicCall![1]).toMatchObject({
      p_org_id: "org-1",
      p_orden_id: "o1",
      p_idempotency_key: idempotencyKey,
    })
  })

  it("replayed: rpc returns replayed=true → 201 without attempting cuotas insert", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({
      ordenes_servicio: createChainMock(ordenRow()),
    })

    const replayedResponse = {
      totalCobrado: 100,
      estadoCobro: "COBRADO",
      descuento: 0,
    }

    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "registrar_cobros_orden_atomica") {
        return Promise.resolve({
          data: { replayed: true, response: replayedResponse },
          error: null,
        })
      }
      return Promise.resolve({ data: null, error: null })
    }) as any)

    const response = await POST(
      createPostRequest(
        { pagos: [{ monto: 100, metodo: "TARJETA_CREDITO", cuotas: 6 }], idempotencyKey: "idem-replay-001" },
        "http://localhost/api/ordenes/o1/cobros"
      ),
      createParams("o1")
    )
    const { status } = await parseResponse(response)

    expect(status).toBe(201)

    // cuotas_cobro insert must NOT have been attempted
    const fromCalls = vi.mocked(supabaseAdmin.from).mock.calls.map(([t]) => t)
    expect(fromCalls).not.toContain("cuotas_cobro")
  })

  it("rpc non-missing error → 400 with message", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({
      ordenes_servicio: createChainMock(ordenRow()),
    })

    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "registrar_cobros_orden_atomica") {
        return Promise.resolve({
          data: null,
          error: { code: "P0001", message: "El monto total (200.00) excede el pendiente (100.00)" },
        })
      }
      return Promise.resolve({ data: null, error: null })
    }) as any)

    const response = await POST(
      createPostRequest(
        { pagos: [{ monto: 200, metodo: "EFECTIVO" }] },
        "http://localhost/api/ordenes/o1/cobros"
      ),
      createParams("o1")
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(400)
    expect(body.error).toContain("excede")
  })

  // Bug A regression: fallback must NOT silently swallow cobros_orden insert errors
  it("function-missing fallback: cobros_orden insert error → 500 (bug A fixed)", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    // rpc calls: first is registrar_cobros_orden_atomica (missing), rest succeed
    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "registrar_cobros_orden_atomica") {
        return Promise.resolve({ data: null, error: FUNCTION_MISSING_ERROR })
      }
      // usar_cuenta_corriente, recalcular_estado_cobro, etc. succeed
      return Promise.resolve({ data: null, error: null })
    }) as any)

    // ordenes_servicio: first call returns the orden (for validation), second returns updated state
    let ordenCallCount = 0
    const cobrosInsertChain = createChainMock(null, { message: "DB constraint violation" })
    cobrosInsertChain.then = (resolve: any) =>
      Promise.resolve({ data: null, error: { message: "DB constraint violation" } }).then(resolve)

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ordenes_servicio") {
        ordenCallCount++
        return createChainMock(ordenRow()) as any
      }
      if (table === "cobros_orden") {
        return cobrosInsertChain as any
      }
      return createChainMock(null) as any
    })

    const response = await POST(
      createPostRequest(
        { pagos: [{ monto: 100, metodo: "EFECTIVO" }] },
        "http://localhost/api/ordenes/o1/cobros"
      ),
      createParams("o1")
    )
    const { status } = await parseResponse(response)

    // With the fix, insert error must propagate as 500 (not silently ignored as 201)
    expect(status).toBe(500)
  })

  it("function-missing fallback success: returns 201", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "registrar_cobros_orden_atomica") {
        return Promise.resolve({ data: null, error: FUNCTION_MISSING_ERROR })
      }
      return Promise.resolve({ data: null, error: null })
    }) as any)

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ordenes_servicio") {
        // Return orden for validation, and updated order for final fetch
        return createChainMock(ordenRow({ total_cobrado: "100", estado_cobro: "COBRADO" })) as any
      }
      if (table === "cobros_orden") {
        const chain = createChainMock({ id: "cob1" })
        chain.then = (resolve: any) => Promise.resolve({ data: { id: "cob1" }, error: null }).then(resolve)
        return chain as any
      }
      return createChainMock(null) as any
    })

    const response = await POST(
      createPostRequest(
        { pagos: [{ monto: 100, metodo: "EFECTIVO" }] },
        "http://localhost/api/ordenes/o1/cobros"
      ),
      createParams("o1")
    )
    const { status } = await parseResponse(response)

    expect(status).toBe(201)
  })
})

// ---------------------------------------------------------------------------
// DELETE — RPC happy path
// ---------------------------------------------------------------------------

describe("DELETE /api/ordenes/[id]/cobros — atomic RPC path", () => {
  beforeEach(() => vi.clearAllMocks())

  it("happy path: calls anular_cobro_orden_atomica and returns 200", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    // DELETE still needs the pre-checks (orden guard + cobro fetch)
    mockSupabaseFrom({
      ordenes_servicio: createChainMock({ estado: "REPARADO", cliente_id: "c1" }),
      cobros_orden: createChainMock({ id: "cob1", monto: "100", anulado: false, metodo_pago: "EFECTIVO" }),
    })

    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "anular_cobro_orden_atomica") {
        return Promise.resolve({ data: { success: true }, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    }) as any)

    const response = await DELETE(
      new Request("http://localhost/api/ordenes/o1/cobros?cobroId=cob1", { method: "DELETE" }),
      createParams("o1")
    )
    const { status } = await parseResponse(response)

    expect(status).toBe(200)

    const rpcCalls = vi.mocked(supabaseAdmin.rpc).mock.calls
    const anularCall = rpcCalls.find(([fn]) => fn === "anular_cobro_orden_atomica")
    expect(anularCall).toBeDefined()
    expect(anularCall![1]).toMatchObject({
      p_org_id: "org-1",
      p_orden_id: "o1",
      p_cobro_id: "cob1",
    })
  })

  it("rpc error 'Cobro no encontrado' → 404", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    mockSupabaseFrom({
      ordenes_servicio: createChainMock({ estado: "REPARADO", cliente_id: "c1" }),
      cobros_orden: createChainMock({ id: "cob1", monto: "100", anulado: false, metodo_pago: "EFECTIVO" }),
    })

    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "anular_cobro_orden_atomica") {
        return Promise.resolve({
          data: null,
          error: { code: "P0001", message: "Cobro no encontrado" },
        })
      }
      return Promise.resolve({ data: null, error: null })
    }) as any)

    const response = await DELETE(
      new Request("http://localhost/api/ordenes/o1/cobros?cobroId=cob1", { method: "DELETE" }),
      createParams("o1")
    )
    const { status } = await parseResponse(response)

    expect(status).toBe(404)
  })

  it("rpc error 'ya fue anulado' → 400", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    mockSupabaseFrom({
      ordenes_servicio: createChainMock({ estado: "REPARADO", cliente_id: "c1" }),
      cobros_orden: createChainMock({ id: "cob1", monto: "100", anulado: false, metodo_pago: "EFECTIVO" }),
    })

    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "anular_cobro_orden_atomica") {
        return Promise.resolve({
          data: null,
          error: { code: "P0001", message: "El cobro ya fue anulado" },
        })
      }
      return Promise.resolve({ data: null, error: null })
    }) as any)

    const response = await DELETE(
      new Request("http://localhost/api/ordenes/o1/cobros?cobroId=cob1", { method: "DELETE" }),
      createParams("o1")
    )
    const { status } = await parseResponse(response)

    expect(status).toBe(400)
  })

  // Bug B regression: in the fallback, devolver_cuenta_corriente error must block anulado update
  it("function-missing fallback: devolver_cuenta_corriente error → 500 WITHOUT marking anulado (bug B fixed)", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    // cobro is CUENTA_CORRIENTE → triggers devolver path
    const cobrosUpdateChain = createChainMock(null)
    cobrosUpdateChain.then = (resolve: any) => Promise.resolve({ data: null, error: null }).then(resolve)

    mockSupabaseFrom({
      ordenes_servicio: createChainMock({ estado: "REPARADO", cliente_id: "c1" }),
      cobros_orden: createChainMock({ id: "cob1", monto: "100", anulado: false, metodo_pago: "CUENTA_CORRIENTE" }),
    })

    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "anular_cobro_orden_atomica") {
        return Promise.resolve({ data: null, error: ANULAR_FUNCTION_MISSING_ERROR })
      }
      if (fn === "devolver_cuenta_corriente") {
        return Promise.resolve({ data: null, error: { message: "Saldo insuficiente para revertir" } })
      }
      return Promise.resolve({ data: null, error: null })
    }) as any)

    const response = await DELETE(
      new Request("http://localhost/api/ordenes/o1/cobros?cobroId=cob1", { method: "DELETE" }),
      createParams("o1")
    )
    const { status } = await parseResponse(response)

    // Must be 500 (devolver failed) — the anulado update must NOT have been committed
    expect(status).toBe(500)

    // Verify: cobros_orden update (anulado=true) must NOT have been called
    const fromCalls = vi.mocked(supabaseAdmin.from).mock.calls.map(([t]) => t)
    // If "cobros_orden" appears only once (the SELECT), the UPDATE never ran
    const cobrosCallCount = fromCalls.filter((t) => t === "cobros_orden").length
    expect(cobrosCallCount).toBe(1) // only the initial SELECT/check
  })
})
