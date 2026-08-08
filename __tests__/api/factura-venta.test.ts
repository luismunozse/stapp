/**
 * Tests: venta-sourced invoice generation — POST /api/facturacion/generar { ventaId }
 *
 * Guards:
 *   V1: zod XOR — rejects body with both ordenId+ventaId, and with neither.
 *   V2: venta not found / cross-org → 404.
 *   V3: venta ANULADA → 400.
 *   V4: venta already invoiced → 400.
 *   V5: happy path — IVA copied (not recomputed) from venta snapshot;
 *       estado_pago/monto_abonado copied; RPC called with correct args; 201.
 *   V6: EXENTO venta (iva_neto/iva_monto null) → iva=0, subtotal=venta.subtotal.
 *   V7: RPC-missing → JS fallback inserts factura + items_factura directly.
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
  getNextInvoiceNumber: vi.fn().mockResolvedValue("0001-00000099"),
}))

import { POST as generarPost } from "@/app/api/facturacion/generar/route"

function ventaBase(over: Partial<any> = {}) {
  return {
    id: "v1",
    estado: "COMPLETADA",
    numero_venta: 5,
    subtotal: 100,
    iva_neto: null,
    iva_monto: null,
    monto_abonado: 100,
    estado_pago: "PAGADO",
    organization_id: "org-1",
    cliente_nombre: "Consumidor Final",
    total: 100,
    items_venta: [
      { inventario_id: "inv1", descripcion: "Cargador", cantidad: 1, precio_unitario: 100, subtotal: 100 },
    ],
    facturas: [],
    ...over,
  }
}

describe("POST /api/facturacion/generar — zod XOR (V1)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("rejects body with both ordenId and ventaId", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const res = await generarPost(createPostRequest({ ordenId: "o1", ventaId: "v1" }))
    const { status } = await parseResponse(res)
    expect(status).toBe(400)
  })

  it("rejects body with neither ordenId nor ventaId", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const res = await generarPost(createPostRequest({}))
    const { status } = await parseResponse(res)
    expect(status).toBe(400)
  })
})

describe("POST /api/facturacion/generar — venta gates (V2-V4)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("404 when venta not found (cross-org or missing)", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ventas") return createChainMock(null, { message: "not found" }) as any
      return createChainMock(null, { message: `No mock for table: ${table}` }) as any
    })

    const res = await generarPost(createPostRequest({ ventaId: "v1" }))
    const { status, body } = await parseResponse(res)
    expect(status).toBe(404)
    expect(body.error).toBe("Venta no encontrada")
  })

  it("400 when venta is ANULADA", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ventas") return createChainMock(ventaBase({ estado: "ANULADA" })) as any
      return createChainMock(null, { message: `No mock for table: ${table}` }) as any
    })

    const res = await generarPost(createPostRequest({ ventaId: "v1" }))
    const { status, body } = await parseResponse(res)
    expect(status).toBe(400)
    expect(body.error).toBe("La venta está anulada")
  })

  it("400 when venta already has a factura", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ventas") return createChainMock(ventaBase({ facturas: [{ id: "f-existing" }] })) as any
      return createChainMock(null, { message: `No mock for table: ${table}` }) as any
    })

    const res = await generarPost(createPostRequest({ ventaId: "v1" }))
    const { status, body } = await parseResponse(res)
    expect(status).toBe(400)
    expect(body.error).toBe("Ya existe una factura para esta venta")
  })
})

describe("POST /api/facturacion/generar — venta happy path (V5-V6)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("copies IVA from the venta snapshot and calls the RPC with correct args", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "crear_factura_venta_atomica") {
        return Promise.resolve({ data: { id: "f-new" }, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    }) as any)
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ventas") {
        return createChainMock(ventaBase({ iva_neto: 100, iva_monto: 21, total: 121 })) as any
      }
      if (table === "items_factura") return createChainMock([]) as any
      return createChainMock(null, { message: `No mock for table: ${table}` }) as any
    })

    const res = await generarPost(createPostRequest({ ventaId: "v1" }))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(201)
    expect(body.id).toBe("f-new")

    const args = vi.mocked(supabaseAdmin.rpc).mock.calls.find(([fn]) => fn === "crear_factura_venta_atomica")![1] as any
    expect(args.p_venta_id).toBe("v1")
    expect(args.p_subtotal).toBe(100)
    expect(args.p_iva).toBe(21)
    expect(args.p_total).toBe(121)
    expect(args.p_monto_abonado).toBe(100)
    expect(args.p_estado_pago).toBe("PAGADO")
    expect(args.p_items).toEqual([
      { descripcion: "Cargador", cantidad: 1, precio_unitario: 100, subtotal: 100, tipo: "REPUESTO" },
    ])
  })

  it("EXENTO venta (iva_neto/iva_monto null) → iva=0, subtotal=venta.subtotal", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "crear_factura_venta_atomica") {
        return Promise.resolve({ data: { id: "f-new" }, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    }) as any)
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ventas") return createChainMock(ventaBase()) as any
      if (table === "items_factura") return createChainMock([]) as any
      return createChainMock(null, { message: `No mock for table: ${table}` }) as any
    })

    const res = await generarPost(createPostRequest({ ventaId: "v1" }))
    await parseResponse(res)

    const args = vi.mocked(supabaseAdmin.rpc).mock.calls.find(([fn]) => fn === "crear_factura_venta_atomica")![1] as any
    expect(args.p_iva).toBe(0)
    expect(args.p_subtotal).toBe(100)
  })
})

describe("POST /api/facturacion/generar — venta RPC-missing fallback (V7)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("falls back to direct inserts when crear_factura_venta_atomica is missing", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "crear_factura_venta_atomica") {
        return Promise.resolve({
          data: null,
          error: { code: "42883", message: "function crear_factura_venta_atomica does not exist" },
        })
      }
      return Promise.resolve({ data: null, error: null })
    }) as any)

    const insertedFactura = {
      id: "f-fallback",
      venta_id: "v1",
      numero_factura: "0001-00000099",
      fecha: "2026-01-01",
      subtotal: 100,
      iva: 0,
      total: 100,
      estado_pago: "PAGADO",
    }

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ventas") return createChainMock(ventaBase()) as any
      if (table === "facturas") return createChainMock(insertedFactura) as any
      if (table === "items_factura") return createChainMock([]) as any
      return createChainMock(null, { message: `No mock for table: ${table}` }) as any
    })

    const res = await generarPost(createPostRequest({ ventaId: "v1" }))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(201)
    expect(body.id).toBe("f-fallback")
  })
})
