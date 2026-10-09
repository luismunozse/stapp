import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, parseResponse } from "./helpers"

import { GET } from "@/app/api/inventario/[id]/depositos/route"

const ctx = { params: Promise.resolve({ id: "inv-1" }) }

function wire() {
  mockSupabaseFrom({
    inventario: createChainMock({ id: "inv-1", nombre: "Item", stock: 10, stock_reservado: 0 }),
    depositos: createChainMock([
      { id: "dep-a", nombre: "A", principal: true, activo: true, deleted_at: null, sucursal_id: "suc-1", sucursales: null },
      { id: "dep-b", nombre: "B", principal: false, activo: true, deleted_at: null, sucursal_id: "suc-2", sucursales: null },
      { id: "dep-c", nombre: "C", principal: false, activo: false, deleted_at: null, sucursal_id: "suc-1", sucursales: null },
    ]),
    inventario_depositos: createChainMock([]),
  })
}

async function puedeOrigenPorDeposito() {
  const { body } = await parseResponse(await GET(new Request("http://localhost/x"), ctx))
  return Object.fromEntries(body.data.map((r: any) => [r.depositoId, r.puedeOrigen]))
}

describe("GET /api/inventario/[id]/depositos — puedeOrigen", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    wire()
  })

  it("ADMIN puede originar desde cualquier sucursal, pero no desde uno inactivo", async () => {
    mockAuthSuccess({ role: "ADMIN", sucursalId: "suc-1" })
    expect(await puedeOrigenPorDeposito()).toEqual({ "dep-a": true, "dep-b": true, "dep-c": false })
  })

  it("no-admin solo puede originar desde depositos de su sucursal", async () => {
    mockAuthSuccess({ role: "VENDEDOR", sucursalId: "suc-1" })
    expect(await puedeOrigenPorDeposito()).toEqual({ "dep-a": true, "dep-b": false, "dep-c": false })
  })

  it("no-admin sin sucursal no puede originar desde ninguno (fail-closed)", async () => {
    mockAuthSuccess({ role: "TECNICO", sucursalId: null })
    expect(await puedeOrigenPorDeposito()).toEqual({ "dep-a": false, "dep-b": false, "dep-c": false })
  })
})
