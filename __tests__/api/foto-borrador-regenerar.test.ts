import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, createPostRequest, parseResponse } from "./helpers"

import { POST } from "@/app/api/ordenes/foto-borrador/[draftId]/regenerar/route"

const ctx = (draftId = "d1") => ({ params: Promise.resolve({ draftId }) })

describe("POST .../regenerar — el token rota, las fotos quedan", () => {
  beforeEach(() => vi.clearAllMocks())

  it("emite un token nuevo y corre el vencimiento", async () => {
    mockAuthSuccess()
    const chain = createChainMock({ id: "d1" }, null)
    mockSupabaseFrom({ foto_borrador: chain })

    const { status, body } = await parseResponse(await POST(createPostRequest({}), ctx()))

    expect(status).toBe(200)
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now())

    // Se actualiza el hash; el borrador y sus fotos siguen en pie.
    expect(JSON.stringify(chain.update.mock.calls)).toContain("token_hash")
    expect(chain.delete).not.toHaveBeenCalled()
  })

  it("el token nuevo no es el anterior", async () => {
    mockAuthSuccess()
    const chain = createChainMock({ id: "d1" }, null)
    mockSupabaseFrom({ foto_borrador: chain })

    const uno = await parseResponse(await POST(createPostRequest({}), ctx()))
    const dos = await parseResponse(await POST(createPostRequest({}), ctx()))

    expect(uno.body.token).not.toBe(dos.body.token)
  })

  it("no regenera el borrador de otra organización", async () => {
    mockAuthSuccess({ organizationId: "org-1" })
    const chain = createChainMock(null, null)
    mockSupabaseFrom({ foto_borrador: chain })

    const res = await POST(createPostRequest({}), ctx())

    expect(res.status).toBe(404)
    expect(chain.eq).toHaveBeenCalledWith("organization_id", "org-1")
    expect(chain.update).not.toHaveBeenCalled()
  })
})
