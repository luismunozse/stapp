// @vitest-environment node
/**
 * The order detail says which branch handles the order (`sucursalAtiendeId`), so the
 * screen can ask for that branch's technicians (BM-4). Until derivations exist that is
 * the branch the order was created in.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, parseResponse } from "./helpers"
import { GET } from "@/app/api/ordenes/[id]/route"

function orden(overrides: Record<string, unknown> = {}) {
  return {
    id: "o1",
    organization_id: "org-1",
    sucursal_id: "suc-A",
    tecnico_id: "tec-1",
    estado: "EN_REPARACION",
    clientes: null,
    users: null,
    recibido: null,
    repuestos_orden: [],
    cotizaciones: [],
    garantias: [],
    organizations: { nombre: "Taller" },
    ...overrides,
  }
}

async function detalle(fila: Record<string, unknown>) {
  mockSupabaseFrom({ ordenes_servicio: createChainMock(fila), orden_eventos: createChainMock(null) })
  return parseResponse(await GET(new Request("http://localhost:3000/api/ordenes/o1"), { params: Promise.resolve({ id: "o1" }) }))
}

describe("GET /api/ordenes/[id] - handling branch", () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([
    ["suc-A", "suc-A"],
    ["suc-B", "suc-B"],
  ])("an order created in %s is handled by %s", async (creada, esperada) => {
    mockAuthSuccess({ role: "ADMIN" })

    const { status, body } = await detalle(orden({ sucursal_id: creada }))

    expect(status).toBe(200)
    expect(body.sucursalAtiendeId).toBe(esperada)
  })

  it("a technician opening his assigned order from another branch gets the order's branch, not his own", async () => {
    mockAuthSuccess({ role: "TECNICO", userId: "tec-1", sucursalId: "suc-SJ" })

    const { status, body } = await detalle(orden({ sucursal_id: "suc-T", tecnico_id: "tec-1" }))

    expect(status).toBe(200)
    expect(body.sucursalAtiendeId).toBe("suc-T")
  })
})
