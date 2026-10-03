import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock } from "./helpers"
import { cookies } from "next/headers"

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn().mockResolvedValue(true),
}))

import { GET } from "@/app/api/export/[entity]/route"

function exportar(query = "") {
  return GET(new NextRequest(`http://localhost:3000/api/export/ventas${query}`), {
    params: Promise.resolve({ entity: "ventas" }),
  } as any)
}

describe("GET /api/export/ventas — alcance", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(cookies).mockResolvedValue({ get: vi.fn(() => undefined), set: vi.fn() } as any)
  })

  function setup(org: Record<string, unknown> = {}) {
    const ventas = createChainMock([])
    mockSupabaseFrom({
      ventas,
      organizations: createChainMock({ zona_horaria: "America/Argentina/Buenos_Aires", tecnicos_operan_pos: false, ...org }),
      sucursales: createChainMock(null),
    })
    return ventas
  }

  it("un VENDEDOR exporta solo sus ventas (antes bajaba las de toda la org)", async () => {
    mockAuthSuccess({ role: "VENDEDOR", userId: "vend-1" })
    const ventas = setup()
    const res = await exportar()
    expect(res.status).toBe(200)
    expect(ventas.eq).toHaveBeenCalledWith("vendedor_id", "vend-1")
  })

  it("un TECNICO sin acceso al POS no exporta ventas", async () => {
    mockAuthSuccess({ role: "TECNICO" })
    setup()
    const res = await exportar()
    expect(res.status).toBe(403)
  })

  it("hasta incluye todo el último día de la organización", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const ventas = setup()
    await exportar("?desde=2026-05-01&hasta=2026-05-31")
    // 00:00 del 1/5 y 23:59:59.999 del 31/5 en Buenos Aires (UTC-3)
    expect(ventas.gte).toHaveBeenCalledWith("created_at", "2026-05-01T03:00:00.000Z")
    expect(ventas.lte).toHaveBeenCalledWith("created_at", "2026-06-01T02:59:59.999Z")
  })
})
