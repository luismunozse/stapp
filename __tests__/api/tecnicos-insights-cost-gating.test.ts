import { describe, it, expect, beforeEach, vi } from "vitest"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, parseResponse } from "./helpers"

import { GET } from "@/app/api/tecnicos/[id]/insights/route"

// repuestos_orden.precio_unitario is a frozen copy of inventario.precio_compra,
// so topRepuestos[].monto is a purchase-cost figure. It ships next to
// `cantidad`, which makes monto / cantidad the exact unit purchase cost.
function seed() {
  mockSupabaseFrom({
    users: createChainMock({ id: "t1", nombre: "Ana" }),
    ordenes_servicio: createChainMock([
      {
        id: "o1",
        numero_orden: 1,
        codigo_orden: "A-1",
        dispositivo: "iPhone 12",
        tipo_dispositivo: "CELULAR",
        marca: "Apple",
        estado: "ENTREGADO",
        fecha_ingreso: "2026-08-01T10:00:00.000Z",
        fecha_completado: "2026-08-02T10:00:00.000Z",
        fecha_prometida: null,
        costo_final: "10000",
        es_reingreso: false,
        repuestos_orden: [
          {
            cantidad: 2,
            precio_unitario: "1500",
            inventario_id: "inv-1",
            nombre: "Pantalla",
            inventario: { id: "inv-1", nombre: "Pantalla" },
          },
        ],
      },
    ]),
  })
}

function req() {
  return new Request("http://localhost:3000/api/tecnicos/t1/insights?dias=90")
}

const params = { params: Promise.resolve({ id: "t1" }) }

describe("GET /api/tecnicos/[id]/insights purchase-cost gating", () => {
  beforeEach(() => vi.clearAllMocks())

  it("keeps topRepuestos monto for ADMIN", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    seed()
    const res = await GET(req(), params)
    const { status, body } = await parseResponse(res)
    expect(status).toBe(200)
    expect(body.topRepuestos).toHaveLength(1)
    expect(body.topRepuestos[0].cantidad).toBe(2)
    expect(body.topRepuestos[0].monto).toBe(3000)
  })

  it("nulls topRepuestos monto for the TECNICO reading their own insights", async () => {
    mockAuthSuccess({ userId: "t1", role: "TECNICO" })
    seed()
    const res = await GET(req(), params)
    const { status, body } = await parseResponse(res)
    expect(status).toBe(200)
    expect(body.topRepuestos).toHaveLength(1)
    // Non-cost fields stay: the technician still sees what they consumed.
    expect(body.topRepuestos[0].nombre).toBe("Pantalla")
    expect(body.topRepuestos[0].cantidad).toBe(2)
    // The cost-derived figure is absent, not zeroed: a 0 reads as a real price.
    expect(body.topRepuestos[0].monto).toBeNull()
  })

  it("keeps the revenue figures visible for the gated role", async () => {
    mockAuthSuccess({ userId: "t1", role: "TECNICO" })
    seed()
    const res = await GET(req(), params)
    const { body } = await parseResponse(res)
    // costo_final is the price charged to the customer, not a purchase cost.
    expect(body.totales.ingresos).toBe(10000)
  })
})
