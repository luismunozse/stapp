/**
 * Tests: F7 — per-org IVA applied when generating a factura
 *
 * Guards:
 *   F7a: EXENTO → iva=0, total=subtotal (unchanged behavior).
 *   F7b: INCLUIDO 21%, sum-of-items=121 → ivaNeto=100, iva=21, total=121.
 *   F7c: ADITIVO 21%, base=100 → subtotal=100, iva=21, total=121.
 *
 * Strategy: use the RPC path (crear_factura_atomica returns success) so we
 * can assert on the exact args passed: p_subtotal, p_iva, p_total.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  createPostRequest,
  parseResponse,
} from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

vi.mock("@/lib/counters", () => ({
  getNextInvoiceNumber: vi.fn().mockResolvedValue(99),
}))

import { POST as generarPost } from "@/app/api/facturacion/generar/route"

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Build a mock from(table) implementation that handles ordenes + organizations
 *  and lets the RPC path succeed. orgFiscal controls organizations row. */
function mockFromWithOrg(orgFiscal: {
  iva_regimen: string
  iva_tasa: number
  redondeo_efectivo?: number
}) {
  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    if (table === "ordenes_servicio") {
      return createChainMock(ordenBase()) as any
    }
    if (table === "organizations") {
      return createChainMock({ ...orgFiscal, redondeo_efectivo: orgFiscal.redondeo_efectivo ?? 0 }) as any
    }
    if (table === "items_factura") {
      return createChainMock([]) as any
    }
    return createChainMock(null, { message: `No mock for table: ${table}` }) as any
  })
}

/** A minimal REPARADO order with costo_final=121 (used for INCLUIDO test).
 *  No cotización so subtotal comes from costo_final directly. */
function ordenBase(costFinal = 121) {
  return {
    id: "o1",
    estado: "REPARADO",
    costo_final: costFinal,
    presupuesto: costFinal,
    sena: 0,
    metodo_pago_sena: null,
    organization_id: "org-1",
    numero_orden: 1,
    dispositivo: "iPhone",
    clientes: { id: "c1", nombre: "Test" },
    repuestos_orden: [],
    facturas: [],
    cotizaciones: [],
  }
}

/** Make RPC return success so we can capture args. */
function mockRpcSuccess() {
  vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
    if (fn === "crear_factura_atomica") {
      return Promise.resolve({ data: { id: "f-new" }, error: null })
    }
    return Promise.resolve({ data: null, error: null })
  }) as any)
}

// ---------------------------------------------------------------------------
// F7a — EXENTO: iva=0, total=subtotal (no change)
// ---------------------------------------------------------------------------

describe("F7a — EXENTO: iva=0, total=subtotal", () => {
  beforeEach(() => vi.clearAllMocks())

  it("EXENTO org → p_iva=0, p_total=p_subtotal (unchanged)", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockRpcSuccess()
    mockFromWithOrg({ iva_regimen: "EXENTO", iva_tasa: 21 })

    const res = await generarPost(createPostRequest({ ordenId: "o1" }))
    const { status } = await parseResponse(res)

    expect(status).toBe(201)

    const rpcCalls = vi.mocked(supabaseAdmin.rpc).mock.calls
    const atomicCall = rpcCalls.find(([fn]) => fn === "crear_factura_atomica")
    expect(atomicCall).toBeDefined()

    const args = atomicCall![1] as any
    // subtotal = costo_final = 121; EXENTO → iva=0, total=121
    expect(args.p_iva).toBe(0)
    expect(args.p_total).toBe(args.p_subtotal)
    expect(args.p_total).toBe(121)
  })

  it("org with no fiscal config (undefined) → treats as EXENTO", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockRpcSuccess()

    // organizations returns null (no row / columns missing)
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ordenes_servicio") return createChainMock(ordenBase()) as any
      if (table === "organizations") return createChainMock(null) as any
      if (table === "items_factura") return createChainMock([]) as any
      return createChainMock(null, { message: `No mock for table: ${table}` }) as any
    })

    const res = await generarPost(createPostRequest({ ordenId: "o1" }))
    const { status } = await parseResponse(res)

    expect(status).toBe(201)

    const args = (vi.mocked(supabaseAdmin.rpc).mock.calls.find(([fn]) => fn === "crear_factura_atomica")![1]) as any
    expect(args.p_iva).toBe(0)
    expect(args.p_total).toBe(args.p_subtotal)
  })
})

// ---------------------------------------------------------------------------
// F7b — INCLUIDO 21%: subtotal(items sum)=121 → ivaNeto=100, iva=21, total=121
// ---------------------------------------------------------------------------

describe("F7b — INCLUIDO 21%: ivaNeto=100, iva=21, total=121", () => {
  beforeEach(() => vi.clearAllMocks())

  it("INCLUIDO 21%, costo_final=121 → p_subtotal≈100, p_iva≈21, p_total=121", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockRpcSuccess()
    // costo_final=121 so the pre-IVA subtotal (sum of items) = 121
    mockFromWithOrg({ iva_regimen: "INCLUIDO", iva_tasa: 21 })

    const res = await generarPost(createPostRequest({ ordenId: "o1" }))
    const { status } = await parseResponse(res)

    expect(status).toBe(201)

    const args = (vi.mocked(supabaseAdmin.rpc).mock.calls.find(([fn]) => fn === "crear_factura_atomica")![1]) as any
    // ivaNeto = round2(121 / 1.21) = round2(100) = 100
    // ivaMonto = round2(121 - 100) = 21
    // totalConIva = 121 (unchanged for INCLUIDO)
    expect(args.p_subtotal).toBeCloseTo(100, 2)
    expect(args.p_iva).toBeCloseTo(21, 2)
    expect(args.p_total).toBe(121)
  })
})

// ---------------------------------------------------------------------------
// F7c — ADITIVO 21%: base=100 → subtotal=100, iva=21, total=121
// ---------------------------------------------------------------------------

describe("F7c — ADITIVO 21%: subtotal=100, iva=21, total=121", () => {
  beforeEach(() => vi.clearAllMocks())

  it("ADITIVO 21%, costo_final=100 → p_subtotal=100, p_iva=21, p_total=121", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockRpcSuccess()

    // use costo_final=100 as the base
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ordenes_servicio") return createChainMock(ordenBase(100)) as any
      if (table === "organizations") return createChainMock({ iva_regimen: "ADITIVO", iva_tasa: 21, redondeo_efectivo: 0 }) as any
      if (table === "items_factura") return createChainMock([]) as any
      return createChainMock(null, { message: `No mock for table: ${table}` }) as any
    })

    const res = await generarPost(createPostRequest({ ordenId: "o1" }))
    const { status } = await parseResponse(res)

    expect(status).toBe(201)

    const args = (vi.mocked(supabaseAdmin.rpc).mock.calls.find(([fn]) => fn === "crear_factura_atomica")![1]) as any
    // ivaNeto = base = 100
    // ivaMonto = round2(100 * 0.21) = 21
    // totalConIva = round2(100 + 21) = 121
    expect(args.p_subtotal).toBe(100)
    expect(args.p_iva).toBe(21)
    expect(args.p_total).toBe(121)
  })
})
