import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, createGetRequest } from "./helpers"

vi.mock("@/lib/sucursal", () => ({
  sucursalParaLectura: vi.fn().mockResolvedValue({ verTodas: true, sucursalId: null }),
}))

import { GET } from "@/app/api/clientes/[id]/ordenes-pendientes/route"

const ctx = { params: Promise.resolve({ id: "c1" }) } as any
const url = "http://localhost/api/clientes/c1/ordenes-pendientes"

function ordenRow(over: Partial<any> = {}) {
  return {
    id: "o1", numero_orden: 1, codigo_orden: "CEL001", dispositivo: "iPhone 11",
    costo_final: "10000", total_cobrado: "0", descuento_cobro: "0",
    estado_cobro: "PENDIENTE", estado: "ENTREGADO", ...over,
  }
}

// Regression test for the "cobrar todo" credit-minting bug: an order whose
// debt already migrated to cuenta_corriente as a CARGO (referencia_tipo=ORDEN)
// must not be listed here as pending, the same rule migration 309 applies to
// get_deuda_cliente_sucursal. Without it, cobrar-multiple-dialog.tsx posts a
// cobro for an order the client's fiado balance no longer owes, minting
// spendable credit — see app/api/clientes/[id]/ordenes-pendientes/route.ts.
describe("GET /api/clientes/[id]/ordenes-pendientes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("no lista una orden que ya tiene un CARGO de fiado", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({
      ordenes_servicio: createChainMock([ordenRow()]),
      cuenta_corriente: createChainMock([{ referencia_id: "o1" }]),
    })

    const res = await GET(createGetRequest(url), ctx)
    const json = await res.json()

    expect(json).toEqual([])
  })

  it("lista una orden pendiente sin CARGO asociado", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({
      ordenes_servicio: createChainMock([ordenRow()]),
      cuenta_corriente: createChainMock([]),
    })

    const res = await GET(createGetRequest(url), ctx)
    const json = await res.json()

    expect(json).toHaveLength(1)
    expect(json[0].id).toBe("o1")
  })

  it("excluye solo la orden con CARGO en un lote mixto", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({
      ordenes_servicio: createChainMock([ordenRow({ id: "o1" }), ordenRow({ id: "o2" })]),
      cuenta_corriente: createChainMock([{ referencia_id: "o1" }]),
    })

    const res = await GET(createGetRequest(url), ctx)
    const json = await res.json()

    expect(json.map((o: { id: string }) => o.id)).toEqual(["o2"])
  })

  it("excluye la orden aunque el CARGO ya haya sido revertido", async () => {
    // Mismo criterio que migracion 309: excluida "reverted or not". El
    // endpoint no filtra por revertido_at porque la query ni lo pide.
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({
      ordenes_servicio: createChainMock([ordenRow()]),
      cuenta_corriente: createChainMock([{ referencia_id: "o1" }]),
    })

    const res = await GET(createGetRequest(url), ctx)
    const json = await res.json()

    expect(json).toEqual([])
  })
})
