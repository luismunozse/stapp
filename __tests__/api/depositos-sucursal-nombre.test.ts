/**
 * GET /api/depositos expone el nombre de la sucursal de cada depósito
 * (la UI lo muestra junto al badge "Principal": hay un principal por sucursal).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, parseResponse, createGetRequest } from "./helpers"
import { cookies } from "next/headers"
import { GET } from "@/app/api/depositos/route"

describe("GET /api/depositos — sucursalNombre", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("selects the sucursales relation and maps sucursalNombre", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    vi.mocked(cookies).mockResolvedValue({
      get: vi.fn(() => undefined),
      set: vi.fn(),
    } as any)

    const rows = [
      { id: "d1", nombre: "A", principal: true, activo: true, sucursales: { nombre: "Casa Central" } },
      { id: "d2", nombre: "B", principal: false, activo: true, sucursales: null },
    ]
    const chain = createChainMock(rows)
    chain.then = (resolve: any) => resolve({ data: rows, error: null })
    mockSupabaseFrom({ depositos: chain })

    const res = await GET(createGetRequest("http://localhost:3000/api/depositos"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(chain.select).toHaveBeenCalledWith(expect.stringContaining("sucursales(nombre)"))
    expect(body.data[0].sucursalNombre).toBe("Casa Central")
    expect(body.data[1].sucursalNombre).toBeNull()
  })
})
