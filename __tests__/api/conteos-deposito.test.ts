import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, parseResponse } from "./helpers"

vi.mock("@/lib/depositos", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/depositos")>()),
  depositoPermitido: vi.fn(),
}))

import { supabaseAdmin } from "@/lib/supabase"
import { depositoPermitido, DEPOSITO_INVALIDO } from "@/lib/depositos"
import { POST } from "@/app/api/conteos/route"

function req(body: unknown) {
  return new Request("http://localhost:3000/api/conteos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/conteos — validacion del deposito", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(depositoPermitido).mockResolvedValue(true)
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { id: "c1" }, error: null } as any)
  })

  it("rechaza con 400 un depositoId no permitido y NO llama a la RPC", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    vi.mocked(depositoPermitido).mockResolvedValue(false)

    const { status, body } = await parseResponse(
      await POST(req({ nombre: "Conteo", depositoId: "dep-ajeno" }))
    )

    expect(status).toBe(400)
    expect(body.error).toBe(DEPOSITO_INVALIDO)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("valida con alcance sucursal, el rol y la sucursal de la sesion", async () => {
    mockAuthSuccess({ role: "ADMIN", sucursalId: "suc-1", organizationId: "org-9" })

    const res = await POST(req({ nombre: "Conteo", depositoId: "dep-2" }))

    expect(res.status).toBe(201)
    expect(depositoPermitido).toHaveBeenCalledWith({
      depositoId: "dep-2",
      organizationId: "org-9",
      role: "ADMIN",
      userSucursalId: "suc-1",
      alcance: "sucursal",
    })
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("iniciar_conteo", expect.anything())
  })

  it("sin depositoId no valida (conteo de toda la org)", async () => {
    mockAuthSuccess()

    const res = await POST(req({ nombre: "Conteo" }))

    expect(res.status).toBe(201)
    expect(depositoPermitido).not.toHaveBeenCalled()
  })

  it("responde 500 sin llamar a la RPC si la validacion falla", async () => {
    mockAuthSuccess()
    vi.mocked(depositoPermitido).mockRejectedValue(new Error("db down"))
    vi.spyOn(console, "error").mockImplementation(() => {})

    const res = await POST(req({ nombre: "Conteo", depositoId: "dep-2" }))

    expect(res.status).toBe(500)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })
})
