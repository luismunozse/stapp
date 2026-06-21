/**
 * TDD tests: inventory stock manual writes must dual-write via atomic RPCs.
 *
 * BUG 1 — PUT /api/inventario/[id]: stock changes must go through adjust_stock_atomic RPC,
 *   not direct inventario.stock update. inventario_depositos must be kept in sync.
 *
 * BUG 3 — POST /api/inventario/ajustes: aplicar_ajuste_inventario must receive p_deposito_id
 *   (resolved from sucursal), not just p_sucursal_id. Without it the RPC drains the
 *   principal deposit instead of the sucursal's deposit.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  mockAuthError,
  createChainMock,
  parseResponse,
  createPostRequest,
} from "./helpers"

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock("@/lib/sucursal", () => ({
  sucursalParaEscritura: vi.fn(),
  getDepositoDeSucursal: vi.fn(),
}))

vi.mock("@/lib/audit", () => ({
  createAuditLogger: vi.fn(() => ({
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    catch: vi.fn(),
  })),
  diffObjects: vi.fn(() => ({ before: {}, after: {} })),
}))

vi.mock("@/lib/webhooks/dispatcher", () => ({
  emitWebhookEvent: vi.fn().mockResolvedValue(undefined),
}))

import { sucursalParaEscritura, getDepositoDeSucursal } from "@/lib/sucursal"
import { supabaseAdmin } from "@/lib/supabase"
import { PUT } from "@/app/api/inventario/[id]/route"
import { POST } from "@/app/api/inventario/ajustes/route"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createPutRequest(body: any, id = "inv-1"): Request {
  return new Request(`http://localhost:3000/api/inventario/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

/** params object as Next.js passes it (a Promise) */
function makeParams(id = "inv-1") {
  return { params: Promise.resolve({ id }) }
}

const EXISTING_ITEM = {
  id: "inv-1",
  stock: 10,
  codigo: "COD-1",
  nombre: "Widget",
  organization_id: "org-1",
  deleted_at: null,
  precio_compra: "5.00",
  precio_venta: "10.00",
  proveedor: null,
  proveedor_id: null,
  stock_minimo: null,
  stock_maximo: null,
  punto_reorden: null,
  barcode: null,
  ubicacion: null,
  trackea_lotes: false,
  trackea_series: false,
  tiene_variantes: false,
  es_kit: false,
  tipo_kit: null,
  dias_alerta_vencimiento: null,
  dias_garantia_default: null,
  tipo_dispositivo: null,
  descripcion: null,
  categoria: null,
}

const UPDATED_ITEM = {
  ...EXISTING_ITEM,
  proveedores: null,
}

// ─── BUG 1: PUT /api/inventario/[id] ─────────────────────────────────────────

describe("PUT /api/inventario/[id] — stock dual-write via adjust_stock_atomic (BUG 1)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("routes stock change through adjust_stock_atomic RPC when stock differs", async () => {
    mockAuthSuccess()
    vi.mocked(sucursalParaEscritura).mockResolvedValue("suc-A")
    vi.mocked(getDepositoDeSucursal).mockResolvedValue("dep-A")

    // First call: fetch existing item. Second call: update non-stock fields.
    let callIndex = 0
    vi.mocked(supabaseAdmin.from).mockImplementation((_table: string) => {
      callIndex++
      if (callIndex === 1) {
        // fetchExistingItem
        return createChainMock(EXISTING_ITEM) as any
      }
      // update call — return updated item (without stock in payload)
      return createChainMock(UPDATED_ITEM) as any
    })

    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: { stock: 15, stockAnterior: 10, stockPosterior: 15, changed: true, movimientoId: "mov-1" },
      error: null,
    } as any)

    const response = await PUT(createPutRequest({ stock: 15 }), makeParams())
    const { status } = await parseResponse(response)

    expect(status).toBe(200)

    // CRITICAL: RPC must have been called with adjust_stock_atomic and absolute mode
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "adjust_stock_atomic",
      expect.objectContaining({
        p_mode: "absolute",
        p_value: 15,
        p_deposito_id: "dep-A",
        p_inventario_id: "inv-1",
        p_organization_id: "org-1",
      })
    )

    // CRITICAL: inventario.update() payload must NOT include a `stock` field
    const updateCalls = vi.mocked(supabaseAdmin.from).mock.calls
    // Find the update chain call — update() is called on the chain returned by from()
    // We verify by checking that no from() chain received a stock field via update()
    // The update chain mock captures what was passed to .update(...)
    // We check all mocked chains' update calls
    const fromMock = vi.mocked(supabaseAdmin.from)
    for (const call of fromMock.mock.results) {
      const chain = call.value
      if (chain?.update?.mock?.calls?.length > 0) {
        for (const updateArgs of chain.update.mock.calls) {
          expect(updateArgs[0]).not.toHaveProperty("stock")
        }
      }
    }
  })

  it("does NOT call adjust_stock_atomic when stock is not in request body", async () => {
    mockAuthSuccess()
    vi.mocked(sucursalParaEscritura).mockResolvedValue("suc-A")
    vi.mocked(getDepositoDeSucursal).mockResolvedValue("dep-A")

    let callIndex = 0
    vi.mocked(supabaseAdmin.from).mockImplementation((_table: string) => {
      callIndex++
      if (callIndex === 1) return createChainMock(EXISTING_ITEM) as any
      return createChainMock(UPDATED_ITEM) as any
    })

    const response = await PUT(createPutRequest({ nombre: "Nuevo nombre" }), makeParams())
    const { status } = await parseResponse(response)

    expect(status).toBe(200)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("does NOT call adjust_stock_atomic when stock value is unchanged (stock === existingItem.stock)", async () => {
    mockAuthSuccess()
    vi.mocked(sucursalParaEscritura).mockResolvedValue("suc-A")
    vi.mocked(getDepositoDeSucursal).mockResolvedValue("dep-A")

    let callIndex = 0
    vi.mocked(supabaseAdmin.from).mockImplementation((_table: string) => {
      callIndex++
      if (callIndex === 1) return createChainMock(EXISTING_ITEM) as any
      return createChainMock(UPDATED_ITEM) as any
    })

    // stock: 10 === existingItem.stock: 10 — no change
    const response = await PUT(createPutRequest({ stock: 10 }), makeParams())
    const { status } = await parseResponse(response)

    expect(status).toBe(200)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("returns 500 when adjust_stock_atomic RPC returns an error", async () => {
    mockAuthSuccess()
    vi.mocked(sucursalParaEscritura).mockResolvedValue("suc-A")
    vi.mocked(getDepositoDeSucursal).mockResolvedValue("dep-A")

    let callIndex = 0
    vi.mocked(supabaseAdmin.from).mockImplementation((_table: string) => {
      callIndex++
      if (callIndex === 1) return createChainMock(EXISTING_ITEM) as any
      return createChainMock(UPDATED_ITEM) as any
    })

    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null,
      error: { message: "Stock negativo", code: "P0003" },
    } as any)

    const response = await PUT(createPutRequest({ stock: 0 }), makeParams())
    const { status } = await parseResponse(response)

    expect(status).toBe(500)
  })

  it("does NOT insert directly into movimientos_inventario (old behavior replaced by RPC)", async () => {
    mockAuthSuccess()
    vi.mocked(sucursalParaEscritura).mockResolvedValue("suc-A")
    vi.mocked(getDepositoDeSucursal).mockResolvedValue("dep-A")

    let callIndex = 0
    const movimientoChain = createChainMock(null, null)
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      callIndex++
      if (callIndex === 1) return createChainMock(EXISTING_ITEM) as any
      if (table === "movimientos_inventario") return movimientoChain as any
      return createChainMock(UPDATED_ITEM) as any
    })

    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: { stock: 15, stockPosterior: 15, changed: true, movimientoId: "mov-1" },
      error: null,
    } as any)

    await PUT(createPutRequest({ stock: 15 }), makeParams())

    // movimientos_inventario.insert() must NOT have been called directly
    expect(movimientoChain.insert).not.toHaveBeenCalled()
  })
})

// ─── BUG 3: POST /api/inventario/ajustes ─────────────────────────────────────

const validAjusteBody = {
  inventarioId: "inv-1",
  tipo: "MERMA",
  direccion: "SALIDA",
  cantidad: 3,
  motivo: "producto vencido",
  afectaRentabilidad: true,
}

describe("POST /api/inventario/ajustes — p_deposito_id must be passed to RPC (BUG 3)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("passes p_deposito_id resolved from sucursal to aplicar_ajuste_inventario", async () => {
    mockAuthSuccess()
    vi.mocked(sucursalParaEscritura).mockResolvedValue("suc-A")
    vi.mocked(getDepositoDeSucursal).mockResolvedValue("dep-A")

    vi.mocked(supabaseAdmin.from).mockImplementation((_table: string) =>
      createChainMock({ id: "inv-1" }) as any
    )

    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: { success: true, id: "ajuste-1", nuevoStock: 7 },
      error: null,
    } as any)

    const response = await POST(createPostRequest(validAjusteBody))
    const { status } = await parseResponse(response)

    expect(status).toBe(201)
    expect(getDepositoDeSucursal).toHaveBeenCalledWith("org-1", "suc-A")
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "aplicar_ajuste_inventario",
      expect.objectContaining({
        p_sucursal_id: "suc-A",
        p_deposito_id: "dep-A",
      })
    )
  })

  it("passes p_deposito_id: null when sucursalParaEscritura returns null", async () => {
    mockAuthSuccess()
    vi.mocked(sucursalParaEscritura).mockResolvedValue(null)
    vi.mocked(getDepositoDeSucursal).mockResolvedValue("dep-principal")

    vi.mocked(supabaseAdmin.from).mockImplementation((_table: string) =>
      createChainMock({ id: "inv-1" }) as any
    )

    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: { success: true, id: "ajuste-2", nuevoStock: 5 },
      error: null,
    } as any)

    const response = await POST(createPostRequest(validAjusteBody))
    const { status } = await parseResponse(response)

    expect(status).toBe(201)
    // getDepositoDeSucursal should NOT be called when sucursalId is null
    expect(getDepositoDeSucursal).not.toHaveBeenCalled()
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "aplicar_ajuste_inventario",
      expect.objectContaining({
        p_sucursal_id: null,
        p_deposito_id: null,
      })
    )
  })

  it("returns 401 when not authenticated", async () => {
    mockAuthError()
    const response = await POST(createPostRequest(validAjusteBody))
    const { status } = await parseResponse(response)
    expect(status).toBe(401)
  })
})
