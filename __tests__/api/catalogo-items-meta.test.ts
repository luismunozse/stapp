// __tests__/api/catalogo-items-meta.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { mockAuthSuccess, mockAuthError, createChainMock, parseResponse } from "./helpers"
import { GET } from "@/app/api/catalogo/items/meta/route"

function mockTablesSeq(tagsChain: any, sinImgChain: any) {
  let call = 0
  vi.mocked(supabaseAdmin.from).mockImplementation(() => (call++ === 0 ? tagsChain : sinImgChain) as any)
}

describe("GET /api/catalogo/items/meta", () => {
  beforeEach(() => vi.clearAllMocks())

  it("401 when unauthenticated", async () => {
    mockAuthError()
    const res = await GET()
    expect((await parseResponse(res)).status).toBe(401)
  })

  it("returns deduped sorted tags and sinImagenCount", async () => {
    mockAuthSuccess()
    const tagsChain = createChainMock([
      { etiquetas: ["rojo", "oferta"] },
      { etiquetas: ["rojo", "nuevo"] },
      { etiquetas: null },
    ])
    const sinImgChain = createChainMock(null, null, 4)
    mockTablesSeq(tagsChain, sinImgChain)

    const res = await GET()
    const { status, body } = await parseResponse(res)
    expect(status).toBe(200)
    expect(body.tags).toEqual(["nuevo", "oferta", "rojo"])
    expect(body.sinImagenCount).toBe(4)
  })
})
