import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn().mockResolvedValue(true),
}))
vi.mock("@/lib/audit", () => ({
  createAuditLogger: vi.fn(() => ({
    update: vi.fn().mockResolvedValue(undefined),
  })),
}))

import { PUT } from "@/app/api/cotizaciones/[id]/route"

function createParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

function createPutRequest(body: any) {
  return new Request("http://localhost:3000/api/cotizaciones/cot-1", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

// Standalone cotización (no orden_id), so no ordenes_servicio/orden_eventos
// recalculation branches get triggered — keeps the mock surface focused on
// the items/cost logic under test.
const existingCotizacionRow = {
  id: "cot-1",
  estado: "BORRADOR",
  tipo: "ORDEN",
  organization_id: "org-1",
  created_by: "user-1",
  iva_porcentaje: 0,
  descuento_global_tipo: "porcentaje",
  descuento_global_valor: 0,
  orden_id: null,
}

const refetchedCotizacionRow = {
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
 * Wires supabaseAdmin.from() for the PUT /api/cotizaciones/[id] items-update
 * flow:
 *  - cotizaciones: 1st .single() -> existing row, 2nd .single() -> refetched
 *    row (for the response); .update() -> a separate ok chain.
 *  - items_cotizacion: plain-await .select() (existing items, non-admin only)
 *    -> existingItemRows (or existingItemsError); .delete() -> tracked;
 *    .insert() -> captured + tracked.
 *  - inventario: plain-await .select().eq().in() -> invRows (or invError).
 */
function wireSupabase(opts: {
  existingItemRows?: any[]
  existingItemsError?: any
  invRows?: any[]
  invError?: any
} = {}) {
  const insertedItemsCapture: { payload: any[] | null } = { payload: null }
  const mutationCalls = { deleteCalled: false, insertCalled: false }

  const cotizacionesChain: any = createChainMock(existingCotizacionRow)
  cotizacionesChain.single = vi.fn()
    .mockResolvedValueOnce({ data: existingCotizacionRow, error: null })
    .mockResolvedValueOnce({ data: refetchedCotizacionRow, error: null })
  const cotizUpdateChain = createChainMock(null)
  cotizacionesChain.update = vi.fn().mockReturnValue(cotizUpdateChain)

  const itemsChain: any = createChainMock(
    opts.existingItemsError ? null : (opts.existingItemRows ?? []),
    opts.existingItemsError ?? null
  )
  itemsChain.delete = vi.fn().mockImplementation(() => {
    mutationCalls.deleteCalled = true
    return itemsChain
  })
  itemsChain.insert = vi.fn().mockImplementation((payload: any[]) => {
    mutationCalls.insertCalled = true
    insertedItemsCapture.payload = payload
    return Promise.resolve({ data: null, error: null })
  })

  const inventarioChain = createChainMock(
    opts.invError ? null : (opts.invRows ?? []),
    opts.invError ?? null
  )

  mockSupabaseFrom({
    cotizaciones: cotizacionesChain,
    items_cotizacion: itemsChain,
    inventario: inventarioChain,
  })

  return { insertedItemsCapture, mutationCalls, itemsChain, inventarioChain }
}

describe("PUT /api/cotizaciones/[id] — cost preservation on non-ADMIN edits", () => {
  beforeEach(() => vi.clearAllMocks())

  it("ADMIN: uses the client-supplied costoUnitario as-is (no behavior change)", async () => {
    mockAuthSuccess({ role: "ADMIN", userId: "user-1" })
    const { insertedItemsCapture } = wireSupabase()

    const body = {
      items: [
        { id: "item-1", descripcion: "Pantalla", cantidad: 1, precioUnitario: 500, costoUnitario: 275, unidad: "Unidad" },
      ],
    }
    const res = await PUT(createPutRequest(body), createParams("cot-1"))
    const { status } = await parseResponse(res)

    expect(status).toBe(200)
    expect(insertedItemsCapture.payload![0].costo_unitario).toBe(275)
  })

  it("TECNICO: editing an existing item without costoUnitario preserves the DB's original cost (does not erase it)", async () => {
    mockAuthSuccess({ role: "TECNICO", userId: "user-1" })
    const { insertedItemsCapture } = wireSupabase({
      existingItemRows: [{ id: "item-1", costo_unitario: 300 }],
    })

    // TECNICO's form never received costoUnitario (GET stripped it), so the
    // edit payload for the existing item naturally omits it.
    const body = {
      items: [
        { id: "item-1", descripcion: "Pantalla (editado)", cantidad: 1, precioUnitario: 500, unidad: "Unidad" },
      ],
    }
    const res = await PUT(createPutRequest(body), createParams("cot-1"))
    const { status } = await parseResponse(res)

    expect(status).toBe(200)
    expect(insertedItemsCapture.payload![0].costo_unitario).toBe(300)
  })

  it("TECNICO: attempting to spoof costoUnitario on an existing item is ignored — DB value wins", async () => {
    mockAuthSuccess({ role: "TECNICO", userId: "user-1" })
    const { insertedItemsCapture } = wireSupabase({
      existingItemRows: [{ id: "item-1", costo_unitario: 300 }],
    })

    const body = {
      items: [
        { id: "item-1", descripcion: "Pantalla", cantidad: 1, precioUnitario: 500, costoUnitario: 1, unidad: "Unidad" },
      ],
    }
    const res = await PUT(createPutRequest(body), createParams("cot-1"))
    const { status } = await parseResponse(res)

    expect(status).toBe(200)
    expect(insertedItemsCapture.payload![0].costo_unitario).toBe(300)
  })

  it("TECNICO: a new inventory-linked item derives cost from inventario.precio_compra", async () => {
    mockAuthSuccess({ role: "TECNICO", userId: "user-1" })
    const { insertedItemsCapture } = wireSupabase({
      existingItemRows: [],
      invRows: [{ id: "inv-2", precio_compra: 450 }],
    })

    const body = {
      items: [
        {
          descripcion: "Batería",
          cantidad: 1,
          precioUnitario: 900,
          inventarioId: "inv-2",
          unidad: "Unidad",
        },
      ],
    }
    const res = await PUT(createPutRequest(body), createParams("cot-1"))
    const { status } = await parseResponse(res)

    expect(status).toBe(200)
    expect(insertedItemsCapture.payload![0].costo_unitario).toBe(450)
  })

  it("TECNICO: a new free-text item (no id, no inventarioId) gets null cost", async () => {
    mockAuthSuccess({ role: "TECNICO", userId: "user-1" })
    const { insertedItemsCapture } = wireSupabase({ existingItemRows: [] })

    const body = {
      items: [
        { descripcion: "Mano de obra", cantidad: 1, precioUnitario: 500, costoUnitario: 999, unidad: "Servicio" },
      ],
    }
    const res = await PUT(createPutRequest(body), createParams("cot-1"))
    const { status } = await parseResponse(res)

    expect(status).toBe(200)
    expect(insertedItemsCapture.payload![0].costo_unitario).toBeNull()
  })

  it("TECNICO: relinking an existing item to a DIFFERENT inventario product re-derives cost from the NEW product (does not keep the old preserved cost)", async () => {
    mockAuthSuccess({ role: "TECNICO", userId: "user-1" })
    const { insertedItemsCapture } = wireSupabase({
      existingItemRows: [{ id: "item-1", costo_unitario: 300, inventario_id: "inv-OLD" }],
      invRows: [{ id: "inv-NEW", precio_compra: 777 }],
    })

    const body = {
      items: [
        {
          id: "item-1",
          descripcion: "Batería (cambiada)",
          cantidad: 1,
          precioUnitario: 900,
          inventarioId: "inv-NEW",
          unidad: "Unidad",
        },
      ],
    }
    const res = await PUT(createPutRequest(body), createParams("cot-1"))
    const { status } = await parseResponse(res)

    expect(status).toBe(200)
    expect(insertedItemsCapture.payload![0].costo_unitario).toBe(777)
  })

  it("TECNICO: a stale item id still preserves the cost of the matching free-text line", async () => {
    mockAuthSuccess({ role: "TECNICO", userId: "user-1" })
    const { insertedItemsCapture } = wireSupabase({
      existingItemRows: [
        { id: "item-FRESH", descripcion: "Mano de obra", costo_unitario: 300, inventario_id: null },
      ],
    })

    // The handler deletes every row and re-inserts fresh ones on each PUT, so
    // ids are not stable. A second tab — or the SWR cache in cotizacion-list,
    // which sets revalidateOnFocus: false — submits the id it read before the
    // last save. Keying preservation on that id alone missed, and a free-text
    // item has nothing to re-derive from, so an ADMIN's manual cost was
    // silently destroyed.
    const body = {
      items: [
        { id: "item-STALE", descripcion: "Mano de obra", cantidad: 1, precioUnitario: 500, unidad: "Servicio" },
      ],
    }
    const res = await PUT(createPutRequest(body), createParams("cot-1"))
    const { status } = await parseResponse(res)

    expect(status).toBe(200)
    expect(insertedItemsCapture.payload![0].costo_unitario).toBe(300)
  })

  it("TECNICO: a stale item id matches on descripción regardless of surrounding whitespace and case", async () => {
    mockAuthSuccess({ role: "TECNICO", userId: "user-1" })
    const { insertedItemsCapture } = wireSupabase({
      existingItemRows: [
        { id: "item-FRESH", descripcion: "Mano de obra", costo_unitario: 300, inventario_id: null },
      ],
    })

    const body = {
      items: [
        { id: "item-STALE", descripcion: "  MANO DE OBRA ", cantidad: 1, precioUnitario: 500, unidad: "Servicio" },
      ],
    }
    const res = await PUT(createPutRequest(body), createParams("cot-1"))
    const { status } = await parseResponse(res)

    expect(status).toBe(200)
    expect(insertedItemsCapture.payload![0].costo_unitario).toBe(300)
  })

  it("TECNICO: a stale item id preserves the stored cost of the matching linked line", async () => {
    mockAuthSuccess({ role: "TECNICO", userId: "user-1" })
    const { insertedItemsCapture } = wireSupabase({
      existingItemRows: [
        { id: "item-FRESH", descripcion: "Pantalla", costo_unitario: 300, inventario_id: "inv-1" },
      ],
      // The inventory price drifted since the cost was recorded; a natural-key
      // hit means the link did NOT change, so the stored cost still applies.
      invRows: [{ id: "inv-1", precio_compra: 999 }],
    })

    const body = {
      items: [
        {
          id: "item-STALE",
          descripcion: "Pantalla",
          cantidad: 1,
          precioUnitario: 500,
          inventarioId: "inv-1",
          unidad: "Unidad",
        },
      ],
    }
    const res = await PUT(createPutRequest(body), createParams("cot-1"))
    const { status } = await parseResponse(res)

    expect(status).toBe(200)
    expect(insertedItemsCapture.payload![0].costo_unitario).toBe(300)
  })

  it("TECNICO: a stale id whose natural key is ambiguous falls back instead of guessing a cost", async () => {
    mockAuthSuccess({ role: "TECNICO", userId: "user-1" })
    const { insertedItemsCapture } = wireSupabase({
      // Two free-text lines share descripción and link but disagree on cost:
      // there is no single right answer, so no cost is carried over.
      existingItemRows: [
        { id: "item-A", descripcion: "Mano de obra", costo_unitario: 300, inventario_id: null },
        { id: "item-B", descripcion: "Mano de obra", costo_unitario: 900, inventario_id: null },
      ],
    })

    const body = {
      items: [
        { id: "item-STALE", descripcion: "Mano de obra", cantidad: 1, precioUnitario: 500, unidad: "Servicio" },
      ],
    }
    const res = await PUT(createPutRequest(body), createParams("cot-1"))
    const { status } = await parseResponse(res)

    expect(status).toBe(200)
    expect(insertedItemsCapture.payload![0].costo_unitario).toBeNull()
  })

  it("TECNICO: duplicate lines that agree on cost are not ambiguous — the shared cost is preserved", async () => {
    mockAuthSuccess({ role: "TECNICO", userId: "user-1" })
    const { insertedItemsCapture } = wireSupabase({
      existingItemRows: [
        { id: "item-A", descripcion: "Mano de obra", costo_unitario: 300, inventario_id: null },
        { id: "item-B", descripcion: "Mano de obra", costo_unitario: 300, inventario_id: null },
      ],
    })

    const body = {
      items: [
        { id: "item-STALE", descripcion: "Mano de obra", cantidad: 1, precioUnitario: 500, unidad: "Servicio" },
      ],
    }
    const res = await PUT(createPutRequest(body), createParams("cot-1"))
    const { status } = await parseResponse(res)

    expect(status).toBe(200)
    expect(insertedItemsCapture.payload![0].costo_unitario).toBe(300)
  })

  it("TECNICO: a genuinely new line (no id) does not inherit the cost of a same-named existing line", async () => {
    mockAuthSuccess({ role: "TECNICO", userId: "user-1" })
    const { insertedItemsCapture } = wireSupabase({
      existingItemRows: [
        { id: "item-1", descripcion: "Mano de obra", costo_unitario: 300, inventario_id: null },
      ],
    })

    // The natural key only rescues a client that CLAIMS the line already
    // exists (it sent an id). Without an id the line is new, and inventing a
    // cost for it from a same-named row would be fabrication.
    const body = {
      items: [
        { id: "item-1", descripcion: "Mano de obra", cantidad: 1, precioUnitario: 500, unidad: "Servicio" },
        { descripcion: "Mano de obra", cantidad: 1, precioUnitario: 500, unidad: "Servicio" },
      ],
    }
    const res = await PUT(createPutRequest(body), createParams("cot-1"))
    const { status } = await parseResponse(res)

    expect(status).toBe(200)
    expect(insertedItemsCapture.payload![0].costo_unitario).toBe(300)
    expect(insertedItemsCapture.payload![1].costo_unitario).toBeNull()
  })

  it("TECNICO: unlinking an existing item from inventario clears the cost instead of carrying over the old linked cost", async () => {
    mockAuthSuccess({ role: "TECNICO", userId: "user-1" })
    const { insertedItemsCapture } = wireSupabase({
      existingItemRows: [{ id: "item-1", costo_unitario: 300, inventario_id: "inv-1" }],
    })

    const body = {
      items: [
        {
          id: "item-1",
          descripcion: "Pantalla (desvinculada)",
          cantidad: 1,
          precioUnitario: 500,
          inventarioId: null,
          unidad: "Unidad",
        },
      ],
    }
    const res = await PUT(createPutRequest(body), createParams("cot-1"))
    const { status } = await parseResponse(res)

    expect(status).toBe(200)
    expect(insertedItemsCapture.payload![0].costo_unitario).toBeNull()
  })
})

describe("PUT /api/cotizaciones/[id] — query error handling on the new cost-resolution selects", () => {
  beforeEach(() => vi.clearAllMocks())

  it("existing-items lookup failure returns 500 and does not touch items_cotizacion", async () => {
    mockAuthSuccess({ role: "TECNICO", userId: "user-1" })
    const { mutationCalls } = wireSupabase({
      existingItemsError: { message: "db unavailable" },
    })

    const body = {
      items: [
        { id: "item-1", descripcion: "Pantalla", cantidad: 1, precioUnitario: 500, unidad: "Unidad" },
      ],
    }
    const res = await PUT(createPutRequest(body), createParams("cot-1"))
    const { status } = await parseResponse(res)

    expect(status).toBe(500)
    expect(mutationCalls.deleteCalled).toBe(false)
    expect(mutationCalls.insertCalled).toBe(false)
  })

  it("inventario cost lookup failure returns 500 and does not touch items_cotizacion", async () => {
    mockAuthSuccess({ role: "TECNICO", userId: "user-1" })
    const { mutationCalls } = wireSupabase({
      existingItemRows: [],
      invError: { message: "db unavailable" },
    })

    const body = {
      items: [
        { descripcion: "Batería", cantidad: 1, precioUnitario: 900, inventarioId: "inv-2", unidad: "Unidad" },
      ],
    }
    const res = await PUT(createPutRequest(body), createParams("cot-1"))
    const { status } = await parseResponse(res)

    expect(status).toBe(500)
    expect(mutationCalls.deleteCalled).toBe(false)
    expect(mutationCalls.insertCalled).toBe(false)
  })
})
