import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createGetRequest,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/sucursal", () => ({
  sucursalParaLectura: vi.fn().mockResolvedValue({ verTodas: true, sucursalId: null }),
}))

vi.mock("@/lib/db-utils", () => ({
  formatOrden: (o: any) => o,
}))

import { GET } from "@/app/api/ordenes/route"

describe("GET /api/ordenes — filtro clienteId", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("filtra por cliente_id cuando se pasa clienteId", async () => {
    mockAuthSuccess()
    const chain = createChainMock([], null, 0)
    mockSupabaseFrom({ ordenes_servicio: chain })

    await GET(createGetRequest("http://localhost:3000/api/ordenes?clienteId=c1"))

    expect(chain.eq).toHaveBeenCalledWith("cliente_id", "c1")
  })

  it("no filtra por cliente_id cuando no se pasa clienteId", async () => {
    mockAuthSuccess()
    const chain = createChainMock([], null, 0)
    mockSupabaseFrom({ ordenes_servicio: chain })

    await GET(createGetRequest("http://localhost:3000/api/ordenes"))

    const calledWithCliente = chain.eq.mock.calls.some((c) => c[0] === "cliente_id")
    expect(calledWithCliente).toBe(false)
  })
})
