import { describe, it, expect, vi, beforeEach } from "vitest"
import sharp from "sharp"
import { createChainMock, mockSupabaseFrom, createPostRequest, parseResponse } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"
import { hashBorradorToken, FOTO_BORRADOR_TTL_MS, MAX_FOTOS_POR_BORRADOR } from "@/lib/foto-borrador-token"

import { POST } from "@/app/api/public/carga-foto/[token]/route"

const ctx = (token: string) => ({ params: Promise.resolve({ token }) })

const vigente = (over: Record<string, unknown> = {}) => ({
  id: "d1",
  organization_id: "org-1",
  revoked_at: null,
  expires_at: new Date(Date.now() + FOTO_BORRADOR_TTL_MS).toISOString(),
  ...over,
})

const jpegValido = async () =>
  (
    await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .jpeg()
      .toBuffer()
  ).toString("base64")

function mockStorageOk() {
  const api = {
    upload: vi.fn().mockResolvedValue({ data: { path: "p" }, error: null }),
    remove: vi.fn().mockResolvedValue({ data: null, error: null }),
  }
  vi.mocked(supabaseAdmin.storage.from).mockReturnValue(api as never)
  return api
}

function mockBorrador(borrador: unknown, itemCount = 0) {
  mockSupabaseFrom({
    foto_borrador: createChainMock(borrador, null),
    foto_borrador_item: createChainMock(null, null, itemCount),
  })
}

describe("POST /api/public/carga-foto/[token] — única superficie sin auth", () => {
  beforeEach(() => vi.clearAllMocks())

  it("busca por hash, nunca por el token crudo", async () => {
    const chain = createChainMock(null, null)
    mockSupabaseFrom({ foto_borrador: chain })

    await POST(createPostRequest({ data: "x" }), ctx("token-crudo"))

    const calls = JSON.stringify(chain.eq.mock.calls)
    expect(calls).toContain(hashBorradorToken("token-crudo"))
    expect(calls).not.toContain("token-crudo")
  })

  it("responde idéntico ante token inexistente, vencido, revocado y tope alcanzado", async () => {
    const respuestas = []

    mockBorrador(null)
    respuestas.push(await parseResponse(await POST(createPostRequest({ data: "x" }), ctx("t"))))

    vi.clearAllMocks()
    mockBorrador(vigente({ expires_at: new Date(Date.now() - 1000).toISOString() }))
    respuestas.push(await parseResponse(await POST(createPostRequest({ data: "x" }), ctx("t"))))

    vi.clearAllMocks()
    mockBorrador(vigente({ revoked_at: new Date().toISOString() }))
    respuestas.push(await parseResponse(await POST(createPostRequest({ data: "x" }), ctx("t"))))

    vi.clearAllMocks()
    mockBorrador(vigente(), MAX_FOTOS_POR_BORRADOR)
    respuestas.push(await parseResponse(await POST(createPostRequest({ data: "x" }), ctx("t"))))

    // Desde afuera no se puede distinguir ningún caso: no sirve para sondear.
    for (const r of respuestas) {
      expect(r.status).toBe(respuestas[0].status)
      expect(r.body).toEqual(respuestas[0].body)
    }
  })

  it("rechaza SVG aunque el borrador esté vigente", async () => {
    mockBorrador(vigente())
    mockStorageOk()
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>').toString("base64")

    const res = await POST(createPostRequest({ data: svg }), ctx("t"))
    expect(res.status).toBe(400)
  })

  it("rechaza un payload por encima del tope de peso", async () => {
    mockBorrador(vigente())
    const storage = mockStorageOk()
    const gordo = Buffer.alloc(3 * 1024 * 1024).toString("base64")

    const res = await POST(createPostRequest({ data: gordo }), ctx("t"))

    expect(res.status).toBe(400)
    expect(storage.upload).not.toHaveBeenCalled()
  })

  it("acepta un JPEG real y lo guarda bajo el path de su organización", async () => {
    mockBorrador(vigente())
    const storage = mockStorageOk()

    const res = await POST(createPostRequest({ data: await jpegValido() }), ctx("t"))

    expect(res.status).toBe(200)
    const path = storage.upload.mock.calls[0][0] as string
    expect(path.startsWith("org-1/d1/")).toBe(true)
    expect(path.endsWith(".jpg")).toBe(true)
  })

  it("no deja el objeto huérfano si falla el insert", async () => {
    mockSupabaseFrom({
      foto_borrador: createChainMock(vigente(), null),
      foto_borrador_item: createChainMock(null, { message: "boom" }, 0),
    })
    const storage = mockStorageOk()

    const res = await POST(createPostRequest({ data: await jpegValido() }), ctx("t"))

    expect(res.status).toBe(400)
    expect(storage.remove).toHaveBeenCalled()
  })
})
