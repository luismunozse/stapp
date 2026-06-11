import { describe, it, expect, beforeEach, vi } from "vitest"
import {
  mockAuthSuccess,
  mockSupabaseFrom,
  createChainMock,
  createPostRequest,
  parseResponse,
} from "./helpers"

import { PUT } from "@/app/api/tecnicos/[id]/route"

describe("PUT /api/tecnicos/[id] costoHora", () => {
  beforeEach(() => vi.clearAllMocks())

  it("rejects a negative costoHora with 400", async () => {
    mockAuthSuccess()
    mockSupabaseFrom({
      users: createChainMock({ id: "t1", email: "t@t.com" }),
    })
    const req = createPostRequest({ costoHora: -5 }, "http://localhost:3000/api/tecnicos/t1")
    const res = await PUT(req, { params: Promise.resolve({ id: "t1" }) })
    const { status } = await parseResponse(res)
    expect(status).toBe(400)
  })

  it("persists costoHora to users.costo_hora", async () => {
    mockAuthSuccess()
    const usersChain = createChainMock({ id: "t1", email: "t@t.com", costo_hora: 1500 })
    mockSupabaseFrom({ users: usersChain })
    const req = createPostRequest({ costoHora: 1500 }, "http://localhost:3000/api/tecnicos/t1")
    const res = await PUT(req, { params: Promise.resolve({ id: "t1" }) })
    const { status } = await parseResponse(res)
    expect(status).toBe(200)
    expect(usersChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ costo_hora: 1500 })
    )
  })
})
