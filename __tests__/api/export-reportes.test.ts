import { describe, it, expect, beforeEach, vi } from "vitest"
import { mockAuthSuccess, parseResponse } from "./helpers"

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn(),
}))

import { hasPlanFeature } from "@/lib/subscriptions"
import { GET } from "@/app/api/export/reportes/route"

describe("GET /api/export/reportes (stays gated)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 403 when the org lacks data_export", async () => {
    mockAuthSuccess()
    vi.mocked(hasPlanFeature).mockResolvedValue(false)
    const req = new Request("http://localhost:3000/api/export/reportes?type=ventas")
    const res = await GET(req)
    const { status, body } = await parseResponse(res)
    expect(status).toBe(403)
    expect(body.feature).toBe("data_export")
  })
})
