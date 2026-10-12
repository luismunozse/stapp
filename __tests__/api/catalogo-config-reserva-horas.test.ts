import { describe, it, expect, beforeEach, vi } from "vitest"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, parseResponse } from "./helpers"

vi.mock("@/lib/catalogo/revalidate", () => ({ revalidateCatalogo: vi.fn() }))

import { PUT } from "@/app/api/catalogo/config/route"

const put = (body: unknown) =>
  PUT(new Request("http://localhost:3000/api/catalogo/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }))

describe("PUT /api/catalogo/config — reserva_horas", () => {
  let configChain: ReturnType<typeof createChainMock>

  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN" })
    configChain = createChainMock({ slug: "taller", reserva_horas: 72 })
    mockSupabaseFrom({ catalogo_config: configChain })
  })

  it.each([1, 48, 720])("accepts %i hours and saves it", async (h) => {
    const { status } = await parseResponse(await put({ reserva_horas: h }))
    expect(status).toBe(200)
    expect(configChain.update).toHaveBeenCalledWith(expect.objectContaining({ reserva_horas: h }))
  })

  it.each([0, 721, -5, 1.5, "48"])("rejects %s with 400 and does not write", async (h) => {
    const { status } = await parseResponse(await put({ reserva_horas: h }))
    expect(status).toBe(400)
    expect(configChain.update).not.toHaveBeenCalled()
  })

  it("does not send reserva_horas when the body omits it (keeps old clients working pre-migration)", async () => {
    await put({ titulo: "Nuevo" })
    expect(configChain.update).toHaveBeenCalledWith(expect.not.objectContaining({ reserva_horas: expect.anything() }))
  })
})
