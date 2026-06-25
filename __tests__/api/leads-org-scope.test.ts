/**
 * Security: /api/leads must scope by organization_id (cross-tenant leak + IDOR).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import {
  mockAuthSuccess,
  mockSupabaseFrom,
  createChainMock,
  createGetRequest,
  createPostRequest,
  parseResponse,
} from "./helpers"

import { GET, PATCH } from "@/app/api/leads/route"
import { GET as getConversacion } from "@/app/api/leads/[id]/conversacion/route"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("GET /api/leads — org scoping", () => {
  it("filters leads by the caller's organization_id", async () => {
    mockAuthSuccess({ organizationId: "org-1" })
    const leadsChain = createChainMock([], null, 0)
    mockSupabaseFrom({ leads: leadsChain })

    await GET(createGetRequest("http://localhost:3000/api/leads"))

    expect(leadsChain.eq).toHaveBeenCalledWith("organization_id", "org-1")
  })
})

describe("PATCH /api/leads — org scoping + no organization_id mass-assign", () => {
  it("scopes the update to the caller's organization_id", async () => {
    mockAuthSuccess({ organizationId: "org-1" })
    const leadsChain = createChainMock({ id: "lead-1" })
    mockSupabaseFrom({ leads: leadsChain })

    await PATCH(
      createPostRequest({ estado: "CALIFICADO" }, "http://localhost:3000/api/leads?id=lead-1")
    )

    expect(leadsChain.eq).toHaveBeenCalledWith("organization_id", "org-1")
  })

  it("ignores organization_id sent in the body (not mass-assignable)", async () => {
    mockAuthSuccess({ organizationId: "org-1" })
    const leadsChain = createChainMock({ id: "lead-1" })
    mockSupabaseFrom({ leads: leadsChain })

    await PATCH(
      createPostRequest(
        { estado: "DESCARTADO", organization_id: "attacker-org" },
        "http://localhost:3000/api/leads?id=lead-1"
      )
    )

    // The zod schema strips organization_id, so update() never receives it.
    const updateArg = leadsChain.update.mock.calls[0][0]
    expect(updateArg).not.toHaveProperty("organization_id")
  })
})

describe("GET /api/leads/[id]/conversacion — org scoping (IDOR)", () => {
  it("returns 404 when the lead belongs to another organization", async () => {
    mockAuthSuccess({ organizationId: "org-1" })
    // Lead lookup scoped to org returns null → cross-tenant access denied.
    mockSupabaseFrom({ leads: createChainMock(null) })

    const res = await getConversacion(createGetRequest(), {
      params: Promise.resolve({ id: "foreign-lead" }),
    })
    const { status } = await parseResponse(res)
    expect(status).toBe(404)
    // The conversation table must never be queried for a foreign lead.
    expect(supabaseAdmin.from).not.toHaveBeenCalledWith("chatbot_conversaciones")
  })

  it("proceeds when the lead belongs to the caller's organization", async () => {
    mockAuthSuccess({ organizationId: "org-1" })
    mockSupabaseFrom({
      leads: createChainMock({ id: "lead-1" }),
      chatbot_conversaciones: createChainMock({ id: "conv-1" }),
      chatbot_mensajes: createChainMock([]),
    })

    const res = await getConversacion(createGetRequest(), {
      params: Promise.resolve({ id: "lead-1" }),
    })
    const { status } = await parseResponse(res)
    expect(status).toBe(200)
  })
})
