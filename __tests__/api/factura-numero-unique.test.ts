/**
 * Tests: F6 — unique numero_factura per organization_id
 *
 * Guards:
 *   F6a: generar fallback path (function-missing) → facturas insert payload includes
 *        organization_id equal to the session org ("org-1").
 *   F6b: generar RPC path → still calls crear_factura_atomica and returns 201
 *        (org is derived inside the RPC; route does not need to pass it).
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

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const FUNCTION_MISSING_ERROR = {
  code: "42883",
  message: "function crear_factura_atomica does not exist",
}

function ordenConCotizacion(over: Partial<any> = {}) {
  return {
    id: "o1",
    estado: "REPARADO",
    costo_final: 0,
    presupuesto: 0,
    sena: 0,
    metodo_pago_sena: null,
    organization_id: "org-1",
    numero_orden: 1,
    dispositivo: "iPhone",
    clientes: { id: "c1", nombre: "Ana" },
    repuestos_orden: [],
    facturas: [],
    cotizaciones: [
      {
        id: "cot1",
        estado: "ACEPTADA",
        total: 5000,
        items_cotizacion: [
          { id: "ci1", descripcion: "Pantalla", cantidad: 1, precio_unitario: 5000, subtotal: 5000 },
        ],
      },
    ],
    ...over,
  }
}

const ITEMS_CREATED = [
  { id: "if1", descripcion: "Pantalla", cantidad: 1, precio_unitario: 5000, subtotal: 5000, tipo: "SERVICIO" },
]

// ═══════════════════════════════════════════════════════════════════════════
// F6a — fallback path includes organization_id in the facturas insert payload
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /api/facturacion/generar — fallback includes organization_id (F6a)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("fallback insert payload contains organization_id equal to the session org", async () => {
    // Auth returns organizationId = "org-1"
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })

    // Force the RPC to fail with function-missing so we hit the JS fallback
    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "crear_factura_atomica") {
        return Promise.resolve({ data: null, error: FUNCTION_MISSING_ERROR })
      }
      return Promise.resolve({ data: null, error: null })
    }) as any)

    const capturedInserts: any[] = []

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ordenes_servicio") return createChainMock(ordenConCotizacion()) as any
      if (table === "facturas") {
        const chain = createChainMock({
          id: "f-fb",
          orden_id: "o1",
          numero_factura: 99,
          fecha: "2024-01-01",
          subtotal: 5000,
          iva: 0,
          total: 5000,
          estado_pago: "PENDIENTE",
          monto_abonado: 0,
        })
        chain.insert = vi.fn().mockImplementation((data: any) => {
          capturedInserts.push(data)
          return chain
        })
        return chain as any
      }
      if (table === "items_factura") return createChainMock(ITEMS_CREATED) as any
      if (table === "pagos_parciales") return createChainMock(null) as any
      return createChainMock(null) as any
    })

    const res = await generarPost(createPostRequest({ ordenId: "o1" }))
    const { status } = await parseResponse(res)

    expect(status).toBe(201)

    // The facturas insert must include organization_id
    expect(capturedInserts).toHaveLength(1)
    expect(capturedInserts[0]).toMatchObject({
      organization_id: "org-1",
    })
  })

  it("fallback insert organization_id matches the org from the auth session, not the orden", async () => {
    // A different org to be sure the value comes from auth, not hardcoded
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-xyz" })

    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "crear_factura_atomica") {
        return Promise.resolve({ data: null, error: FUNCTION_MISSING_ERROR })
      }
      return Promise.resolve({ data: null, error: null })
    }) as any)

    const capturedInserts: any[] = []

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ordenes_servicio")
        return createChainMock(ordenConCotizacion({ organization_id: "org-xyz" })) as any
      if (table === "facturas") {
        const chain = createChainMock({
          id: "f-fb2",
          orden_id: "o1",
          numero_factura: 99,
          fecha: "2024-01-01",
          subtotal: 5000,
          iva: 0,
          total: 5000,
          estado_pago: "PENDIENTE",
          monto_abonado: 0,
        })
        chain.insert = vi.fn().mockImplementation((data: any) => {
          capturedInserts.push(data)
          return chain
        })
        return chain as any
      }
      if (table === "items_factura") return createChainMock(ITEMS_CREATED) as any
      if (table === "pagos_parciales") return createChainMock(null) as any
      return createChainMock(null) as any
    })

    const res = await generarPost(createPostRequest({ ordenId: "o1" }))
    const { status } = await parseResponse(res)

    expect(status).toBe(201)
    expect(capturedInserts[0]).toMatchObject({ organization_id: "org-xyz" })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// F6b — RPC path still works (org derived inside RPC, route unchanged)
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /api/facturacion/generar — RPC path unaffected by F6 (F6b)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("calls crear_factura_atomica and returns 201 when RPC succeeds", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    mockSupabaseFrom({
      ordenes_servicio: createChainMock(ordenConCotizacion()),
      items_factura: createChainMock(ITEMS_CREATED),
    })

    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "crear_factura_atomica") {
        return Promise.resolve({ data: { id: "f-rpc" }, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    }) as any)

    const res = await generarPost(createPostRequest({ ordenId: "o1" }))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(201)
    expect(body.id).toBe("f-rpc")

    // Verify RPC was called
    const rpcCalls = vi.mocked(supabaseAdmin.rpc).mock.calls
    const atomicCall = rpcCalls.find(([fn]) => fn === "crear_factura_atomica")
    expect(atomicCall).toBeDefined()
    expect(atomicCall![1]).toMatchObject({ p_orden_id: "o1" })
  })
})
