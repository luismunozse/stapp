import { describe, it, expect, vi, beforeEach } from "vitest"
import { createChainMock, mockAuthSuccess, createPostRequest } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

import { GET, PUT } from "@/app/api/configuracion/danos/route"

const put = (body: unknown) =>
  PUT(
    new Request("http://localhost/api/configuracion/danos", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  )

describe("/api/configuracion/danos", () => {
  let orgChain: ReturnType<typeof createChainMock>

  beforeEach(() => {
    vi.clearAllMocks()
    orgChain = createChainMock({ danos_recepcion_obligatorio: true })
    vi.mocked(supabaseAdmin.from).mockImplementation(() => orgChain as any)
  })

  it("GET devuelve el flag de la org del ADMIN", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-9" })
    const res = await GET()
    expect(await res.json()).toEqual({ obligatorio: true })
    expect(orgChain.eq).toHaveBeenCalledWith("id", "org-9")
  })

  it("GET devuelve false si la columna todavía no existe", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    orgChain = createChainMock(null, { message: "column does not exist" })
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ obligatorio: false })
  })

  it.each(["VENDEDOR", "TECNICO"])("%s no la puede leer ni cambiar", async (role) => {
    mockAuthSuccess({ role })
    expect((await GET()).status).toBe(403)
    expect((await put({ obligatorio: true })).status).toBe(403)
    expect(orgChain.update).not.toHaveBeenCalled()
  })

  it("PUT como ADMIN actualiza la columna de su org", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-9" })
    const res = await put({ obligatorio: true })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ obligatorio: true })
    expect(orgChain.update).toHaveBeenCalledWith({ danos_recepcion_obligatorio: true })
    expect(orgChain.eq).toHaveBeenCalledWith("id", "org-9")
  })

  it("PUT con un valor que no es booleano da 400", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const res = await put({ obligatorio: "si" })
    expect(res.status).toBe(400)
    expect(orgChain.update).not.toHaveBeenCalled()
  })

  it("PUT con un body que no es JSON da 400", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    expect((await PUT(createPostRequest(undefined))).status).toBe(400)
  })

  it("PUT devuelve 500 con mensaje si la columna falta", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    orgChain = createChainMock(null, { message: "column does not exist" })
    const res = await put({ obligatorio: true })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBeTruthy()
  })
})
