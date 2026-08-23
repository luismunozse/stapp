import { describe, it, expect, beforeEach, vi } from "vitest"
import { createChainMock, createPostRequest, parseResponse } from "./helpers"

vi.mock("@/lib/email", () => ({
  sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/rubros/seed", () => ({
  seedOrganizationFromRubro: vi.fn().mockResolvedValue({
    rubroId: "automotor",
    tiposSembrados: 3,
    checklistsCreados: 1,
    errors: [],
  }),
}))

import { seedOrganizationFromRubro } from "@/lib/rubros/seed"

async function callRoute(body: unknown) {
  const mod = await import("@/app/api/auth/register/route")
  return mod.POST(createPostRequest(body) as any)
}

async function setupRegisterMocks() {
  const { supabaseAdmin } = await import("@/lib/supabase")
  const counts: Record<string, number> = {}
  const inserts: Record<string, any[]> = {}

  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    counts[table] = (counts[table] || 0) + 1
    const n = counts[table]

    const capture = (chain: any) => {
      const originalInsert = chain.insert
      chain.insert = (payload: any) => {
        ;(inserts[table] ||= []).push(payload)
        return originalInsert(payload)
      }
      return chain
    }

    switch (table) {
      case "users":
        return n === 1
          ? (createChainMock(null) as any)
          : (capture(
              createChainMock({ id: "user-1", email: "user@example.com", nombre: "Alice", rol: "ADMIN" })
            ) as any)
      case "organizations":
        return n === 1
          ? (createChainMock(null) as any)
          : (capture(createChainMock({ id: "org-1", nombre: "Taller Luis", slug: "taller-luis" })) as any)
      case "organization_counters":
        return capture(createChainMock(null, null)) as any
      case "onboarding_progress":
        return capture(createChainMock(null, null)) as any
      case "checklist_templates":
        return capture(createChainMock({ id: "tpl-1" })) as any
      case "checklist_template_items":
        return capture(createChainMock(null, null)) as any
      default:
        return createChainMock(null, { message: `unexpected table: ${table}` }) as any
    }
  })

  return inserts
}

const bodyBase = {
  organizacion: { nombre: "Taller Luis", slug: "taller-luis" },
  usuario: { nombre: "Luis", email: "luis@example.com", password: "contrasena8" },
}

describe("POST /api/auth/register — rubro", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(seedOrganizationFromRubro).mockResolvedValue({
      rubroId: "automotor",
      tiposSembrados: 3,
      checklistsCreados: 1,
      errors: [],
    })
  })

  it("acepta el rubro y lo guarda en la organización", async () => {
    const inserts = await setupRegisterMocks()

    const res = await callRoute({ ...bodyBase, organizacion: { ...bodyBase.organizacion, rubro: "automotor" } })
    const { status } = await parseResponse(res)

    expect(status).toBe(200)
    expect(inserts.organizations[0].rubro).toBe("automotor")
  })

  it("siembra el pack del rubro elegido", async () => {
    await setupRegisterMocks()

    await callRoute({ ...bodyBase, organizacion: { ...bodyBase.organizacion, rubro: "automotor" } })

    expect(seedOrganizationFromRubro).toHaveBeenCalledWith("org-1", "automotor")
  })

  it("rechaza un rubro que no existe en el registro", async () => {
    await setupRegisterMocks()

    const res = await callRoute({ ...bodyBase, organizacion: { ...bodyBase.organizacion, rubro: "plomeria" } })
    const { status } = await parseResponse(res)

    expect(status).toBe(400)
  })

  it("sin rubro guarda el genérico y siembra ese pack", async () => {
    const inserts = await setupRegisterMocks()

    const res = await callRoute(bodyBase)
    const { status } = await parseResponse(res)

    expect(status).toBe(200)
    expect(inserts.organizations[0].rubro).toBe("generico")
    expect(seedOrganizationFromRubro).toHaveBeenCalledWith("org-1", "generico")
  })

  it("ya no inserta el checklist de celular hardcodeado", async () => {
    const inserts = await setupRegisterMocks()

    await callRoute({ ...bodyBase, organizacion: { ...bodyBase.organizacion, rubro: "automotor" } })

    // La creación de checklists ahora es responsabilidad del pack de rubro.
    expect(inserts.checklist_templates).toBeUndefined()
    expect(inserts.checklist_template_items).toBeUndefined()
  })

  it("no aborta el registro si la siembra falla", async () => {
    await setupRegisterMocks()
    vi.mocked(seedOrganizationFromRubro).mockRejectedValue(new Error("boom"))

    const res = await callRoute({ ...bodyBase, organizacion: { ...bodyBase.organizacion, rubro: "automotor" } })
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.success).toBe(true)
  })

  it("informa el rubro aplicado en la respuesta", async () => {
    await setupRegisterMocks()

    const res = await callRoute({ ...bodyBase, organizacion: { ...bodyBase.organizacion, rubro: "automotor" } })
    const { body } = await parseResponse(res)

    expect(body.organization.rubro).toBe("automotor")
  })
})
