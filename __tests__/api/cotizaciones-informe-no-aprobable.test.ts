import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createPostRequest,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn().mockResolvedValue(true),
}))

import { supabaseAdmin } from "@/lib/supabase"
import { POST as aprobarInterna } from "@/app/api/cotizaciones/[id]/aprobar/route"

const params = { params: Promise.resolve({ id: "cot-1" }) }

describe("aprobar un informe tecnico", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: 1, error: null } as any)
  })

  it("la ruta interna rechaza un documento sin items", async () => {
    mockAuthSuccess()
    mockSupabaseFrom({
      cotizaciones: createChainMock({
        id: "cot-1",
        estado: "ENVIADA",
        organization_id: "org-1",
        orden_id: null,
        veredicto: "IRREPARABLE",
        items_cotizacion: [],
      }),
      items_cotizacion: createChainMock([], null),
    })

    const res = await aprobarInterna(createPostRequest({}), params)
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body.error).toContain("informe")
  })
})
