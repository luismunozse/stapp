// @vitest-environment node
/**
 * El chatbot público llama a Anthropic: además del tope por sessionId (que
 * elige el cliente) tiene topes compartidos por IP y uno global por día, y los
 * corta antes de tocar la base o el modelo.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const rateLimitDb = vi.fn()
vi.mock("@/lib/rate-limit-db", () => ({ rateLimitDb: (...a: unknown[]) => rateLimitDb(...a) }))

const from = vi.fn(() => {
  throw new Error("no debería tocar la base")
})
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: { from: (...a: unknown[]) => from(...(a as [])) } }))

const create = vi.fn()
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: (...a: unknown[]) => create(...a) }
  },
}))

vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers({ "x-vercel-forwarded-for": "203.0.113.9", "x-forwarded-for": "1.1.1.1, 203.0.113.9" }),
}))

import { POST } from "@/app/api/chatbot/route"

let n = 0
const req = () =>
  new Request("http://localhost/api/chatbot", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // sessionId distinto cada vez: el tope en memoria por sesión no interviene.
    body: JSON.stringify({ sessionId: `s-${++n}`, message: "hola" }),
  })

describe("POST /api/chatbot — topes de costo", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("corta por IP (la del CDN, no la que manda el cliente) sin tocar base ni modelo", async () => {
    rateLimitDb.mockImplementation(async (key: string) => !key.startsWith("chatbot:ip10m:"))
    const res = await POST(req())
    expect(res.status).toBe(429)
    expect(rateLimitDb).toHaveBeenCalledWith("chatbot:ip10m:203.0.113.9", 20, 600)
    expect(from).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it("corta por el tope diario de la IP", async () => {
    rateLimitDb.mockImplementation(async (key: string) => !key.startsWith("chatbot:ipdia:"))
    const res = await POST(req())
    expect(res.status).toBe(429)
    expect(create).not.toHaveBeenCalled()
  })

  it("corta por el tope global del día con un mensaje de contacto", async () => {
    rateLimitDb.mockImplementation(async (key: string) => key !== "chatbot:global")
    const res = await POST(req())
    const body = await res.json()
    expect(res.status).toBe(429)
    expect(body.error).toMatch(/no está disponible/)
    expect(from).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })
})
