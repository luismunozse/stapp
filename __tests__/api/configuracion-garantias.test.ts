import { describe, it, expect, vi, beforeEach } from "vitest"
import { createChainMock, mockAuthSuccess, createPostRequest } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }))

import { GET, PUT } from "@/app/api/configuracion/garantias/route"
import { revalidateTag } from "next/cache"

const put = (body: unknown) =>
  PUT(
    new Request("http://localhost/api/configuracion/garantias", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  )

describe("/api/configuracion/garantias", () => {
  let orgChain: ReturnType<typeof createChainMock>

  beforeEach(() => {
    vi.clearAllMocks()
    orgChain = createChainMock({
      garantia_terminos: "No cubre golpes.",
      garantia_ventana_por_vencer_dias: 10,
      garantia_aviso_vencimiento: false,
    })
    vi.mocked(supabaseAdmin.from).mockImplementation(() => orgChain as any)
  })

  it("GET devuelve la configuración de la org del ADMIN", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-9" })
    const res = await GET()
    expect(await res.json()).toEqual({ terminos: "No cubre golpes.", ventanaPorVencer: 10, avisoVencimiento: false })
    expect(orgChain.eq).toHaveBeenCalledWith("id", "org-9")
  })

  it.each(["VENDEDOR", "TECNICO"])("%s no la puede leer ni cambiar", async (role) => {
    mockAuthSuccess({ role })
    expect((await GET()).status).toBe(403)
    expect((await put({ avisoVencimiento: true })).status).toBe(403)
    expect(orgChain.update).not.toHaveBeenCalled()
  })

  it("PUT guarda en la org del ADMIN y refresca el dashboard", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-9" })
    const res = await put({ terminos: "Nuevo texto", ventanaPorVencer: 14, avisoVencimiento: true })
    expect(res.status).toBe(200)
    expect(orgChain.update).toHaveBeenCalledWith({
      garantia_terminos: "Nuevo texto",
      garantia_ventana_por_vencer_dias: 14,
      garantia_aviso_vencimiento: true,
    })
    expect(orgChain.eq).toHaveBeenCalledWith("id", "org-9")
    expect(revalidateTag).toHaveBeenCalledWith("dashboard", "max")
  })

  it("PUT rechaza una ventana inválida sin escribir nada", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const res = await put({ ventanaPorVencer: 0 })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/ventana/)
    expect(orgChain.update).not.toHaveBeenCalled()
  })

  it("PUT con un body que no es JSON da 400", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const res = await PUT(createPostRequest(undefined))
    expect(res.status).toBe(400)
  })
})
