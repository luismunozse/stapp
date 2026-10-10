import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, parseResponse } from "./helpers"

vi.mock("@/lib/depositos", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/depositos")>()),
  depositoPermitido: vi.fn(),
}))

import { supabaseAdmin } from "@/lib/supabase"
import { depositoPermitido, DEPOSITO_INVALIDO } from "@/lib/depositos"
import { POST } from "@/app/api/inventario/[id]/transferir/route"

const BODY = { depositoOrigenId: "dep-o", depositoDestinoId: "dep-d", cantidad: 3 }

function req(body: unknown) {
  return new Request("http://localhost:3000/api/inventario/inv-1/transferir", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}
const ctx = { params: Promise.resolve({ id: "inv-1" }) }

describe("POST /api/inventario/[id]/transferir", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(depositoPermitido).mockResolvedValue(true)
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { ok: true }, error: null } as any)
    mockSupabaseFrom({ organizations: createChainMock({ vendedores_administran_inventario: true }) })
  })

  it("valida el ORIGEN con alcance sucursal y el DESTINO con alcance organizacion", async () => {
    mockAuthSuccess({ role: "VENDEDOR", sucursalId: "suc-1", organizationId: "org-9" })

    const res = await POST(req(BODY), ctx)

    expect(res.status).toBe(201)
    expect(depositoPermitido).toHaveBeenCalledTimes(2)
    expect(depositoPermitido).toHaveBeenCalledWith({
      depositoId: "dep-o",
      organizationId: "org-9",
      role: "VENDEDOR",
      userSucursalId: "suc-1",
      alcance: "sucursal",
    })
    expect(depositoPermitido).toHaveBeenCalledWith({
      depositoId: "dep-d",
      organizationId: "org-9",
      role: "VENDEDOR",
      userSucursalId: "suc-1",
      alcance: "organizacion",
    })
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("transferir_stock_atomic", expect.anything())
  })

  it("rechaza con 400 y NO llama a la RPC si el origen no es permitido", async () => {
    mockAuthSuccess({ role: "VENDEDOR", sucursalId: "suc-1" })
    vi.mocked(depositoPermitido).mockImplementation(async (p) => p.depositoId !== "dep-o")

    const { status, body } = await parseResponse(await POST(req(BODY), ctx))

    expect(status).toBe(400)
    expect(body.error).toBe(DEPOSITO_INVALIDO)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("rechaza con 400 y NO llama a la RPC si el destino no es permitido", async () => {
    mockAuthSuccess({ role: "VENDEDOR", sucursalId: "suc-1" })
    vi.mocked(depositoPermitido).mockImplementation(async (p) => p.depositoId !== "dep-d")

    const { status, body } = await parseResponse(await POST(req(BODY), ctx))

    expect(status).toBe(400)
    expect(body.error).toBe(DEPOSITO_INVALIDO)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("responde 500 sin llamar a la RPC si la validacion falla", async () => {
    mockAuthSuccess()
    vi.mocked(depositoPermitido).mockRejectedValue(new Error("db down"))
    vi.spyOn(console, "error").mockImplementation(() => {})

    const res = await POST(req(BODY), ctx)

    expect(res.status).toBe(500)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("mapea P0003 a 409 INSUFFICIENT_STOCK (comportamiento previo intacto)", async () => {
    mockAuthSuccess()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null,
      error: { code: "P0003", message: "sin stock" },
    } as any)

    const { status, body } = await parseResponse(await POST(req(BODY), ctx))

    expect(status).toBe(409)
    expect(body.code).toBe("INSUFFICIENT_STOCK")
  })
})
