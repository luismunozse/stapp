import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createGetRequest,
  parseResponse,
} from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

import { GET, DELETE } from "@/app/api/ordenes/foto-borrador/[draftId]/route"

const ctx = (draftId = "d1") => ({ params: Promise.resolve({ draftId }) })

function mockStorage(overrides: Record<string, unknown> = {}) {
  const api = {
    download: vi.fn().mockResolvedValue({
      data: { arrayBuffer: async () => new TextEncoder().encode("bytes").buffer },
      error: null,
    }),
    remove: vi.fn().mockResolvedValue({ data: null, error: null }),
    ...overrides,
  }
  vi.mocked(supabaseAdmin.storage.from).mockReturnValue(api as never)
  return api
}

describe("GET /api/ordenes/foto-borrador/[draftId] — lectura por la PC", () => {
  beforeEach(() => vi.clearAllMocks())

  it("no devuelve el borrador de otra organización", async () => {
    mockAuthSuccess({ organizationId: "org-1" })
    const borrador = createChainMock(null, null)
    mockSupabaseFrom({ foto_borrador: borrador })

    const res = await GET(createGetRequest(), ctx())

    expect(res.status).toBe(404)
    expect(borrador.eq).toHaveBeenCalledWith("organization_id", "org-1")
  })

  it("devuelve base64 y nunca una URL", async () => {
    mockAuthSuccess()
    mockSupabaseFrom({
      foto_borrador: createChainMock({ id: "d1" }, null),
      foto_borrador_item: createChainMock(
        [{ id: "i1", storage_path: "org-1/d1/a.jpg", mime: "image/jpeg" }],
        null,
      ),
    })
    mockStorage()

    const { status, body } = await parseResponse(await GET(createGetRequest(), ctx()))

    expect(status).toBe(200)
    expect(body.items[0].data).toBe(Buffer.from("bytes").toString("base64"))
    expect(JSON.stringify(body)).not.toMatch(/https?:\/\//)
  })
})

describe("DELETE /api/ordenes/foto-borrador/[draftId] — revocación", () => {
  beforeEach(() => vi.clearAllMocks())

  it("borra los objetos del storage antes de borrar la fila", async () => {
    mockAuthSuccess()
    const borrador = createChainMock({ id: "d1" }, null)
    mockSupabaseFrom({
      foto_borrador: borrador,
      foto_borrador_item: createChainMock([{ storage_path: "org-1/d1/a.jpg" }], null),
    })
    const storage = mockStorage()

    const res = await DELETE(createGetRequest(), ctx())

    expect(res.status).toBe(200)
    expect(storage.remove).toHaveBeenCalledWith(["org-1/d1/a.jpg"])
    expect(borrador.delete).toHaveBeenCalled()
  })

  it("no borra el borrador de otra organización", async () => {
    mockAuthSuccess({ organizationId: "org-1" })
    const borrador = createChainMock(null, null)
    mockSupabaseFrom({ foto_borrador: borrador })

    const res = await DELETE(createGetRequest(), ctx())

    expect(res.status).toBe(404)
    expect(borrador.delete).not.toHaveBeenCalled()
  })
})
