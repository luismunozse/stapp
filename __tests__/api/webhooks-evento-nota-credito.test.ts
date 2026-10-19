import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, parseResponse, createPostRequest } from "./helpers"

import { POST } from "@/app/api/webhooks/route"

describe("POST /api/webhooks — evento de nota de crédito", () => {
  beforeEach(() => vi.clearAllMocks())

  it("un integrador se puede suscribir a nota_credito.creada", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({
      webhooks: createChainMock({ id: "w1", name: "Contable", url: "https://contable.example/hook", events: ["nota_credito.creada"], activo: true, secret: "s" }),
    })
    const { status, body } = await parseResponse(
      await POST(createPostRequest(
        { name: "Contable", url: "https://contable.example/hook", events: ["nota_credito.creada"] },
        "http://localhost/api/webhooks"
      ))
    )
    expect(status).toBe(201)
    expect(body.events).toEqual(["nota_credito.creada"])
  })

  it("un integrador se puede suscribir a nota_credito.anulada", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({
      webhooks: createChainMock({ id: "w2", name: "Contable", url: "https://contable.example/hook", events: ["nota_credito.anulada"], activo: true, secret: "s" }),
    })
    const { status, body } = await parseResponse(
      await POST(createPostRequest(
        { name: "Contable", url: "https://contable.example/hook", events: ["nota_credito.anulada"] },
        "http://localhost/api/webhooks"
      ))
    )
    expect(status).toBe(201)
    expect(body.events).toEqual(["nota_credito.anulada"])
  })
})
