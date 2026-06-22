/**
 * Tests for edit-sale flow bugs:
 *  Bug 1 — PUT total ignores per-item discounts
 *  Bug 2 — IVA snapshot not recomputed on edit
 *  Bug 5 — edit form payload carries per-item discount fields (light assertion)
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth } from "@/lib/auth"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/audit", () => ({
  createAuditLogger: vi.fn(() => ({
    create: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.mock("@/lib/webhooks/dispatcher", () => ({
  emitWebhookEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/counters", () => ({
  getNextSaleNumber: vi.fn().mockResolvedValue({ numero: 1 }),
  getNextWarrantySaleNumber: vi.fn().mockResolvedValue("GAR-001"),
}))

import { supabaseAdmin } from "@/lib/supabase"
import { PUT } from "@/app/api/ventas/[id]/route"

// ── helpers ──────────────────────────────────────────────────────────────────

function createPutRequest(
  body: any,
  id = "v1"
): [Request, { params: Promise<{ id: string }> }] {
  const req = new Request(`http://localhost:3000/api/ventas/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  return [req, { params: Promise.resolve({ id }) }]
}

const existingVenta = {
  id: "v1",
  estado: "COMPLETADA",
  cliente_nombre: "Cliente Viejo",
  total: 500,
  items_venta: [],
}

/** RPC args for the FIRST call (editar_venta_atomica) */
function editRpcArgs() {
  return vi.mocked(supabaseAdmin.rpc).mock.calls[0][1] as any
}

// ── Bug 1: per-item discounts must be subtracted from p_total ────────────────

describe("Bug 1 — PUT totals account for per-item discounts", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("item MONTO discount: p_total = bruto - item_desc (no global)", async () => {
    // item: 2 × 100 = 200 bruto, descuento MONTO $30 → neto 170
    mockAuthSuccess()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: null, error: null } as any)
    mockSupabaseFrom({
      ventas: createChainMock(existingVenta),
    })

    const [req, ctx] = createPutRequest({
      action: "edit",
      clienteNombre: "CF",
      metodoPago: "EFECTIVO",
      descuento: 0,
      tipoDescuento: "MONTO",
      porcentajeDescuento: 0,
      items: [
        {
          inventarioId: "i1",
          descripcion: "Prod",
          cantidad: 2,
          precioUnitario: 100,
          tipoDescuento: "MONTO",
          descuento: 30,
          porcentajeDescuento: 0,
        },
      ],
    })
    const res = await PUT(req, ctx)
    await parseResponse(res)

    const args = editRpcArgs()
    expect(args.p_subtotal).toBe(200)
    expect(args.p_descuento).toBe(30)
    expect(args.p_total).toBe(170) // Bug 1 was: 200
  })

  it("item PORCENTAJE discount: p_total = bruto * (1 - pct/100)", async () => {
    // item: 1 × 200 = 200 bruto, 10% → neto 180
    mockAuthSuccess()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: null, error: null } as any)
    mockSupabaseFrom({
      ventas: createChainMock(existingVenta),
    })

    const [req, ctx] = createPutRequest({
      action: "edit",
      clienteNombre: "CF",
      metodoPago: "EFECTIVO",
      descuento: 0,
      tipoDescuento: "MONTO",
      porcentajeDescuento: 0,
      items: [
        {
          inventarioId: "i1",
          descripcion: "Prod",
          cantidad: 1,
          precioUnitario: 200,
          tipoDescuento: "PORCENTAJE",
          descuento: 0,
          porcentajeDescuento: 10,
        },
      ],
    })
    const res = await PUT(req, ctx)
    await parseResponse(res)

    const args = editRpcArgs()
    expect(args.p_subtotal).toBe(200)
    expect(args.p_descuento).toBe(20)
    expect(args.p_total).toBe(180)
  })

  it("combined: item 10% + global $20 → descuento 30, total 70", async () => {
    // item: 1 × 100 = 100, 10% item → neto 90; global $20 → 70
    mockAuthSuccess()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: null, error: null } as any)
    mockSupabaseFrom({
      ventas: createChainMock(existingVenta),
    })

    const [req, ctx] = createPutRequest({
      action: "edit",
      clienteNombre: "CF",
      metodoPago: "EFECTIVO",
      descuento: 20,
      tipoDescuento: "MONTO",
      porcentajeDescuento: 0,
      items: [
        {
          inventarioId: "i1",
          descripcion: "Prod",
          cantidad: 1,
          precioUnitario: 100,
          tipoDescuento: "PORCENTAJE",
          descuento: 0,
          porcentajeDescuento: 10,
        },
      ],
    })
    const res = await PUT(req, ctx)
    await parseResponse(res)

    const args = editRpcArgs()
    expect(args.p_subtotal).toBe(100)
    expect(args.p_descuento).toBe(30) // 10 item + 20 global
    expect(args.p_total).toBe(70)
  })

  it("global discount % applies over post-item net", async () => {
    // item: 2 × 100 = 200, 10% item → neto 180; global 10% on 180 = 18 → total 162
    mockAuthSuccess()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: null, error: null } as any)
    mockSupabaseFrom({
      ventas: createChainMock(existingVenta),
    })

    const [req, ctx] = createPutRequest({
      action: "edit",
      clienteNombre: "CF",
      metodoPago: "EFECTIVO",
      descuento: 0,
      tipoDescuento: "PORCENTAJE",
      porcentajeDescuento: 10,
      items: [
        {
          inventarioId: "i1",
          descripcion: "Prod",
          cantidad: 2,
          precioUnitario: 100,
          tipoDescuento: "PORCENTAJE",
          descuento: 0,
          porcentajeDescuento: 10,
        },
      ],
    })
    const res = await PUT(req, ctx)
    await parseResponse(res)

    const args = editRpcArgs()
    expect(args.p_subtotal).toBe(200)
    expect(args.p_descuento).toBe(38) // 20 item + 18 global
    expect(args.p_total).toBe(162)
  })

  it("global discount clamped — total never negative", async () => {
    mockAuthSuccess()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: null, error: null } as any)
    mockSupabaseFrom({
      ventas: createChainMock(existingVenta),
    })

    const [req, ctx] = createPutRequest({
      action: "edit",
      clienteNombre: "CF",
      metodoPago: "EFECTIVO",
      descuento: 9999,
      tipoDescuento: "MONTO",
      porcentajeDescuento: 0,
      items: [
        {
          inventarioId: "i1",
          descripcion: "Prod",
          cantidad: 1,
          precioUnitario: 100,
          tipoDescuento: "MONTO",
          descuento: 0,
          porcentajeDescuento: 0,
        },
      ],
    })
    const res = await PUT(req, ctx)
    await parseResponse(res)

    const args = editRpcArgs()
    expect(args.p_total).toBe(0)
  })
})

// ── Bug 2: IVA snapshot must be recomputed on edit ──────────────────────────

describe("Bug 2 — IVA snapshot recomputed after edit", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  /**
   * Helper that runs a PUT edit and collects the supabase.from("ventas").update()
   * call that happens AFTER the RPC (the IVA snapshot UPDATE).
   * Returns { rpcArgs, ivaUpdatePayload } or { rpcArgs, ivaUpdatePayload: null }.
   */
  async function runEditWithFiscal(orgFiscal: any) {
    mockAuthSuccess()
    // RPC succeeds
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: null, error: null } as any)

    // Capture per-table calls so we can inspect the IVA update payload.
    // We need at least 2 ventas chain calls:
    //   1. fetch existing venta (single)
    //   2. iva snapshot update (update + eq)
    //   3. fetch updated venta (single)
    // We'll capture the update call payload via a spy on the chain.
    let capturedUpdatePayload: any = null
    const ventasChainForFetch = createChainMock(existingVenta)
    const ventasChainForIvaUpdate: any = {}
    for (const m of ["update", "eq", "select", "single", "maybeSingle"]) {
      ventasChainForIvaUpdate[m] = vi.fn().mockImplementation((arg?: any) => {
        if (m === "update") capturedUpdatePayload = arg
        return ventasChainForIvaUpdate
      })
    }
    // single() for the final fetch
    ventasChainForIvaUpdate.single = vi
      .fn()
      .mockResolvedValue({ data: existingVenta, error: null })
    ventasChainForIvaUpdate.then = (resolve: any) =>
      Promise.resolve({ data: null, error: null }).then(resolve)
    ventasChainForIvaUpdate.catch = (reject: any) =>
      Promise.resolve({ data: null, error: null }).catch(reject)

    let ventasCallCount = 0
    const orgChain = createChainMock(orgFiscal)

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "organizations") return orgChain as any
      if (table === "ventas") {
        ventasCallCount++
        // Call 1 → existing venta fetch; call 2 → IVA update; call 3 → final fetch
        if (ventasCallCount === 1) return ventasChainForFetch as any
        return ventasChainForIvaUpdate as any
      }
      return createChainMock(null) as any
    })

    const [req, ctx] = createPutRequest({
      action: "edit",
      clienteNombre: "CF",
      metodoPago: "EFECTIVO",
      descuento: 0,
      tipoDescuento: "MONTO",
      porcentajeDescuento: 0,
      items: [
        {
          inventarioId: "i1",
          descripcion: "Prod",
          cantidad: 1,
          precioUnitario: 100,
          tipoDescuento: "MONTO",
          descuento: 0,
          porcentajeDescuento: 0,
        },
      ],
    })
    const res = await PUT(req, ctx)
    const { status } = await parseResponse(res)

    return { status, rpcArgs: editRpcArgs(), ivaUpdatePayload: capturedUpdatePayload }
  }

  it("EXENTO: IVA snapshot not written (no fiscal update needed)", async () => {
    // For EXENTO, fiscalActivo = false → no IVA snapshot update.
    // We just verify the route doesn't crash and calls RPC correctly.
    mockAuthSuccess()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: null, error: null } as any)
    mockSupabaseFrom({
      ventas: createChainMock(existingVenta),
      organizations: createChainMock({ iva_regimen: "EXENTO", iva_tasa: 0, redondeo_efectivo: 0 }),
    })

    const [req, ctx] = createPutRequest({
      action: "edit",
      clienteNombre: "CF",
      metodoPago: "EFECTIVO",
      descuento: 0,
      tipoDescuento: "MONTO",
      porcentajeDescuento: 0,
      items: [
        {
          inventarioId: "i1",
          descripcion: "Prod",
          cantidad: 1,
          precioUnitario: 100,
          tipoDescuento: "MONTO",
          descuento: 0,
          porcentajeDescuento: 0,
        },
      ],
    })
    const res = await PUT(req, ctx)
    const { status } = await parseResponse(res)
    expect(status).toBe(200)
    // p_total should pass through without IVA surcharge
    expect(editRpcArgs().p_total).toBe(100)
  })

  it("ADITIVO 21%: IVA snapshot UPDATE sets iva_monto=21, iva_neto=100, iva_tasa=21", async () => {
    // base=100, ADITIVO 21% → ivaNeto=100, ivaMonto=21, totalConIva=121
    const { status, rpcArgs, ivaUpdatePayload } = await runEditWithFiscal({
      iva_regimen: "ADITIVO",
      iva_tasa: 21,
      redondeo_efectivo: 0,
    })
    expect(status).toBe(200)
    // RPC receives the post-IVA total
    expect(rpcArgs.p_total).toBe(121)
    // IVA snapshot was written
    expect(ivaUpdatePayload).not.toBeNull()
    expect(ivaUpdatePayload.iva_monto).toBe(21)
    expect(ivaUpdatePayload.iva_neto).toBe(100)
    expect(ivaUpdatePayload.iva_tasa).toBe(21)
    expect(ivaUpdatePayload.iva_regimen).toBe("ADITIVO")
  })

  it("INCLUIDO 21%: IVA snapshot UPDATE sets iva_neto=base/(1+0.21)", async () => {
    // base=121, INCLUIDO 21% → ivaNeto=121/1.21≈100, ivaMonto=21, total=121 unchanged
    mockAuthSuccess()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: null, error: null } as any)

    let capturedUpdatePayload: any = null
    let ventasCallCount = 0
    const orgChain = createChainMock({ iva_regimen: "INCLUIDO", iva_tasa: 21, redondeo_efectivo: 0 })

    const ventasChainForIvaUpdate: any = {}
    for (const m of ["update", "eq", "select", "single", "maybeSingle"]) {
      ventasChainForIvaUpdate[m] = vi.fn().mockImplementation((arg?: any) => {
        if (m === "update") capturedUpdatePayload = arg
        return ventasChainForIvaUpdate
      })
    }
    ventasChainForIvaUpdate.single = vi
      .fn()
      .mockResolvedValue({ data: existingVenta, error: null })
    ventasChainForIvaUpdate.then = (resolve: any) =>
      Promise.resolve({ data: null, error: null }).then(resolve)
    ventasChainForIvaUpdate.catch = (reject: any) =>
      Promise.resolve({ data: null, error: null }).catch(reject)

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "organizations") return orgChain as any
      if (table === "ventas") {
        ventasCallCount++
        if (ventasCallCount === 1) return createChainMock(existingVenta) as any
        return ventasChainForIvaUpdate as any
      }
      return createChainMock(null) as any
    })

    const [req, ctx] = createPutRequest({
      action: "edit",
      clienteNombre: "CF",
      metodoPago: "EFECTIVO",
      descuento: 0,
      tipoDescuento: "MONTO",
      porcentajeDescuento: 0,
      items: [
        {
          inventarioId: "i1",
          descripcion: "Prod",
          cantidad: 1,
          precioUnitario: 121, // price already includes IVA
          tipoDescuento: "MONTO",
          descuento: 0,
          porcentajeDescuento: 0,
        },
      ],
    })
    const res = await PUT(req, ctx)
    const { status } = await parseResponse(res)
    expect(status).toBe(200)

    // INCLUIDO: total = base (no surcharge), iva_neto = base / 1.21
    const args = editRpcArgs()
    expect(args.p_total).toBe(121) // no change for INCLUIDO

    expect(capturedUpdatePayload).not.toBeNull()
    expect(capturedUpdatePayload.iva_monto).toBe(21)     // 121 - 100
    expect(capturedUpdatePayload.iva_neto).toBe(100)     // 121 / 1.21
    expect(capturedUpdatePayload.iva_regimen).toBe("INCLUIDO")
  })

  it("IVA snapshot UPDATE error → returns 500", async () => {
    mockAuthSuccess()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: null, error: null } as any)

    let ventasCallCount = 0
    const ventasChainWithError: any = {}
    for (const m of ["update", "eq", "select", "single", "maybeSingle"]) {
      ventasChainWithError[m] = vi.fn().mockReturnValue(ventasChainWithError)
    }
    // Simulate update error (the chain resolves with error on await)
    ventasChainWithError.then = (resolve: any) =>
      Promise.resolve({ data: null, error: { message: "DB write failed" } }).then(resolve)
    ventasChainWithError.catch = (reject: any) =>
      Promise.resolve({ data: null, error: { message: "DB write failed" } }).catch(reject)

    const orgChain = createChainMock({ iva_regimen: "ADITIVO", iva_tasa: 21, redondeo_efectivo: 0 })

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "organizations") return orgChain as any
      if (table === "ventas") {
        ventasCallCount++
        if (ventasCallCount === 1) return createChainMock(existingVenta) as any
        return ventasChainWithError as any
      }
      return createChainMock(null) as any
    })

    const [req, ctx] = createPutRequest({
      action: "edit",
      clienteNombre: "CF",
      metodoPago: "EFECTIVO",
      descuento: 0,
      tipoDescuento: "MONTO",
      porcentajeDescuento: 0,
      items: [
        {
          inventarioId: "i1",
          descripcion: "Prod",
          cantidad: 1,
          precioUnitario: 100,
          tipoDescuento: "MONTO",
          descuento: 0,
          porcentajeDescuento: 0,
        },
      ],
    })
    const res = await PUT(req, ctx)
    const { status } = await parseResponse(res)
    expect(status).toBe(500)
  })
})

// ── Bug 5 (light) — edit payload includes per-item discount fields ──────────

describe("Bug 5 (light) — per-item discount fields survive the route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("descuento/tipoDescuento/porcentajeDescuento forwarded in p_items to RPC", async () => {
    mockAuthSuccess()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: null, error: null } as any)
    mockSupabaseFrom({
      ventas: createChainMock(existingVenta),
      organizations: createChainMock({ iva_regimen: "EXENTO", iva_tasa: 0 }),
    })

    const [req, ctx] = createPutRequest({
      action: "edit",
      clienteNombre: "CF",
      metodoPago: "EFECTIVO",
      descuento: 0,
      tipoDescuento: "MONTO",
      porcentajeDescuento: 0,
      items: [
        {
          inventarioId: "i1",
          descripcion: "Prod",
          cantidad: 2,
          precioUnitario: 100,
          tipoDescuento: "PORCENTAJE",
          descuento: 0,
          porcentajeDescuento: 15,
        },
      ],
    })
    await PUT(req, ctx)

    const args = editRpcArgs()
    expect(args.p_items[0].tipoDescuento).toBe("PORCENTAJE")
    expect(args.p_items[0].porcentajeDescuento).toBe(15)
    // And the totals must reflect those discounts
    expect(args.p_total).toBe(170) // 2*100 * (1 - 0.15) = 170
  })
})
