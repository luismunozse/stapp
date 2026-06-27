// __tests__/api/chatbot-capture-lead.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const upsertMock = vi.fn()
vi.mock("@/lib/chatbot/upsert-lead", () => ({
  upsertLeadFromConversation: (...args: unknown[]) => upsertMock(...args),
}))

// supabaseAdmin: encadenable; .single() de la creación de conversación devuelve un id.
const convInsertSingle = vi.fn().mockResolvedValue({ data: { id: "conv-new", session_id: "s1" }, error: null })
const convSelectMaybe = vi.fn().mockResolvedValue({ data: null }) // no existe -> se crea
vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: convSelectMaybe }) }) }),
      insert: () => ({ select: () => ({ single: convInsertSingle }) }),
    }),
  },
}))

vi.mock("next/headers", () => ({
  headers: async () => ({ get: () => "test" }),
}))

import { POST } from "@/app/api/chatbot/capture-lead/route"

function req(body: unknown) {
  return new Request("http://localhost/api/chatbot/capture-lead", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/chatbot/capture-lead", () => {
  beforeEach(() => {
    upsertMock.mockReset().mockResolvedValue({ leadId: "lead-1", created: true })
    convSelectMaybe.mockResolvedValue({ data: null })
  })

  it("crea la conversación si no viene conversacionId y captura el lead", async () => {
    const res = await POST(req({ sessionId: "s1", nombre: "Juan", telefono: "5491112345678", fuente: "form" }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    // se llamó al upsert con la conversación recién creada y score 85
    const [, , data] = upsertMock.mock.calls[0]
    expect(data.score).toBe(85)
    expect(data.interes).toBe("Pidió ser contactado (chatbot)")
  })

  it("rechaza si no hay ningún dato de contacto", async () => {
    const res = await POST(req({ sessionId: "s1", fuente: "form" }))
    expect(res.status).toBe(400)
  })

  it("captura el lead con score null e interes genérico cuando fuente no es form", async () => {
    const res = await POST(req({ sessionId: "s1", telefono: "1234567890" }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    const [, , data] = upsertMock.mock.calls[0]
    expect(data.score).toBeNull()
    expect(data.interes).toBe("Consulta desde chatbot")
  })
})
