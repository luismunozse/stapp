import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  mockAuthError,
  createChainMock,
  parseResponse,
  createPostRequest,
} from "./helpers"

vi.mock("@/lib/caja-utils", () => ({
  fetchMovimientosDia: vi.fn().mockResolvedValue([]),
  computeTotales: vi.fn().mockReturnValue({
    totalIngresos: 0,
    totalEgresos: 0,
    totalIngresosEfectivo: 0,
    totalEgresosEfectivo: 0,
    totalCostosFinancieros: 0,
    totalDia: 0,
    porMetodo: {},
    porTipo: {},
    ingresoReal: 0,
  }),
}))

import { auth } from "@/lib/auth"
import { fetchMovimientosDia } from "@/lib/caja-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { POST } from "@/app/api/caja/sesiones/[id]/cerrar/route"

function createParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

const validBody = { conteoFisico: 5000 }

const mockSesion = {
  id: "ses-1",
  organization_id: "org-1",
  estado: "ABIERTA",
  saldo_inicial: "1000",
  opened_at: "2024-01-01T09:00:00Z",
  sucursal_id: "suc-B",
}

const mockUpdatedSesion = {
  ...mockSesion,
  estado: "CERRADA",
  closed_at: new Date().toISOString(),
}

describe("POST /api/caja/sesiones/[id]/cerrar — sucursal_id wiring", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 401 when not authenticated", async () => {
    mockAuthError()
    const response = await POST(createPostRequest(validBody), createParams("ses-1"))
    const { status } = await parseResponse(response)
    expect(status).toBe(401)
  })

  it("calls fetchMovimientosDia with sesion.sucursal_id as 5th argument", async () => {
    mockAuthSuccess()

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "sesiones_caja") {
        const chain = createChainMock(null)
        chain.single = vi.fn().mockResolvedValue({ data: mockSesion, error: null })
        // F3: UPDATE now uses .select() (array) instead of .single()
        const updateChain = createChainMock([mockUpdatedSesion], null)
        chain.update = vi.fn().mockReturnValue(updateChain)
        return chain as any
      }
      return createChainMock(null) as any
    })

    const response = await POST(createPostRequest(validBody), createParams("ses-1"))
    const { status } = await parseResponse(response)

    expect(status).toBe(200)

    // Verify fetchMovimientosDia was called with sucursal_id as 5th arg
    expect(fetchMovimientosDia).toHaveBeenCalledOnce()
    const callArgs = vi.mocked(fetchMovimientosDia).mock.calls[0]
    expect(callArgs[4]).toBe("suc-B")
  })

  it("passes undefined as 4th arg and sucursal_id as 5th arg", async () => {
    mockAuthSuccess()

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "sesiones_caja") {
        const chain = createChainMock(null)
        chain.single = vi.fn().mockResolvedValue({ data: mockSesion, error: null })
        // F3: UPDATE now uses .select() (array) instead of .single()
        const updateChain = createChainMock([mockUpdatedSesion], null)
        chain.update = vi.fn().mockReturnValue(updateChain)
        return chain as any
      }
      return createChainMock(null) as any
    })

    await POST(createPostRequest(validBody), createParams("ses-1"))

    const callArgs = vi.mocked(fetchMovimientosDia).mock.calls[0]
    // 4th arg should be undefined (no filters passed)
    expect(callArgs[3]).toBeUndefined()
    // 5th arg should be sucursal_id from session
    expect(callArgs[4]).toBe("suc-B")
  })
})

/**
 * El cierre pasó de requireAdmin() a requireCajaAccess(): ahora entra también
 * el VENDEDOR de una org que habilitó `vendedores_manejan_caja`.
 *
 * El ADMIN ve todas las sucursales, así que la ruta nunca necesitó preguntar
 * de qué sucursal era la sesión. El VENDEDOR está atado a la suya, y el id de
 * la sesión viaja en la URL: sin este guard, el vendedor de una sucursal
 * cierra —y arquea— la caja de otra escribiendo otro id.
 */
function mockVendedor(sucursalId: string | null) {
  vi.mocked(auth).mockResolvedValue({
    user: {
      id: "vendedor-1",
      organizationId: "org-1",
      role: "VENDEDOR",
      sucursalId,
      email: "v@v.com",
    },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any)
}

/** Sesión de suc-B + el flag de caja prendido para la org. */
function mockSesionYFlag(sesion: any = mockSesion) {
  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    if (table === "organizations") {
      return createChainMock({ vendedores_manejan_caja: true }) as any
    }
    if (table === "sesiones_caja") {
      const chain = createChainMock(null)
      chain.single = vi.fn().mockResolvedValue({ data: sesion, error: null })
      chain.update = vi.fn().mockReturnValue(createChainMock([mockUpdatedSesion], null))
      return chain as any
    }
    return createChainMock(null) as any
  })
}

describe("POST /api/caja/sesiones/[id]/cerrar — alcance por sucursal del VENDEDOR", () => {
  beforeEach(() => vi.clearAllMocks())

  it("el VENDEDOR de otra sucursal no puede cerrar la sesión: 404", async () => {
    mockVendedor("suc-A")
    mockSesionYFlag() // la sesión es de suc-B

    const response = await POST(createPostRequest(validBody), createParams("ses-1"))
    const { status } = await parseResponse(response)

    expect(status).toBe(404)
    expect(fetchMovimientosDia).not.toHaveBeenCalled()
  })

  it("el VENDEDOR sin sucursal asignada tampoco entra: fail-closed", async () => {
    mockVendedor(null)
    mockSesionYFlag()

    const response = await POST(createPostRequest(validBody), createParams("ses-1"))
    const { status } = await parseResponse(response)

    expect(status).toBe(404)
  })

  it("el VENDEDOR de la misma sucursal sí cierra su caja", async () => {
    mockVendedor("suc-B")
    mockSesionYFlag()

    const response = await POST(createPostRequest(validBody), createParams("ses-1"))
    const { status } = await parseResponse(response)

    expect(status).toBe(200)
    expect(fetchMovimientosDia).toHaveBeenCalled()
  })
})
