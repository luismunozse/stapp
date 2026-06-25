/**
 * Security: /api/health is anonymous — it must not leak version / uptime / DB latency.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockSupabaseFrom, createChainMock, parseResponse } from "./helpers"
import { GET } from "@/app/api/health/route"

beforeEach(() => vi.clearAllMocks())

describe("GET /api/health — no info disclosure", () => {
  it("returns status without version, uptime, or db latency", async () => {
    mockSupabaseFrom({ organizations: createChainMock([{ id: "org-1" }]) })

    const res = await GET()
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.status).toBe("healthy")
    expect(body).not.toHaveProperty("version")
    expect(body).not.toHaveProperty("uptime")
    expect(body.services?.database).not.toHaveProperty("latency_ms")
  })
})
