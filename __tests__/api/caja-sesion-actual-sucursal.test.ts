import { describe, it, expect, vi, beforeEach } from "vitest"
import { cookies } from "next/headers"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, parseResponse, createGetRequest } from "./helpers"

import { GET } from "@/app/api/caja/sesiones/route"

function mockCookie(value: string | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn((name: string) => (name === "stapp-sucursal-activa" && value ? { value } : undefined)),
    set: vi.fn(),
  } as any)
}

const url = (q: string) => `http://localhost/api/caja/sesiones?current=true${q}`

describe("GET /api/caja/sesiones?current=true — caja de una sucursal puntual", () => {
  beforeEach(() => vi.clearAllMocks())

  it("el ADMIN que mira todas las sucursales pregunta por la caja de la sucursal de la venta", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("todas")
    const sesiones = createChainMock(null)
    mockSupabaseFrom({ sesiones_caja: sesiones })

    const { status, body } = await parseResponse(await GET(createGetRequest(url("&sucursalId=suc-2"))))

    expect(status).toBe(200)
    expect(body).toEqual({ sesion: null })
    expect(sesiones.eq).toHaveBeenCalledWith("organization_id", "org-1")
    expect(sesiones.eq).toHaveBeenCalledWith("sucursal_id", "suc-2")
  })

  it("un vendedor atado a su sucursal no puede mirar la caja de otra", async () => {
    mockAuthSuccess({ role: "VENDEDOR", sucursalId: "suc-1" })
    mockCookie(null)
    const sesiones = createChainMock(null)
    mockSupabaseFrom({ sesiones_caja: sesiones })

    await GET(createGetRequest(url("&sucursalId=suc-2")))

    expect(sesiones.eq).toHaveBeenCalledWith("sucursal_id", "suc-1")
    expect(sesiones.eq).not.toHaveBeenCalledWith("sucursal_id", "suc-2")
  })

  it("sin el parámetro, el ADMIN en todas sigue como antes (sin filtro de sucursal)", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockCookie("todas")
    const sesiones = createChainMock(null)
    mockSupabaseFrom({ sesiones_caja: sesiones })

    await GET(createGetRequest(url("")))

    expect(sesiones.eq).not.toHaveBeenCalledWith("sucursal_id", expect.anything())
  })
})
