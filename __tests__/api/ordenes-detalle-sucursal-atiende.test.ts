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

// The assignee picker is only useful where the server would accept the choice: the technicians it
// lists are those of the handling branch, so a user of another branch would be offered their own
// branch's technicians and every choice would be a 400. The server says it, with the branch it just
// re-read for the user (the JWT value can be hours stale).
describe("GET /api/ordenes/[id] - puedeAsignarTecnico", () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([
    ["an ADMIN, whatever branch handles the order", "ADMIN", null, "suc-A", true],
    ["a VENDEDOR of the handling branch", "VENDEDOR", "suc-A", "suc-A", true],
    ["a VENDEDOR of another branch", "VENDEDOR", "suc-B", "suc-A", false],
    ["a VENDEDOR with no branch", "VENDEDOR", null, "suc-A", false],
    ["a TECNICO, even of the handling branch (he does not reassign)", "TECNICO", "suc-A", "suc-A", false],
  ])("%s", async (_caso, role, sucursalDelUsuario, sucursalDeLaOrden, esperado) => {
    mockAuthSuccess({ role, userId: "tec-1", sucursalId: sucursalDelUsuario })

    const { status, body } = await detalle(orden({ sucursal_id: sucursalDeLaOrden, tecnico_id: "tec-1" }))

    expect(status).toBe(200)
    expect(body.puedeAsignarTecnico).toBe(esperado)
  })
})
