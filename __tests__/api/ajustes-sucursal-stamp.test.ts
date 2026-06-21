/**
 * PR3a — TDD test: ajustes/route.ts POST stamps p_sucursal_id via aplicar_ajuste_inventario RPC.
 *
 * Spec requirement (I-6): Write paths that create ajustes_inventario rows MUST stamp sucursal_id
 * at creation time.
 *
 * The route resolves sucursalParaEscritura and passes p_sucursal_id to the RPC.
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

import { sucursalParaEscritura, getDepositoDeSucursal } from "@/lib/sucursal"
import { supabaseAdmin } from "@/lib/supabase"
import { POST } from "@/app/api/inventario/ajustes/route"

const validBody = {
  inventarioId: "inv-1",
  tipo: "MERMA",
  direccion: "SALIDA",
  cantidad: 3,
  motivo: "producto vencido",
  afectaRentabilidad: true,
}

describe("POST /api/inventario/ajustes — sucursal_id stamping (PR3a)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 401 when not authenticated", async () => {
    mockAuthError()
    const response = await POST(createPostRequest(validBody))
    const { status } = await parseResponse(response)
    expect(status).toBe(401)
  })

  it("calls aplicar_ajuste_inventario with p_sucursal_id = null when sucursalParaEscritura returns null (no principal sucursal configured)", async () => {
    mockAuthSuccess()
    vi.mocked(sucursalParaEscritura).mockResolvedValue(null)

    // Inventory item ownership check passes
    vi.mocked(supabaseAdmin.from).mockImplementation((_table: string) =>
      createChainMock({ id: "inv-1" }) as any
    )

    // RPC succeeds
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: { success: true, id: "ajuste-1", nuevoStock: 7 },
      error: null,
    } as any)

    const response = await POST(createPostRequest(validBody))
    const { status } = await parseResponse(response)

    expect(status).toBe(201)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "aplicar_ajuste_inventario",
      expect.objectContaining({ p_sucursal_id: null })
    )
  })

  it("passes p_sucursal_id from sucursalParaEscritura to the RPC — branch A", async () => {
    mockAuthSuccess()
    vi.mocked(sucursalParaEscritura).mockResolvedValue("suc-A")
    vi.mocked(getDepositoDeSucursal).mockResolvedValue("dep-A")

    vi.mocked(supabaseAdmin.from).mockImplementation((_table: string) =>
      createChainMock({ id: "inv-1" }) as any
    )

    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: { success: true, id: "ajuste-2", nuevoStock: 5 },
      error: null,
    } as any)

    const response = await POST(createPostRequest(validBody))
    const { status, body } = await parseResponse(response)

    expect(status).toBe(201)
    expect(body.success).toBe(true)

    // The critical assertion: RPC must be called with p_sucursal_id
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "aplicar_ajuste_inventario",
      expect.objectContaining({ p_sucursal_id: "suc-A" })
    )
  })

  it("passes p_sucursal_id from sucursalParaEscritura to the RPC — branch B", async () => {
    mockAuthSuccess()
    vi.mocked(sucursalParaEscritura).mockResolvedValue("suc-B")
    vi.mocked(getDepositoDeSucursal).mockResolvedValue("dep-B")

    vi.mocked(supabaseAdmin.from).mockImplementation((_table: string) =>
      createChainMock({ id: "inv-1" }) as any
    )

    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: { success: true, id: "ajuste-3", nuevoStock: 2 },
      error: null,
    } as any)

    const response = await POST(createPostRequest(validBody))

    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "aplicar_ajuste_inventario",
      expect.objectContaining({ p_sucursal_id: "suc-B" })
    )
    const { status } = await parseResponse(response)
    expect(status).toBe(201)
  })

  it("returns 400 when RPC returns an error object", async () => {
    mockAuthSuccess()
    vi.mocked(sucursalParaEscritura).mockResolvedValue("suc-A")
    vi.mocked(getDepositoDeSucursal).mockResolvedValue("dep-A")

    vi.mocked(supabaseAdmin.from).mockImplementation((_table: string) =>
      createChainMock({ id: "inv-1" }) as any
    )

    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: { error: "Stock insuficiente. Stock actual: 0" },
      error: null,
    } as any)

    const response = await POST(createPostRequest(validBody))
    const { status, body } = await parseResponse(response)
    expect(status).toBe(400)
    expect(body.error).toContain("Stock insuficiente")
  })

  it("returns 404 when inventory item does not belong to org", async () => {
    mockAuthSuccess()
    vi.mocked(sucursalParaEscritura).mockResolvedValue("suc-A")
    vi.mocked(getDepositoDeSucursal).mockResolvedValue("dep-A")

    vi.mocked(supabaseAdmin.from).mockImplementation((_table: string) =>
      createChainMock(null) as any  // null data => item not found
    )

    const response = await POST(createPostRequest(validBody))
    const { status, body } = await parseResponse(response)
    expect(status).toBe(404)
    expect(body.error).toBeTruthy()
  })
})
