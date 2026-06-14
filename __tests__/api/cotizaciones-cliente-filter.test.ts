import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createGetRequest,
} from "./helpers"

import { GET } from "@/app/api/cotizaciones/route"

describe("GET /api/cotizaciones — filtro clienteId", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("filtra por cliente_id cuando se pasa clienteId (modo standalone)", async () => {
    mockAuthSuccess()
    const chain = createChainMock([], null, 0)
    mockSupabaseFrom({ cotizaciones: chain })

    await GET(createGetRequest("http://localhost:3000/api/cotizaciones?clienteId=c1"))

    expect(chain.eq).toHaveBeenCalledWith("cliente_id", "c1")
  })

  it("no filtra por cliente_id cuando no se pasa clienteId", async () => {
    mockAuthSuccess()
    const chain = createChainMock([], null, 0)
    mockSupabaseFrom({ cotizaciones: chain })

    await GET(createGetRequest("http://localhost:3000/api/cotizaciones"))

    const calledWithCliente = chain.eq.mock.calls.some((c) => c[0] === "cliente_id")
    expect(calledWithCliente).toBe(false)
  })
})
