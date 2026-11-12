/**
 * Auditoría UX §5.1: un usuario recién creado no tiene que ver todo el
 * changelog en su segunda sesión. Toda ruta que da de alta un usuario lo crea
 * con `last_seen_version = APP_VERSION`, así WhatsNewModal sólo le muestra lo
 * que salga después de su alta.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { APP_VERSION } from "@/lib/changelog"
import { createChainMock, createPostRequest, parseResponse } from "./helpers"

vi.mock("@/lib/plan-limits", () => ({
  enforcePlanLimit: vi.fn().mockResolvedValue(null),
  isPlanLimitError: vi.fn().mockReturnValue(false),
  planLimitErrorResponse: vi.fn(),
}))

vi.mock("@/lib/email", () => ({
  sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/rubros/seed", () => ({
  seedOrganizationFromRubro: vi.fn().mockResolvedValue({
    rubroId: "generico",
    tiposSembrados: 0,
    checklistsCreados: 0,
    errors: [],
  }),
}))

import { POST as postTecnico } from "@/app/api/tecnicos/route"
import { POST as postVendedor } from "@/app/api/vendedores/route"
import { POST as postRegister } from "@/app/api/auth/register/route"

describe.each([
  { nombre: "POST /api/tecnicos", post: postTecnico },
  { nombre: "POST /api/vendedores", post: postVendedor },
])("$nombre", ({ post }) => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(auth).mockResolvedValue({
      user: { id: "admin-1", organizationId: "org-1", role: "ADMIN", sucursalId: null, email: "admin@test.com" },
      expires: new Date(Date.now() + 86400000).toISOString(),
    } as any)
  })

  it("crea al usuario con last_seen_version en la versión actual", async () => {
    const insertChain = createChainMock({ id: "nuevo-1", nombre: "Alta", email: "alta@test.com", activo: true })
    let usersCalls = 0
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "sucursales") return createChainMock({ id: "suc-principal" }) as any
      if (table === "users") return (usersCalls++ === 0 ? createChainMock(null) : insertChain) as any
      return createChainMock(null, { message: `No mock for table: ${table}` }) as any
    })

    const res = await post(createPostRequest({ nombre: "Alta", email: "alta@test.com", password: "secret123" }))

    expect(res.status).toBe(201)
    expect(insertChain.insert.mock.calls[0][0].last_seen_version).toBe(APP_VERSION)
  })
})

describe("POST /api/auth/register", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("crea al admin de la cuenta nueva con last_seen_version en la versión actual", async () => {
    const counts: Record<string, number> = {}
    const userInserts: any[] = []
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      const n = (counts[table] = (counts[table] || 0) + 1)
      switch (table) {
        case "users": {
          if (n === 1) return createChainMock(null) as any
          const chain = createChainMock({ id: "user-1", email: "luis@example.com", nombre: "Luis", rol: "ADMIN" })
          const original = chain.insert as unknown as (payload: any) => unknown
          chain.insert = vi.fn((payload: any) => {
            userInserts.push(payload)
            return original(payload)
          })
          return chain as any
        }
        case "organizations":
          return (n === 1
            ? createChainMock(null)
            : createChainMock({ id: "org-1", nombre: "Taller Luis", slug: "taller-luis" })) as any
        default:
          return createChainMock(null, null) as any
      }
    })

    const res = await postRegister(
      createPostRequest({
        organizacion: { nombre: "Taller Luis", slug: "taller-luis" },
        usuario: { nombre: "Luis", email: "luis@example.com", password: "contrasena8" },
      }) as any
    )
    const { status } = await parseResponse(res)

    expect(status).toBe(200)
    expect(userInserts).toHaveLength(1)
    expect(userInserts[0].last_seen_version).toBe(APP_VERSION)
  })
})
