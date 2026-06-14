import { describe, it, expect, beforeEach, vi } from "vitest"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, createPostRequest, parseResponse } from "./helpers"
import { POST, GET } from "@/app/api/keys/route"

describe("/api/keys", () => {
  beforeEach(() => vi.clearAllMocks())

  it("POST creates a key and returns the raw value once", async () => {
    mockAuthSuccess()
    const chain = createChainMock({ id: "k1", name: "Integración", prefix: "stapp_live_ab" })
    mockSupabaseFrom({ api_keys: chain })
    const res = await POST(createPostRequest({ name: "Integración" }, "http://localhost:3000/api/keys"))
    const { status, body } = await parseResponse(res)
    expect(status).toBe(201)
    expect(body.key).toMatch(/^stapp_live_/)
    const insertArg = chain.insert.mock.calls[0][0]
    expect(insertArg.key_hash).toBeDefined()
    expect(insertArg.key_hash).not.toContain(body.key)
  })

  it("POST 400 without name", async () => {
    mockAuthSuccess()
    const res = await POST(createPostRequest({}, "http://localhost:3000/api/keys"))
    const { status } = await parseResponse(res)
    expect(status).toBe(400)
  })

  it("GET lists keys without secrets", async () => {
    mockAuthSuccess()
    mockSupabaseFrom({ api_keys: createChainMock([{ id: "k1", name: "x", prefix: "stapp_live_ab", last_used_at: null, activo: true, created_at: "2026-06-01" }]) })
    const res = await GET()
    const { status, body } = await parseResponse(res)
    expect(status).toBe(200)
    expect(JSON.stringify(body)).not.toContain("key_hash")
  })
})
