import { describe, it, expect, vi, beforeEach } from "vitest"
import { createChainMock, mockSupabaseFrom, createGetRequest, parseResponse } from "./helpers"

vi.mock("@/lib/superadmin-auth", () => ({
  requireSuperadmin: vi.fn().mockResolvedValue({ error: null, email: "admin@stapp.com.ar" }),
}))

import { GET } from "@/app/api/superadmin/organizations/[id]/route"

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

describe("GET /api/superadmin/organizations/[id] — includes limitOverrides", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns the org's limit override row", async () => {
    mockSupabaseFrom({
      organizations: createChainMock({ id: "o1", nombre: "Guru", slug: "guru", activo: true }),
      users: createChainMock([]),
      organization_usage: createChainMock({ organization_id: "o1", clientes_count: 5 }),
      subscriptions: createChainMock({ id: "s1", organization_id: "o1", status: "TRIALING", plans: { id: "p", nombre: "Profesional" } }),
      subscription_payments: createChainMock([]),
      ordenes_servicio: createChainMock([]),
      organization_limit_overrides: createChainMock({ organization_id: "o1", limite_clientes: 500, limite_ordenes: null, limite_tecnicos: null, limite_vendedores: null, limite_storage_mb: null, motivo: "cliente VIP" }),
    })

    const res = await GET(createGetRequest("http://localhost/api/superadmin/organizations/o1"), ctx("o1"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.limitOverrides).toEqual(
      expect.objectContaining({ organization_id: "o1", limite_clientes: 500, motivo: "cliente VIP" })
    )
  })

  it("returns null limitOverrides when none exist", async () => {
    mockSupabaseFrom({
      organizations: createChainMock({ id: "o1", nombre: "Guru", slug: "guru", activo: true }),
      users: createChainMock([]),
      organization_usage: createChainMock(null),
      subscriptions: createChainMock(null),
      subscription_payments: createChainMock([]),
      ordenes_servicio: createChainMock([]),
      organization_limit_overrides: createChainMock(null),
    })

    const res = await GET(createGetRequest("http://localhost/api/superadmin/organizations/o1"), ctx("o1"))
    const { body } = await parseResponse(res)
    expect(body.limitOverrides).toBeNull()
  })
})
