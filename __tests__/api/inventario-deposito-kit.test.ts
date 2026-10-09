import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, parseResponse } from "./helpers"

vi.mock("@/lib/depositos", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/depositos")>()),
  depositoPermitido: vi.fn(),
  depositoPorDefecto: vi.fn(),
}))

import { supabaseAdmin } from "@/lib/supabase"
import { depositoPermitido, depositoPorDefecto, DEPOSITO_INVALIDO } from "@/lib/depositos"
import { POST as ensamblar } from "@/app/api/inventario/[id]/kit/ensamblar/route"
import { POST as desensamblar } from "@/app/api/inventario/[id]/kit/desensamblar/route"

const casos = [
  { nombre: "ensamblar", post: ensamblar, rpc: "ensamblar_kit_atomic" },
  { nombre: "desensamblar", post: desensamblar, rpc: "desensamblar_kit_atomic" },
]

function req(body: unknown) {
  return new Request("http://localhost:3000/api/inventario/kit-1/kit/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}
const ctx = { params: Promise.resolve({ id: "kit-1" }) }

describe.each(casos)("POST /api/inventario/[id]/kit/$nombre — validacion del deposito", (caso) => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(depositoPermitido).mockResolvedValue(true)
    vi.mocked(depositoPorDefecto).mockResolvedValue(null)
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { ok: true }, error: null } as any)
    mockSupabaseFrom({ organizations: createChainMock({ vendedores_administran_inventario: true }) })
  })

  it("rechaza con 400 y NO llama a la RPC si el deposito no es permitido", async () => {
    mockAuthSuccess({ role: "VENDEDOR", sucursalId: "suc-1" })
    vi.mocked(depositoPermitido).mockResolvedValue(false)

    const { status, body } = await parseResponse(
      await caso.post(req({ cantidad: 1, depositoId: "dep-x" }), ctx)
    )

    expect(status).toBe(400)
    expect(body.error).toBe(DEPOSITO_INVALIDO)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("valida con alcance sucursal, el rol y la sucursal de la sesion", async () => {
    mockAuthSuccess({ role: "VENDEDOR", sucursalId: "suc-1", organizationId: "org-9" })

    const res = await caso.post(req({ cantidad: 1, depositoId: "dep-x" }), ctx)

    expect(res.status).toBe(201)
    expect(depositoPermitido).toHaveBeenCalledWith({
      depositoId: "dep-x",
      organizationId: "org-9",
      role: "VENDEDOR",
      userSucursalId: "suc-1",
      alcance: "sucursal",
    })
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(caso.rpc, expect.anything())
  })

  it("sin depositoId no valida y conserva el default del servidor", async () => {
    mockAuthSuccess()

    const res = await caso.post(req({ cantidad: 1 }), ctx)

    expect(res.status).toBe(201)
    expect(depositoPermitido).not.toHaveBeenCalled()
  })

  it("sin depositoId, VENDEDOR de la sucursal B: la RPC recibe el depósito de B sin revalidarlo", async () => {
    mockAuthSuccess({ role: "VENDEDOR", sucursalId: "suc-b", organizationId: "org-9" })
    vi.mocked(depositoPorDefecto).mockResolvedValue("dep-b")

    const res = await caso.post(req({ cantidad: 1 }), ctx)

    expect(res.status).toBe(201)
    expect(depositoPorDefecto).toHaveBeenCalledWith({
      organizationId: "org-9",
      role: "VENDEDOR",
      userSucursalId: "suc-b",
    })
    expect(depositoPermitido).not.toHaveBeenCalled()
    expect((vi.mocked(supabaseAdmin.rpc).mock.calls[0][1] as any).p_deposito_id).toBe("dep-b")
  })

  it("ADMIN viendo todas (default null): la RPC recibe p_deposito_id null", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    await caso.post(req({ cantidad: 1 }), ctx)

    expect((vi.mocked(supabaseAdmin.rpc).mock.calls[0][1] as any).p_deposito_id).toBeNull()
  })

  it("responde 500 sin llamar a la RPC si la validacion falla", async () => {
    mockAuthSuccess()
    vi.mocked(depositoPermitido).mockRejectedValue(new Error("db down"))
    vi.spyOn(console, "error").mockImplementation(() => {})

    const res = await caso.post(req({ cantidad: 1, depositoId: "dep-x" }), ctx)

    expect(res.status).toBe(500)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })
})
