// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, createGetRequest } from "./helpers"

import { GET as listVendedores } from "@/app/api/vendedores/route"
import { GET as listTecnicos } from "@/app/api/tecnicos/route"
import { GET as listUsuarios } from "@/app/api/usuarios/route"

describe("management lists hide users that were dados de baja", () => {
  let users: ReturnType<typeof createChainMock>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "error").mockImplementation(() => {})
    mockAuthSuccess({ userId: "admin1", organizationId: "o1", role: "ADMIN" })
    users = createChainMock([], null, 0)
    mockSupabaseFrom({ users })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: [], error: null } as never)
  })

  it("GET /api/vendedores", async () => {
    await listVendedores(createGetRequest("http://localhost:3000/api/vendedores"))
    expect(users.is).toHaveBeenCalledWith("deleted_at", null)
  })

  it("GET /api/tecnicos", async () => {
    await listTecnicos(createGetRequest("http://localhost:3000/api/tecnicos"))
    expect(users.is).toHaveBeenCalledWith("deleted_at", null)
  })

  it("GET /api/usuarios", async () => {
    await listUsuarios()
    expect(users.is).toHaveBeenCalledWith("deleted_at", null)
  })
})
