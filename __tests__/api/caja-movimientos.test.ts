import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  mockAuthError,
  createChainMock,
  mockSupabaseFrom,
  createPostRequest,
  parseResponse,
} from "./helpers"

import { POST } from "@/app/api/caja/movimientos/route"

const validBody = {
  tipo: "INGRESO" as const,
  monto: 1500,
  metodoPago: "EFECTIVO",
  concepto: "Aporte de caja",
}

describe("POST /api/caja/movimientos", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 401 when not authenticated", async () => {
    mockAuthError()

    const response = await POST(
      createPostRequest(validBody, "http://localhost:3000/api/caja/movimientos")
    )
    const { status } = await parseResponse(response)

    expect(status).toBe(401)
  })

  it("el movimiento nace con sucursal_id (ADMIN => principal)", async () => {
    // ADMIN sin cookie => sucursalParaEscritura cae a la sucursal principal.
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1", userId: "u-1" })

    const insertSpy = vi
      .fn()
      .mockReturnValue(createChainMock({ id: "mov-1", tipo: "INGRESO", monto: 1500 }, null))

    mockSupabaseFrom({
      sucursales: createChainMock({ id: "suc-p" }, null), // getPrincipalId
      sesiones_caja: createChainMock(null, null), // no hay sesión abierta
      movimientos_caja: { ...createChainMock({ id: "mov-1" }, null), insert: insertSpy } as any,
    })

    const response = await POST(
      createPostRequest(validBody, "http://localhost:3000/api/caja/movimientos")
    )
    const { status } = await parseResponse(response)

    expect(status).toBe(201)
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ sucursal_id: "suc-p", organization_id: "org-1" })
    )
  })
})
