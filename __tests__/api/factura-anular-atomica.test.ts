/**
 * Tests: anular_factura_atomica (PUT) and eliminar_factura_atomica (DELETE)
 * for PUT /api/facturacion/[id] and DELETE /api/facturacion/[id].
 *
 * Bugs fixed:
 *   F1: registrar_pago_factura_atomica must reject ANULADA facturas +
 *       runJsFallback must guard ANULADA + overpayment.
 *   F2: PUT /api/facturacion/[id] must call anular_factura_atomica RPC
 *       for estadoPago='ANULADA'; reject manual estado changes for other values.
 *   F3: DELETE /api/facturacion/[id] must call eliminar_factura_atomica RPC
 *       (atomic: re-credit CC, then delete).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  parseResponse,
} from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

// We import the route under test
import { PUT, DELETE } from "@/app/api/facturacion/[id]/route"
// Also need POST (pagos) for F1 fallback guards
import { POST as pagosPost } from "@/app/api/pagos/route"

// ─── helpers ───────────────────────────────────────────────────────────────

function createPutRequest(body: any): Request {
  return new Request("http://localhost/api/facturacion/f1", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

function createDeleteRequest(): Request {
  return new Request("http://localhost/api/facturacion/f1", { method: "DELETE" })
}

function createPagosRequest(body: any): Request {
  return new Request("http://localhost/api/pagos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

/** Minimal factura row joined with ordenes_servicio */
function facturaWithOrden(over: Partial<any> = {}) {
  return {
    id: "f1",
    orden_id: "o1",
    numero_factura: 42,
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

/** Minimal factura + joined fields for GET-after-update response */
function facturaFullRow(over: Partial<any> = {}) {
  return {
    id: "f1",
    orden_id: "o1",
    numero_factura: 42,
    fecha: "2024-01-01",
    subtotal: 1000,
    iva: 0,
    total: 1000,
    monto_abonado: 0,
    estado_pago: "ANULADA",
    created_at: "2024-01-01T00:00:00Z",
    ordenes_servicio: {
      id: "o1",
      numero_orden: 1,
      dispositivo: "iPhone",
      organization_id: "org-1",
      clientes: { id: "c1", nombre: "Test" },
    },
    pagos_parciales: [],
    ...over,
  }
}

const FUNCTION_MISSING_ERROR = {
  code: "42883",
  message: "function registrar_pago_factura_atomica does not exist",
}

const ANULAR_FUNCTION_MISSING_ERROR = {
  code: "42883",
  message: "function anular_factura_atomica does not exist",
}

const ELIMINAR_FUNCTION_MISSING_ERROR = {
  code: "42883",
  message: "function eliminar_factura_atomica does not exist",
}

// params shape expected by Next.js dynamic route handlers
const params = { params: Promise.resolve({ id: "f1" }) } as any

// ═══════════════════════════════════════════════════════════════════════════
// F2 — PUT /api/facturacion/[id]
// ═══════════════════════════════════════════════════════════════════════════

describe("PUT /api/facturacion/[id] — estadoPago=ANULADA", () => {
  beforeEach(() => vi.clearAllMocks())

  it("calls anular_factura_atomica rpc with correct p_factura_id", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    // The route now fetches the factura to re-return after anulacion
    mockSupabaseFrom({
      facturas: createChainMock(facturaFullRow()),
    })

    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "anular_factura_atomica") {
        return Promise.resolve({ data: { ok: true }, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    }) as any)

    const res = await PUT(createPutRequest({ estadoPago: "ANULADA" }), params)
    const { status } = await parseResponse(res)

    expect(status).toBe(200)

    const rpcCalls = vi.mocked(supabaseAdmin.rpc).mock.calls
    const anularCall = rpcCalls.find(([fn]) => fn === "anular_factura_atomica")
    expect(anularCall).toBeDefined()
    expect(anularCall![1]).toMatchObject({ p_factura_id: "f1" })
  })

  it("rpc 'ya esta anulado' → 400", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    mockSupabaseFrom({
      facturas: createChainMock(facturaFullRow()),
    })

    // Migration 295: anular_factura_atomica now raises "El remito ya esta
    // anulado" (masculine, remito wording) instead of "La factura ya esta
    // anulada". eliminar_factura_atomica is untouched and keeps the old wording.
    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "anular_factura_atomica") {
        return Promise.resolve({
          data: null,
          error: { code: "P0001", message: "El remito ya esta anulado" },
        })
      }
      return Promise.resolve({ data: null, error: null })
    }) as any)

    const res = await PUT(createPutRequest({ estadoPago: "ANULADA" }), params)
    const { status } = await parseResponse(res)

    expect(status).toBe(400)
  })

  it("rpc 'no encontrado' → 404", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    mockSupabaseFrom({
      facturas: createChainMock(facturaFullRow()),
    })

    // Migration 295: anular_factura_atomica now raises "Remito no encontrado"
    // (masculine, remito wording) instead of "Factura no encontrada".
    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "anular_factura_atomica") {
        return Promise.resolve({
          data: null,
          error: { code: "P0001", message: "Remito no encontrado" },
        })
      }
      return Promise.resolve({ data: null, error: null })
    }) as any)

    const res = await PUT(createPutRequest({ estadoPago: "ANULADA" }), params)
    const { status } = await parseResponse(res)

    expect(status).toBe(404)
  })

  it("rpc 'No autorizado' → 403", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    mockSupabaseFrom({
      facturas: createChainMock(facturaFullRow()),
    })

    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "anular_factura_atomica") {
        return Promise.resolve({
          data: null,
          error: { code: "P0001", message: "No autorizado" },
        })
      }
      return Promise.resolve({ data: null, error: null })
    }) as any)

    const res = await PUT(createPutRequest({ estadoPago: "ANULADA" }), params)
    const { status } = await parseResponse(res)

    expect(status).toBe(403)
  })
})

describe("PUT /api/facturacion/[id] — non-ANULADA estadoPago rejected", () => {
  beforeEach(() => vi.clearAllMocks())

  it("estadoPago=PAGADO → 400 (cannot manually set)", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    const res = await PUT(createPutRequest({ estadoPago: "PAGADO" }), params)
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body.error).toMatch(/estado.*pago.*deriva|solo puede anularse/i)
  })

  it("estadoPago=PENDIENTE → 400", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    const res = await PUT(createPutRequest({ estadoPago: "PENDIENTE" }), params)
    const { status } = await parseResponse(res)

    expect(status).toBe(400)
  })

  it("estadoPago=PAGADO_PARCIAL → 400", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    const res = await PUT(createPutRequest({ estadoPago: "PAGADO_PARCIAL" }), params)
    const { status } = await parseResponse(res)

    expect(status).toBe(400)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// F2 — JS fallback for anular (when function missing)
// ═══════════════════════════════════════════════════════════════════════════

describe("PUT /api/facturacion/[id] — JS fallback (anular_factura_atomica missing)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("fallback: re-credits CC for each CUENTA_CORRIENTE pago and sets ANULADA", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "anular_factura_atomica") {
        return Promise.resolve({ data: null, error: ANULAR_FUNCTION_MISSING_ERROR })
      }
      // devolver_cuenta_corriente succeeds
      return Promise.resolve({ data: { ok: true }, error: null })
    }) as any)

    // factura with 2 pagos_parciales (one CC, one EFECTIVO)
    const pagos = [
      { id: "pp1", monto: 400, metodo_pago: "CUENTA_CORRIENTE" },
      { id: "pp2", monto: 200, metodo_pago: "EFECTIVO" },
    ]
    const facturaWithPagos = {
      ...facturaWithOrden({ estado_pago: "PAGADO_PARCIAL", monto_abonado: 600 }),
      numero_factura: 42,
      pagos_parciales: pagos,
    }

    // The fallback loads factura+pagos_parciales, does CC devolver, updates estado_pago,
    // then fetchAndReturnFactura re-reads the factura to return the standard shape.
    // That's 3 facturas calls: (1) load+pagos, (2) update, (3) re-fetch.
    let fromCallCount = 0
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "facturas") {
        fromCallCount++
        if (fromCallCount === 1) {
          // First SELECT: load factura+orden+pagos_parciales for fallback
          return {
            ...createChainMock(facturaWithPagos),
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: facturaWithPagos, error: null }),
          } as any
        }
        if (fromCallCount === 2) {
          // UPDATE (set ANULADA) — succeed
          return createChainMock(null) as any
        }
        // Third call: fetchAndReturnFactura re-reads the updated row
        const anulatedRow = {
          ...facturaWithPagos,
          estado_pago: "ANULADA",
          ordenes_servicio: {
            id: "o1",
            numero_orden: 1,
            dispositivo: "iPhone",
            clientes: { id: "c1", nombre: "Test" },
          },
          pagos_parciales: pagos,
        }
        return {
          ...createChainMock(anulatedRow),
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: anulatedRow, error: null }),
        } as any
      }
      return createChainMock(null) as any
    })

    const res = await PUT(createPutRequest({ estadoPago: "ANULADA" }), params)
    const { status } = await parseResponse(res)

    expect(status).toBe(200)

    // Should have called devolver_cuenta_corriente once (only for CC pago)
    const rpcCalls = vi.mocked(supabaseAdmin.rpc).mock.calls
    const devolverCalls = rpcCalls.filter(([fn]) => fn === "devolver_cuenta_corriente")
    expect(devolverCalls).toHaveLength(1)
    expect(devolverCalls[0][1]).toMatchObject({
      p_cliente_id: "c1",
      p_monto: 400,
      p_sucursal_id: "suc-1",
    })
  })

  it("fallback: already ANULADA → 400", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "anular_factura_atomica") {
        return Promise.resolve({ data: null, error: ANULAR_FUNCTION_MISSING_ERROR })
      }
      return Promise.resolve({ data: null, error: null })
    }) as any)

    const alreadyAnulada = {
      ...facturaWithOrden({ estado_pago: "ANULADA" }),
      numero_factura: 42,
      ordenes_servicio: { id: "o1", numero_orden: 1, dispositivo: "X", organization_id: "org-1", cliente_id: "c1", clientes: null },
    }

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "facturas") {
        return {
          ...createChainMock(alreadyAnulada),
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: alreadyAnulada, error: null }),
        } as any
      }
      if (table === "pagos_parciales") {
        return createChainMock([]) as any
      }
      return createChainMock(null) as any
    })

    const res = await PUT(createPutRequest({ estadoPago: "ANULADA" }), params)
    const { status } = await parseResponse(res)

    expect(status).toBe(400)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// F3 — DELETE /api/facturacion/[id]
// ═══════════════════════════════════════════════════════════════════════════

describe("DELETE /api/facturacion/[id] — calls eliminar_factura_atomica", () => {
  beforeEach(() => vi.clearAllMocks())

  it("happy path: calls eliminar_factura_atomica rpc", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    // The route still does a pre-check SELECT before calling the RPC
    mockSupabaseFrom({
      facturas: createChainMock(facturaWithOrden()),
    })

    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "eliminar_factura_atomica") {
        return Promise.resolve({ data: { ok: true }, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    }) as any)

    const res = await DELETE(createDeleteRequest(), params)
    const { status } = await parseResponse(res)

    expect(status).toBe(200)

    const rpcCalls = vi.mocked(supabaseAdmin.rpc).mock.calls
    const eliminarCall = rpcCalls.find(([fn]) => fn === "eliminar_factura_atomica")
    expect(eliminarCall).toBeDefined()
    expect(eliminarCall![1]).toMatchObject({ p_factura_id: "f1" })
  })

  it("rpc 'no encontrada' → 404", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    mockSupabaseFrom({
      facturas: createChainMock(facturaWithOrden()),
    })

    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "eliminar_factura_atomica") {
        return Promise.resolve({
          data: null,
          error: { code: "P0001", message: "Factura no encontrada" },
        })
      }
      return Promise.resolve({ data: null, error: null })
    }) as any)

    const res = await DELETE(createDeleteRequest(), params)
    const { status } = await parseResponse(res)

    expect(status).toBe(404)
  })

  it("rpc 'No autorizado' → 403", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    mockSupabaseFrom({
      facturas: createChainMock(facturaWithOrden()),
    })

    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "eliminar_factura_atomica") {
        return Promise.resolve({
          data: null,
          error: { code: "P0001", message: "No autorizado" },
        })
      }
      return Promise.resolve({ data: null, error: null })
    }) as any)

    const res = await DELETE(createDeleteRequest(), params)
    const { status } = await parseResponse(res)

    expect(status).toBe(403)
  })

  it("JS fallback (eliminar_factura_atomica missing): re-credits CC with sucursal_id from the parent orden", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "eliminar_factura_atomica") {
        return Promise.resolve({ data: null, error: ELIMINAR_FUNCTION_MISSING_ERROR })
      }
      // devolver_cuenta_corriente succeeds
      return Promise.resolve({ data: { ok: true }, error: null })
    }) as any)

    const pagos = [{ monto: 400, metodo_pago: "CUENTA_CORRIENTE" }]

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "facturas") {
        return createChainMock(facturaWithOrden({ numero_factura: 42 })) as any
      }
      if (table === "pagos_parciales") {
        return createChainMock(pagos) as any
      }
      return createChainMock(null) as any
    })

    const res = await DELETE(createDeleteRequest(), params)
    const { status } = await parseResponse(res)

    expect(status).toBe(200)

    const rpcCalls = vi.mocked(supabaseAdmin.rpc).mock.calls
    const devolverCalls = rpcCalls.filter(([fn]) => fn === "devolver_cuenta_corriente")
    expect(devolverCalls).toHaveLength(1)
    expect(devolverCalls[0][1]).toMatchObject({
      p_cliente_id: "c1",
      p_monto: 400,
      p_sucursal_id: "suc-1",
    })
  })

  it("JS fallback: propaga sucursal_id NULL cuando la orden no tiene sucursal asignada", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "eliminar_factura_atomica") {
        return Promise.resolve({ data: null, error: ELIMINAR_FUNCTION_MISSING_ERROR })
      }
      return Promise.resolve({ data: { ok: true }, error: null })
    }) as any)

    const pagos = [{ monto: 400, metodo_pago: "CUENTA_CORRIENTE" }]

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "facturas") {
        return createChainMock(
          facturaWithOrden({
            numero_factura: 42,
            ordenes_servicio: { organization_id: "org-1", cliente_id: "c1", sucursal_id: null },
          })
        ) as any
      }
      if (table === "pagos_parciales") {
        return createChainMock(pagos) as any
      }
      return createChainMock(null) as any
    })

    const res = await DELETE(createDeleteRequest(), params)
    const { status } = await parseResponse(res)

    expect(status).toBe(200)

    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "devolver_cuenta_corriente",
      expect.objectContaining({ p_sucursal_id: null })
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// F1 — POST /api/pagos runJsFallback guards
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /api/pagos — runJsFallback guards (function missing forces fallback)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("fallback: factura ANULADA → 400", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    // Force fallback path
    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "registrar_pago_factura_atomica") {
        return Promise.resolve({ data: null, error: FUNCTION_MISSING_ERROR })
      }
      return Promise.resolve({ data: null, error: null })
    }) as any)

    mockSupabaseFrom({
      facturas: createChainMock(
        facturaWithOrden({ estado_pago: "ANULADA", monto_abonado: 0 })
      ),
    })

    const res = await pagosPost(
      createPagosRequest({
        facturaId: "f1",
        pagos: [{ monto: 500, metodo: "EFECTIVO" }],
      })
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body.error).toMatch(/anulado/i)
  })

  it("fallback: overpayment → 400", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    // Force fallback path
    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "registrar_pago_factura_atomica") {
        return Promise.resolve({ data: null, error: FUNCTION_MISSING_ERROR })
      }
      return Promise.resolve({ data: null, error: null })
    }) as any)

    mockSupabaseFrom({
      facturas: createChainMock(
        facturaWithOrden({ total: 1000, monto_abonado: 200, estado_pago: "PAGADO_PARCIAL" })
      ),
    })

    // Try to pay 900 when only 800 is pending
    const res = await pagosPost(
      createPagosRequest({
        facturaId: "f1",
        pagos: [{ monto: 900, metodo: "EFECTIVO" }],
      })
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body.error).toMatch(/excede el pendiente/i)
  })
})
