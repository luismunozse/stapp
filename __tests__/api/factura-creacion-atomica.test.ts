/**
 * Tests: F4 — crear_factura_atomica RPC for POST /api/facturacion/generar
 *         F5 — idempotencyKey in POST /api/pagos (pago-form)
 *
 * Guards:
 *   F4a: generar happy path — calls crear_factura_atomica RPC with p_items + p_sena_monto,
 *        route returns 201 with correct shape.
 *   F4b: function-missing → fallback; items insert error → factura deleted + 500.
 *   F4c: total <= 0 → estado_pago is PENDIENTE (not PAGADO).
 *   F5:  POST /api/pagos body includes idempotencyKey → reaches RPC as p_idempotency_key.
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

vi.mock("@/lib/counters", () => ({
  getNextInvoiceNumber: vi.fn().mockResolvedValue(99),
}))

import { POST as generarPost } from "@/app/api/facturacion/generar/route"
import { POST as pagosPost } from "@/app/api/pagos/route"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FUNCTION_MISSING_ERROR = {
  code: "42883",
  message: "function crear_factura_atomica does not exist",
}

/** A minimal REPARADO order with a cotización aprobada (has items + seña) */
function ordenConCotizacion(over: Partial<any> = {}) {
  return {
    id: "o1",
    estado: "REPARADO",
    costo_final: 0,
    presupuesto: 0,
    sena: 2000,
    metodo_pago_sena: "EFECTIVO",
    organization_id: "org-1",
    numero_orden: 42,
    dispositivo: "iPhone 15",
    clientes: { id: "c1", nombre: "Pedro" },
    repuestos_orden: [],
    facturas: [],
    cotizaciones: [
      {
        id: "cot1",
        estado: "ACEPTADA",
        total: 8000,
        items_cotizacion: [
          { id: "ci1", descripcion: "Pantalla", cantidad: 1, precio_unitario: 5000, subtotal: 5000 },
          { id: "ci2", descripcion: "Mano de obra", cantidad: 1, precio_unitario: 3000, subtotal: 3000 },
        ],
      },
    ],
    ...over,
  }
}

/** A minimal order with costo_final, no cotización (no items path) */
function ordenSimple(over: Partial<any> = {}) {
  return {
    id: "o1",
    estado: "REPARADO",
    costo_final: 5000,
    presupuesto: 5000,
    sena: 0,
    metodo_pago_sena: null,
    organization_id: "org-1",
    numero_orden: 1,
    dispositivo: "Samsung",
    clientes: { id: "c1", nombre: "Ana" },
    repuestos_orden: [],
    facturas: [],
    cotizaciones: [],
    ...over,
  }
}

/** Minimal items_factura row */
const ITEMS_CREATED = [
  { id: "if1", descripcion: "Pantalla", cantidad: 1, precio_unitario: 5000, subtotal: 5000, tipo: "SERVICIO" },
  { id: "if2", descripcion: "Mano de obra", cantidad: 1, precio_unitario: 3000, subtotal: 3000, tipo: "SERVICIO" },
]

// ═══════════════════════════════════════════════════════════════════════════
// F4a — generar happy path: RPC called, 201 returned
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /api/facturacion/generar — crear_factura_atomica RPC (F4a)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("calls crear_factura_atomica and returns 201 with correct shape", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    mockSupabaseFrom({
      ordenes_servicio: createChainMock(ordenConCotizacion()),
      items_factura: createChainMock(ITEMS_CREATED),
    })

    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "crear_factura_atomica") {
        return Promise.resolve({ data: { id: "f-new" }, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    }) as any)

    const res = await generarPost(createPostRequest({ ordenId: "o1" }))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(201)
    expect(body.id).toBe("f-new")
    expect(body.items).toHaveLength(2)

    // Verify RPC was called with the right args
    const rpcCalls = vi.mocked(supabaseAdmin.rpc).mock.calls
    const atomicCall = rpcCalls.find(([fn]) => fn === "crear_factura_atomica")
    expect(atomicCall).toBeDefined()

    const args = atomicCall![1] as any
    expect(args.p_orden_id).toBe("o1")
    expect(args.p_numero_factura).toBe(99)
    expect(Array.isArray(args.p_items) || typeof args.p_items === "string").toBe(true)
    // p_items must contain the cotizacion items
    const items = typeof args.p_items === "string" ? JSON.parse(args.p_items) : args.p_items
    expect(items).toHaveLength(2)
    // p_sena_monto must be 2000
    expect(args.p_sena_monto).toBe(2000)
  })

  it("RPC called with p_sena_metodo when sena > 0", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    mockSupabaseFrom({
      ordenes_servicio: createChainMock(ordenConCotizacion({ sena: 1500, metodo_pago_sena: "TRANSFERENCIA" })),
      items_factura: createChainMock(ITEMS_CREATED),
    })

    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "crear_factura_atomica") {
        return Promise.resolve({ data: { id: "f-new" }, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    }) as any)

    await generarPost(createPostRequest({ ordenId: "o1" }))

    const rpcCalls = vi.mocked(supabaseAdmin.rpc).mock.calls
    const atomicCall = rpcCalls.find(([fn]) => fn === "crear_factura_atomica")
    const args = atomicCall![1] as any
    expect(args.p_sena_monto).toBe(1500)
    expect(args.p_sena_metodo).toBe("TRANSFERENCIA")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// F4b — function-missing → fallback; items insert error → delete + 500
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /api/facturacion/generar — fallback (function missing) (F4b)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("fallback happy path: inserts factura + items + seña, returns 201", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "crear_factura_atomica") {
        return Promise.resolve({ data: null, error: FUNCTION_MISSING_ERROR })
      }
      return Promise.resolve({ data: null, error: null })
    }) as any)

    const facturaRow = {
      id: "f-fb",
      orden_id: "o1",
      numero_factura: 99,
      fecha: "2024-01-01",
      subtotal: 8000,
      iva: 0,
      total: 8000,
      estado_pago: "PAGADO_PARCIAL",
      monto_abonado: 2000,
    }

    let facturasCallCount = 0
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ordenes_servicio") return createChainMock(ordenConCotizacion()) as any
      if (table === "facturas") {
        facturasCallCount++
        return createChainMock(facturaRow) as any
      }
      if (table === "items_factura") return createChainMock(ITEMS_CREATED) as any
      if (table === "pagos_parciales") return createChainMock(null) as any
      return createChainMock(null) as any
    })

    const res = await generarPost(createPostRequest({ ordenId: "o1" }))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(201)
    expect(body.id).toBe("f-fb")
  })

  it("fallback: items insert error → factura deleted → 500", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "crear_factura_atomica") {
        return Promise.resolve({ data: null, error: FUNCTION_MISSING_ERROR })
      }
      return Promise.resolve({ data: null, error: null })
    }) as any)

    const facturaRow = {
      id: "f-fb",
      orden_id: "o1",
      numero_factura: 99,
      fecha: "2024-01-01",
      subtotal: 8000,
      iva: 0,
      total: 8000,
      estado_pago: "PAGADO_PARCIAL",
      monto_abonado: 2000,
    }

    let deleteCalled = false

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ordenes_servicio") return createChainMock(ordenConCotizacion()) as any
      if (table === "facturas") {
        // Track if delete is called
        const chain = createChainMock(facturaRow)
        chain.delete = vi.fn().mockImplementation(() => {
          deleteCalled = true
          return chain
        })
        return chain as any
      }
      if (table === "items_factura") {
        // items insert fails
        const chain = createChainMock(null, { message: "constraint violation" })
        chain.insert = vi.fn().mockReturnValue(chain)
        chain.then = (resolve: any) =>
          Promise.resolve({ data: null, error: { message: "constraint violation" } }).then(resolve)
        return chain as any
      }
      return createChainMock(null) as any
    })

    const res = await generarPost(createPostRequest({ ordenId: "o1" }))
    const { status } = await parseResponse(res)

    expect(status).toBe(500)
    // The fallback must have called delete on the orphaned factura
    expect(deleteCalled).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// F4c — total <= 0 → estado_pago must be PENDIENTE
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /api/facturacion/generar — edge: total <= 0 (F4c / F-C4)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("total=0 → RPC called with p_estado_pago=PENDIENTE (not PAGADO)", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    // Order with total = 0 (no cost, no presupuesto, no repuestos)
    const ordenCeroTotal = {
      id: "o1",
      estado: "REPARADO",
      costo_final: 0,
      presupuesto: 0,
      sena: 0,
      metodo_pago_sena: null,
      organization_id: "org-1",
      numero_orden: 1,
      dispositivo: "Tablet",
      clientes: { id: "c1", nombre: "X" },
      repuestos_orden: [],
      facturas: [],
      cotizaciones: [],
    }

    mockSupabaseFrom({
      ordenes_servicio: createChainMock(ordenCeroTotal),
      items_factura: createChainMock([]),
    })

    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "crear_factura_atomica") {
        return Promise.resolve({ data: { id: "f-zero" }, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    }) as any)

    await generarPost(createPostRequest({ ordenId: "o1" }))

    const rpcCalls = vi.mocked(supabaseAdmin.rpc).mock.calls
    const atomicCall = rpcCalls.find(([fn]) => fn === "crear_factura_atomica")
    expect(atomicCall).toBeDefined()
    const args = atomicCall![1] as any
    // 0 >= 0 must NOT yield PAGADO — it must be PENDIENTE
    expect(args.p_estado_pago).toBe("PENDIENTE")
  })

  it("total=0, sena=0 → fallback also uses PENDIENTE (not PAGADO)", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "crear_factura_atomica") {
        return Promise.resolve({ data: null, error: FUNCTION_MISSING_ERROR })
      }
      return Promise.resolve({ data: null, error: null })
    }) as any)

    const ordenCeroTotal = {
      id: "o1",
      estado: "REPARADO",
      costo_final: 0,
      presupuesto: 0,
      sena: 0,
      metodo_pago_sena: null,
      organization_id: "org-1",
      numero_orden: 1,
      dispositivo: "Tablet",
      clientes: { id: "c1", nombre: "X" },
      repuestos_orden: [],
      facturas: [],
      cotizaciones: [],
    }

    const capturedInserts: any[] = []

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ordenes_servicio") return createChainMock(ordenCeroTotal) as any
      if (table === "facturas") {
        const chain = createChainMock({
          id: "f-zero",
          orden_id: "o1",
          numero_factura: 99,
          fecha: "2024-01-01",
          subtotal: 0,
          iva: 0,
          total: 0,
          estado_pago: "PENDIENTE",
          monto_abonado: 0,
        })
        const origInsert = chain.insert
        chain.insert = vi.fn().mockImplementation((data: any) => {
          capturedInserts.push(data)
          return chain
        })
        return chain as any
      }
      if (table === "items_factura") return createChainMock([]) as any
      return createChainMock(null) as any
    })

    const res = await generarPost(createPostRequest({ ordenId: "o1" }))
    const { status } = await parseResponse(res)

    expect(status).toBe(201)
    // The insert payload must have PENDIENTE, not PAGADO
    const facturaInsert = capturedInserts[0]
    expect(facturaInsert?.estado_pago).toBe("PENDIENTE")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// F5 — POST /api/pagos includes idempotencyKey → reaches RPC as p_idempotency_key
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /api/pagos — idempotencyKey reaches RPC (F5)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("idempotencyKey in body is forwarded to registrar_pago_factura_atomica as p_idempotency_key", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    const facturaRow = {
      id: "f1",
      orden_id: "o1",
      total: 1000,
      monto_abonado: 0,
      estado_pago: "PENDIENTE",
      ordenes_servicio: { organization_id: "org-1", cliente_id: "c1" },
    }

    mockSupabaseFrom({ facturas: createChainMock(facturaRow) })

    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "registrar_pago_factura_atomica") {
        return Promise.resolve({
          data: {
            replayed: false,
            response: {
              pagos: [{ id: "pp1", monto: 500 }],
              factura: { montoAbonado: 500, estadoPago: "PAGADO_PARCIAL", pendiente: 500 },
            },
          },
          error: null,
        })
      }
      return Promise.resolve({ data: null, error: null })
    }) as any)

    const payload = {
      facturaId: "f1",
      pagos: [{ monto: 500, metodo: "EFECTIVO" }],
      idempotencyKey: "stable-uuid-from-ref-001",
    }

    const res = await pagosPost(createPostRequest(payload))
    const { status } = await parseResponse(res)

    expect(status).toBe(201)

    const rpcCalls = vi.mocked(supabaseAdmin.rpc).mock.calls
    const atomicCall = rpcCalls.find(([fn]) => fn === "registrar_pago_factura_atomica")
    expect(atomicCall).toBeDefined()
    expect(atomicCall![1]).toMatchObject({
      p_factura_id: "f1",
      p_idempotency_key: "stable-uuid-from-ref-001",
    })
  })

  it("missing idempotencyKey in body → p_idempotency_key is null (no crash)", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    const facturaRow = {
      id: "f1",
      orden_id: "o1",
      total: 1000,
      monto_abonado: 0,
      estado_pago: "PENDIENTE",
      ordenes_servicio: { organization_id: "org-1", cliente_id: "c1" },
    }

    mockSupabaseFrom({ facturas: createChainMock(facturaRow) })

    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "registrar_pago_factura_atomica") {
        return Promise.resolve({
          data: {
            replayed: false,
            response: {
              pagos: [{ id: "pp1", monto: 500 }],
              factura: { montoAbonado: 500, estadoPago: "PAGADO_PARCIAL", pendiente: 500 },
            },
          },
          error: null,
        })
      }
      return Promise.resolve({ data: null, error: null })
    }) as any)

    // No idempotencyKey
    const res = await pagosPost(createPostRequest({
      facturaId: "f1",
      pagos: [{ monto: 500, metodo: "EFECTIVO" }],
    }))
    const { status } = await parseResponse(res)

    expect(status).toBe(201)

    const rpcCalls = vi.mocked(supabaseAdmin.rpc).mock.calls
    const atomicCall = rpcCalls.find(([fn]) => fn === "registrar_pago_factura_atomica")
    expect(atomicCall![1]).toMatchObject({ p_idempotency_key: null })
  })
})
