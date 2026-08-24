import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn().mockResolvedValue(false),
}))

import { GET } from "@/app/api/configuracion/route"

const orgSinTasa = (pais: string) => ({
  id: "org-1",
  pais,
  iva_regimen: "ADITIVO",
  iva_tasa: null,
})

describe("GET /api/configuracion — tasa de IVA por defecto segun el pais", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess()
  })

  it("devuelve 19% para una org chilena sin tasa configurada", async () => {
    mockSupabaseFrom({ organizations: createChainMock(orgSinTasa("CL")) })

    const { status, body } = await parseResponse(
      await GET()
    )

    expect(status).toBe(200)
    expect(body.ivaTasa).toBe(19)
  })

  it("sigue devolviendo 21% para una org argentina sin tasa configurada", async () => {
    mockSupabaseFrom({ organizations: createChainMock(orgSinTasa("AR")) })

    const { body } = await parseResponse(
      await GET()
    )

    expect(body.ivaTasa).toBe(21)
  })

  it("respeta la tasa guardada por la org por encima del default del pais", async () => {
    mockSupabaseFrom({
      organizations: createChainMock({ ...orgSinTasa("CL"), iva_tasa: 0 }),
    })

    const { body } = await parseResponse(
      await GET()
    )

    expect(body.ivaTasa).toBe(0)
  })
})
