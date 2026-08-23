import { describe, it, expect, vi, beforeEach } from "vitest"
import { createPostRequest, parseResponse } from "./helpers"

vi.mock("@/lib/superadmin-auth", () => ({
  requireSuperadmin: vi.fn().mockResolvedValue({ error: null }),
}))

import { POST } from "@/app/api/superadmin/campanas/preapproval/route"

describe("POST /api/superadmin/campanas/preapproval", () => {
  beforeEach(() => vi.clearAllMocks())

  it("en simulacion NO manda ningun mail", async () => {
    const fetchSpy = vi.fn()
    global.fetch = fetchSpy as never

    const res = await POST(createPostRequest({ simulacion: true }) as never)
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.simulacion).toBe(true)
    expect(body.enviados).toBe(0)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("el modo real requiere pedirlo explicitamente", async () => {
    const res = await POST(createPostRequest({}) as never)
    const { body } = await parseResponse(res)

    // Sin decir nada, simula: mandar mails no puede ser el default.
    expect(body.simulacion).toBe(true)
  })
})
