import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { mockAuthSuccess, mockAuthError, parseResponse } from "./helpers"
import { POST } from "@/app/api/inventario/lotes/marcar-vencidos/route"

describe("POST /api/inventario/lotes/marcar-vencidos", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("llama la RPC acotada a la organización de la sesión", async () => {
    mockAuthSuccess({ organizationId: "org-7", role: "ADMIN" })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: 3, error: null } as any)

    const { status, body } = await parseResponse(await POST())

    expect(status).toBe(200)
    expect(body.count).toBe(3)
    expect(supabaseAdmin.rpc).toHaveBeenCalledTimes(1)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("marcar_lotes_vencidos", {
      p_organization_id: "org-7",
    })
  })

  it("no llama la RPC sin sesión", async () => {
    mockAuthError()

    const { status } = await parseResponse(await POST())

    expect(status).toBe(401)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("no llama la RPC para un TECNICO", async () => {
    mockAuthSuccess({ role: "TECNICO" })

    const { status } = await parseResponse(await POST())

    expect(status).toBe(403)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("devuelve 500 si la RPC falla", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: null, error: { message: "boom" } } as any)

    const { status } = await parseResponse(await POST())

    expect(status).toBe(500)
  })
})
