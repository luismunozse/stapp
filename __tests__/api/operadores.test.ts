// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, parseResponse } from "./helpers"
import { GET } from "@/app/api/operadores/route"

describe("GET /api/operadores", () => {
  beforeEach(() => vi.clearAllMocks())

  it("devuelve usuarios activos de la org", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({
      users: createChainMock([
        { id: "u1", nombre: "Ana", rol: "VENDEDOR" },
        { id: "u2", nombre: "Beto", rol: "ADMIN" },
      ]),
    })
    const res = await GET(new Request("http://localhost/api/operadores"))
    const { status, body } = await parseResponse(res)
    expect(status).toBe(200)
    expect(body.map((o: any) => o.id)).toEqual(["u1", "u2"])
  })
})
