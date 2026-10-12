/**
 * /api/inventario/ajustes debe respetar la sucursal del usuario: un
 * VENDEDOR/TECNICO de la sucursal B ajusta el deposito de B, no el de Casa
 * Central. Y un P0010 (deposito sin stock) es un 400 explicable, no un 500.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, parseResponse, createPostRequest } from "./helpers"

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

describe("POST /api/inventario/ajustes — sucursal del usuario", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(supabaseAdmin.from).mockImplementation(
      () => createChainMock({ id: "inv-1", vendedores_administran_inventario: true }) as any
    )
  })

  it("pasa la sucursal de la sesion a sucursalParaEscritura", async () => {
    mockAuthSuccess({ role: "VENDEDOR", sucursalId: "suc-B", organizationId: "org-7" })
    vi.mocked(sucursalParaEscritura).mockResolvedValue("suc-B")
    vi.mocked(getDepositoDeSucursal).mockResolvedValue("dep-B")
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: { success: true, id: "aj-1", nuevoStock: 1 },
      error: null,
    } as any)

    const res = await POST(createPostRequest(validBody))

    expect(res.status).toBe(201)
    expect(sucursalParaEscritura).toHaveBeenCalledWith({
      role: "VENDEDOR",
      organizationId: "org-7",
      userSucursalId: "suc-B",
    })
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "aplicar_ajuste_inventario",
      expect.objectContaining({ p_sucursal_id: "suc-B", p_deposito_id: "dep-B" })
    )
  })

  it("mapea P0010 a 400 con un mensaje claro en vez de 500", async () => {
    mockAuthSuccess({ role: "VENDEDOR", sucursalId: "suc-B" })
    vi.mocked(sucursalParaEscritura).mockResolvedValue("suc-B")
    vi.mocked(getDepositoDeSucursal).mockResolvedValue("dep-B")
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null,
      error: { code: "P0010", message: "Stock insuficiente en el deposito" },
    } as any)

    const res = await POST(createPostRequest(validBody))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body.error).toMatch(/stock suficiente en el depósito/i)
  })
})
