import { describe, it, expect, beforeEach, vi } from "vitest"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, parseResponse } from "./helpers"

vi.mock("@/lib/catalogo/revalidate", () => ({ revalidateCatalogo: vi.fn() }))

import { PUT } from "@/app/api/catalogo/config/route"

function put(body: unknown) {
  return PUT(
    new Request("http://localhost:3000/api/catalogo/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  )
}

describe("PUT /api/catalogo/config — whatsapp", () => {
  let configChain: ReturnType<typeof createChainMock>

  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN" })
    configChain = createChainMock({ slug: "taller", whatsapp: "541112345678" })
    mockSupabaseFrom({
      catalogo_config: configChain,
      organizations: createChainMock({ pais: "AR" }),
    })
  })

  it("rechaza un número que no puede ser internacional, con mensaje claro", async () => {
    const { status, body } = await parseResponse(await put({ whatsapp: "1234-5678" }))
    expect(status).toBe(400)
    expect(body.error).toMatch(/WhatsApp/)
    expect(configChain.update).not.toHaveBeenCalled()
  })

  it("guarda el número normalizado con código de país", async () => {
    const { status } = await parseResponse(await put({ whatsapp: "11 1234-5678" }))
    expect(status).toBe(200)
    expect(configChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ whatsapp: "541112345678" })
    )
  })

  it("permite borrar el número (null)", async () => {
    const { status } = await parseResponse(await put({ whatsapp: null }))
    expect(status).toBe(200)
    expect(configChain.update).toHaveBeenCalledWith(expect.objectContaining({ whatsapp: null }))
  })

  it("no bloquea el guardado de otros campos si el número viejo no cambió", async () => {
    configChain = createChainMock({ slug: "taller", whatsapp: "12345678" })
    mockSupabaseFrom({ catalogo_config: configChain, organizations: createChainMock({ pais: "AR" }) })
    const { status } = await parseResponse(await put({ titulo: "Nuevo", whatsapp: "12345678" }))
    expect(status).toBe(200)
    expect(configChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ titulo: "Nuevo", whatsapp: "12345678" })
    )
  })

  it("rechaza un número inválido que sí cambió respecto del guardado", async () => {
    configChain = createChainMock({ slug: "taller", whatsapp: "12345678" })
    mockSupabaseFrom({ catalogo_config: configChain, organizations: createChainMock({ pais: "AR" }) })
    const { status } = await parseResponse(await put({ whatsapp: "8765-4321" }))
    expect(status).toBe(400)
    expect(configChain.update).not.toHaveBeenCalled()
  })

  it("un valor solo con espacios borra el número", async () => {
    const { status } = await parseResponse(await put({ whatsapp: "   " }))
    expect(status).toBe(200)
    expect(configChain.update).toHaveBeenCalledWith(expect.objectContaining({ whatsapp: null }))
  })
})
