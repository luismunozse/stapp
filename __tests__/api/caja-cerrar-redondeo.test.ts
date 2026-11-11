import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, parseResponse, createPostRequest } from "./helpers"

vi.mock("@/lib/caja-utils", () => ({
  fetchMovimientosDia: vi.fn().mockResolvedValue([]),
  computeTotales: vi.fn().mockReturnValue({
    totalIngresos: 0.2,
    totalEgresos: 0,
    totalIngresosEfectivo: 0.2,
    totalEgresosEfectivo: 0,
    totalCostosFinancieros: 0,
    totalDia: 0.2,
    porMetodo: {},
    porTipo: {},
    ingresoReal: 0.2,
  }),
}))

import { supabaseAdmin } from "@/lib/supabase"
import { POST } from "@/app/api/caja/sesiones/[id]/cerrar/route"

const mockSesion = {
  id: "ses-1",
  organization_id: "org-1",
  estado: "ABIERTA",
  // 0.1 (saldo) + 0.2 (ingresos) = 0.30000000000000004 sin redondear
  saldo_inicial: "0.1",
  opened_at: "2026-11-11T09:00:00Z",
  sucursal_id: null,
}

describe("POST /api/caja/sesiones/[id]/cerrar — redondeo del arqueo", () => {
  beforeEach(() => vi.clearAllMocks())

  it("saldo 0.1 + ingresos 0.2 y contado 0.3 → guarda diferencia 0 (caja cuadrada)", async () => {
    mockAuthSuccess()
    const updateSpy = vi.fn().mockReturnValue(createChainMock([{ ...mockSesion, estado: "CERRADA" }], null))
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "sesiones_caja") {
        const chain = createChainMock(null)
        chain.single = vi.fn().mockResolvedValue({ data: mockSesion, error: null })
        chain.update = updateSpy
        return chain as any
      }
      return createChainMock(null) as any
    })

    const response = await POST(createPostRequest({ conteoFisico: 0.3 }), {
      params: Promise.resolve({ id: "ses-1" }),
    })
    const { status, body } = await parseResponse(response)

    expect(status).toBe(200)
    expect(updateSpy.mock.calls[0][0].diferencia).toBe(0)
    expect(body.arqueo.esperado).toBe(0.3)
    expect(body.arqueo.diferencia).toBe(0)
  })
})
