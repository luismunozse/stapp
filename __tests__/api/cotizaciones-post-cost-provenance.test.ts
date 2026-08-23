import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createPostRequest,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn().mockResolvedValue(true),
}))
vi.mock("@/lib/counters", () => ({
  getNextQuoteNumber: vi.fn().mockResolvedValue("COT-001"),
}))
vi.mock("@/lib/audit", () => ({
  createAuditLogger: vi.fn(() => ({
    create: vi.fn().mockResolvedValue(undefined),
  })),
}))

import { POST } from "@/app/api/cotizaciones/route"

const clienteRow = { id: "c1", organization_id: "org-1" }
const cotizacionRow = { id: "cot-1", total: 500 }
const cotizacionCompletaRow = {
  id: "cot-1",
  orden_id: null,
  cliente_id: "c1",
  sector_id: null,
  numero_cotizacion: "COT-001",
  estado: "BORRADOR",
  fecha_vencimiento: null,
  notas: null,
  subtotal: 500,
  iva: 0,
  total: 500,
  created_at: "2026-01-01T00:00:00Z",
  public_token: "tok",
  firma_aprobacion: null,
  firma_mime: null,
  fecha_aprobacion: null,
  descuento_global_tipo: "porcentaje",
  descuento_global_valor: 0,
  iva_porcentaje: 0,
  terminos: null,
  tipo: "ORDEN",
  equipo_snapshot: null,
  checklist_snapshot: null,
  convertida_a_orden_id: null,
  ordenes_servicio: null,
  clientes: null,
  sectores_cliente: null,
  items_cotizacion: [],
}

/**
 * Wires supabaseAdmin.from() per-table for a POST /api/cotizaciones flow:
 *  - clientes: .single() -> clienteRow
 *  - cotizaciones: .insert().select().single() -> cotizacionRow;
 *                  final refetch .select().eq().single() -> cotizacionCompletaRow
 *  - items_cotizacion: .insert() -> captured via insertedItemsCapture
 *  - inventario: .select().eq().in() -> invRows (plain await, no .single())
 */
function wireSupabase(opts: { invRows?: any[]; invError?: any } = {}) {
  const insertedItemsCapture: { payload: any[] | null } = { payload: null }
  const cotizacionCreated = { called: false }

  const clientesChain = createChainMock(clienteRow)

  const cotizacionesChain: any = createChainMock(cotizacionRow)
  cotizacionesChain.single = vi.fn()
    .mockResolvedValueOnce({ data: cotizacionRow, error: null }) // insert().select().single()
    .mockResolvedValueOnce({ data: cotizacionCompletaRow, error: null }) // final refetch
  const originalInsert = cotizacionesChain.insert
  cotizacionesChain.insert = vi.fn().mockImplementation((...args: any[]) => {
    cotizacionCreated.called = true
    return originalInsert(...args)
  })

  const itemsChain: any = createChainMock(null)
  itemsChain.insert = vi.fn().mockImplementation((payload: any[]) => {
    insertedItemsCapture.payload = payload
    return Promise.resolve({ data: null, error: null })
  })

  const inventarioChain = createChainMock(
    opts.invError ? null : (opts.invRows ?? []),
    opts.invError ?? null
  )

  mockSupabaseFrom({
    clientes: clientesChain,
    cotizaciones: cotizacionesChain,
    items_cotizacion: itemsChain,
    inventario: inventarioChain,
  })

  return { insertedItemsCapture, inventarioChain, cotizacionCreated }
}

function basePayload(overrides: Record<string, any> = {}) {
  return {
    tipo: "ORDEN",
    clienteId: "c1",
    items: [
      {
        descripcion: "Pantalla",
        cantidad: 1,
        precioUnitario: 500,
        unidad: "Unidad",
      },
    ],
    ...overrides,
  }
}

describe("POST /api/cotizaciones — cost provenance by role", () => {
  beforeEach(() => vi.clearAllMocks())

  it("ADMIN: uses the client-supplied costoUnitario as-is (no behavior change)", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const { insertedItemsCapture } = wireSupabase()

    const payload = basePayload({
      items: [
        { descripcion: "Pantalla", cantidad: 1, precioUnitario: 500, costoUnitario: 250, unidad: "Unidad" },
      ],
    })

    const res = await POST(createPostRequest(payload))
    const { status } = await parseResponse(res)

    expect(status).toBe(201)
    expect(insertedItemsCapture.payload![0].costo_unitario).toBe(250)
  })

  it("TECNICO: inventory-linked item derives cost from inventario.precio_compra, ignoring client-sent costoUnitario", async () => {
    mockAuthSuccess({ role: "TECNICO" })
    const { insertedItemsCapture, inventarioChain } = wireSupabase({
      invRows: [{ id: "inv-1", precio_compra: 300 }],
    })

    const payload = basePayload({
      items: [
        {
          descripcion: "Pantalla",
          cantidad: 1,
          precioUnitario: 500,
          costoUnitario: 1, // attempted spoof — must be ignored
          inventarioId: "inv-1",
          unidad: "Unidad",
        },
      ],
    })

    const res = await POST(createPostRequest(payload))
    const { status } = await parseResponse(res)

    expect(status).toBe(201)
    expect(insertedItemsCapture.payload![0].costo_unitario).toBe(300)
    expect(inventarioChain.eq).toHaveBeenCalledWith("organization_id", "org-1")
  })

  it("TECNICO: free-text item (no inventarioId) gets null cost, ignoring client-sent costoUnitario", async () => {
    mockAuthSuccess({ role: "TECNICO" })
    const { insertedItemsCapture } = wireSupabase()

    const payload = basePayload({
      items: [
        { descripcion: "Mano de obra", cantidad: 1, precioUnitario: 500, costoUnitario: 999, unidad: "Servicio" },
      ],
    })

    const res = await POST(createPostRequest(payload))
    const { status } = await parseResponse(res)

    expect(status).toBe(201)
    expect(insertedItemsCapture.payload![0].costo_unitario).toBeNull()
  })

  it("VENDEDOR: cost is also derived server-side (deliberately excluded like TECNICO, uniform ADMIN-only rule)", async () => {
    mockAuthSuccess({ role: "VENDEDOR" })
    const { insertedItemsCapture } = wireSupabase({
      invRows: [{ id: "inv-1", precio_compra: 300 }],
    })

    const payload = basePayload({
      items: [
        { descripcion: "Pantalla", cantidad: 1, precioUnitario: 500, costoUnitario: 1, inventarioId: "inv-1", unidad: "Unidad" },
      ],
    })

    const res = await POST(createPostRequest(payload))
    const { status } = await parseResponse(res)

    expect(status).toBe(201)
    expect(insertedItemsCapture.payload![0].costo_unitario).toBe(300)
  })
})

describe("POST /api/cotizaciones — query error handling on the cost-derivation select", () => {
  beforeEach(() => vi.clearAllMocks())

  it("inventario cost lookup failure returns 500 and does not create the cotización", async () => {
    mockAuthSuccess({ role: "TECNICO" })
    const { cotizacionCreated } = wireSupabase({
      invError: { message: "db unavailable" },
    })

    const payload = basePayload({
      items: [
        { descripcion: "Pantalla", cantidad: 1, precioUnitario: 500, inventarioId: "inv-1", unidad: "Unidad" },
      ],
    })

    const res = await POST(createPostRequest(payload))
    const { status } = await parseResponse(res)

    expect(status).toBe(500)
    expect(cotizacionCreated.called).toBe(false)
  })
})
