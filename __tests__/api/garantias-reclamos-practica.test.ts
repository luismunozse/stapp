import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom } from "./helpers"

vi.mock("@/lib/counters", () => ({
  getNextOrderNumber: vi.fn().mockResolvedValue(7),
}))

import { deletePracticeData } from "@/lib/onboarding/practica"
import { PUT } from "@/app/api/garantias/[id]/reclamos/route"

const reclamo = {
  id: "r1",
  garantia_id: "g1",
  descripcion: "Volvió a fallar",
  orden_reparacion_id: null,
  garantias: {
    id: "g1",
    ordenes_servicio: {
      id: "o1",
      organization_id: "org-1",
      cliente_id: "c1",
      dispositivo: "iPhone 13",
      tipo_dispositivo: "CELULAR",
      numero_orden: 3,
    },
  },
}

describe("PUT /api/garantias/[id]/reclamos — practice cleanup", () => {
  beforeEach(() => vi.clearAllMocks())

  it("deletes the onboarding practice after creating the repair order", async () => {
    mockAuthSuccess()
    mockSupabaseFrom({
      reclamos_garantia: createChainMock(reclamo),
      ordenes_servicio: createChainMock({ id: "ord-r" }),
      orden_eventos: createChainMock(null),
    })

    const res = await PUT(
      new Request("http://localhost/api/garantias/g1/reclamos?reclamoId=r1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado: "ACEPTADO", crearOrden: true }),
      }),
      { params: Promise.resolve({ id: "g1" }) }
    )

    expect(res.status).toBe(200)
    expect(deletePracticeData).toHaveBeenCalledWith("org-1")
  })
})
