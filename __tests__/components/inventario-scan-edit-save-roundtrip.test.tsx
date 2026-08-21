import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { cookies } from "next/headers"
import { supabaseAdmin } from "@/lib/supabase"
import { mockAuthSuccess, createGetRequest, parseResponse } from "../api/helpers"
import { GET as barcodeGET } from "@/app/api/inventario/barcode/route"
import { InventarioForm } from "@/components/inventario/inventario-form"
import type { Inventario } from "@/types"

/**
 * Scan -> edit -> save round trip, end to end across the API/UI seam.
 *
 * inventario-list feeds the barcode endpoint's `result.item` straight into
 * setEditingItem(), which becomes <InventarioForm item={...}>, and the form
 * PUTs the whole payload back. If the endpoint stops returning the purchase
 * cost for a role that CAN write it, the round trip overwrites precio_compra
 * with 0 in the database. This test drives the real route handler so the two
 * halves cannot drift apart.
 */

vi.mock("@/contexts/modal-context", () => ({
  useModal: () => ({
    confirm: vi.fn().mockResolvedValue(false),
    alert: vi.fn().mockResolvedValue(undefined),
    showSuccess: vi.fn().mockResolvedValue(undefined),
    showError: vi.fn().mockResolvedValue(undefined),
    showWarning: vi.fn().mockResolvedValue(undefined),
    showInfo: vi.fn().mockResolvedValue(undefined),
  }),
}))

vi.mock("@/hooks/use-tipos-dispositivo", () => ({
  useTiposDispositivo: () => ({
    tipos: [{ id: "t1", codigo: "CELULAR", nombre: "Celular", config: null }],
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}))

const ITEM_ROW = {
  id: "i1",
  codigo: "ABC123",
  nombre: "Producto Test",
  categoria: "Pantallas",
  tipo_dispositivo: "CELULAR",
  stock: 10,
  stock_reservado: 1,
  precio_venta: 500,
  precio_compra: 200,
  barcode: "7890001234567",
  trackea_series: false,
  proveedor_id: null,
  organization_id: "org-1",
  deleted_at: null,
  proveedores: null,
}

function makeInventarioChain(rows: any[]) {
  const chain: any = {}
  for (const m of ["select", "eq", "ilike", "is", "order", "limit"]) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  chain.then = (resolve: any) => Promise.resolve({ data: rows, error: null }).then(resolve)
  chain.catch = (reject: any) => Promise.resolve({ data: rows, error: null }).catch(reject)
  return chain
}

// Runs the real GET /api/inventario/barcode handler as an ADMIN and returns
// the `item` the scanner hands to the list.
async function scanAsAdmin(): Promise<Inventario> {
  mockAuthSuccess({ role: "ADMIN" })
  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn(() => undefined),
    set: vi.fn(),
  } as any)
  vi.mocked(supabaseAdmin.from).mockImplementation(
    () => makeInventarioChain([ITEM_ROW]) as any
  )

  const res = await barcodeGET(
    createGetRequest("http://localhost:3000/api/inventario/barcode?code=7890001234567")
  )
  const { body } = await parseResponse(res)
  return body.item as Inventario
}

describe("ADMIN scans a barcode, edits the item and saves", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock = vi.fn((url: string) => {
      if (typeof url === "string" && url.includes("/api/proveedores")) {
        return Promise.resolve({ ok: true, json: async () => [] } as Response)
      }
      return Promise.resolve({ ok: true, json: async () => ({ id: "i1" }) } as Response)
    })
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("keeps precio_compra intact — the PUT never writes a zero cost", async () => {
    const scanned = await scanAsAdmin()
    // The endpoint must hand the real cost to a role that can write it back.
    expect(scanned.precioCompra).toBe(200)

    render(
      <InventarioForm item={scanned} onClose={vi.fn()} onSuccess={vi.fn()} />
    )

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }))

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(
        ([, init]: any[]) => init?.method === "PUT"
      )
      expect(put).toBeDefined()
      const payload = JSON.parse((put![1] as RequestInit).body as string)
      expect(payload.precioCompra).toBe(200)
    })
  })
})
