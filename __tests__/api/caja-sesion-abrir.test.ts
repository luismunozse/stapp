// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createPostRequest,
  parseResponse,
} from "./helpers"

import { POST } from "@/app/api/caja/sesiones/route"

// El pre-check por sucursal puede pasar y aún así el INSERT chocar contra el
// índice único parcial (race / doble-click). Ese 23505 debe mapearse a un 409
// legible, no a un 500 genérico.
describe("POST /api/caja/sesiones — apertura duplicada", () => {
  beforeEach(() => vi.clearAllMocks())

  it("mapea el 23505 del INSERT a 409 'Ya hay una sesión de caja abierta'", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1", userId: "u-1" })

    // Mismo chain para el pre-check (maybeSingle => sin sesión) y el INSERT
    // (single => violación de unicidad 23505).
    const sesionChain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      single: vi.fn().mockResolvedValue({
        data: null,
        error: { code: "23505", message: "duplicate key", details: "", hint: null },
      }),
    }

    mockSupabaseFrom({
      sucursales: createChainMock({ id: "suc-p" }, null), // getPrincipalId
      sesiones_caja: sesionChain,
    })

    const res = await POST(
      createPostRequest({ saldoInicial: 1000 }, "http://localhost:3000/api/caja/sesiones")
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(409)
    expect(body.error).toMatch(/ya hay una sesión de caja abierta/i)
  })
})
