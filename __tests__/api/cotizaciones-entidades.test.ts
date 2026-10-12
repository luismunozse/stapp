import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, parseResponse } from "./helpers"
import { GET } from "@/app/api/cotizaciones/entidades/route"

describe("GET /api/cotizaciones/entidades", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("devuelve las entidades unicas y ordenadas de la organizacion", async () => {
    mockAuthSuccess()
    mockSupabaseFrom({
      cotizaciones: createChainMock([
        { presentado_ante: "Provincia Seguros" },
        { presentado_ante: "La Segunda ART" },
        { presentado_ante: "Provincia Seguros" },
        { presentado_ante: "  La Segunda ART  " },
      ]),
    })

    const res = await GET()
    const { body } = await parseResponse(res)

    expect(body.entidades).toEqual(["La Segunda ART", "Provincia Seguros"])
  })

  it("descarta strings vacios", async () => {
    mockAuthSuccess()
    mockSupabaseFrom({
      cotizaciones: createChainMock([
        { presentado_ante: "" },
        { presentado_ante: "   " },
        { presentado_ante: "Sancor" },
      ]),
    })

    const res = await GET()
    const { body } = await parseResponse(res)

    expect(body.entidades).toEqual(["Sancor"])
  })
})
