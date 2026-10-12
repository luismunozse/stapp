// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockAuthError, mockSupabaseFrom, createChainMock, parseResponse } from "./helpers"
import { GET } from "@/app/api/account/deletion-info/route"

function setup(otrosAdmins: number) {
  mockSupabaseFrom({
    users: createChainMock({ password: "hash", totp_enabled: true }, null, otrosAdmins),
    organizations: createChainMock({ slug: "taller-uno", nombre: "Taller Uno" }, null),
  })
}

describe("GET /api/account/deletion-info", () => {
  beforeEach(() => vi.clearAllMocks())

  it("sin sesión: 401", async () => {
    mockAuthError()
    expect((await GET()).status).toBe(401)
  })

  it("ADMIN sin otros ADMIN activos es el último", async () => {
    mockAuthSuccess({ userId: "u1", organizationId: "o1", role: "ADMIN" })
    setup(0)
    const res = await GET()
    expect(res.headers.get("Cache-Control")).toBe("no-store")
    const { status, body } = await parseResponse(res)
    expect(status).toBe(200)
    expect(body).toEqual({
      role: "ADMIN", slug: "taller-uno", orgName: "Taller Uno",
      isLastAdmin: true, hasPassword: true, totpEnabled: true, graceDays: 30,
    })
  })

  it("ADMIN con otro ADMIN no es el último", async () => {
    mockAuthSuccess({ userId: "u1", organizationId: "o1", role: "ADMIN" })
    setup(1)
    expect((await parseResponse(await GET())).body.isLastAdmin).toBe(false)
  })

  it("un TECNICO nunca es 'último ADMIN' y no paga la consulta", async () => {
    mockAuthSuccess({ userId: "u1", organizationId: "o1", role: "TECNICO" })
    setup(0)
    expect((await parseResponse(await GET())).body.isLastAdmin).toBe(false)
  })

  it("la consulta de ADMIN cuenta igual que la guarda SQL: mismo taller, rol ADMIN, sin baja, excluyendo al propio usuario", async () => {
    mockAuthSuccess({ userId: "u1", organizationId: "o1", role: "ADMIN" })
    const users = createChainMock({ password: "hash", totp_enabled: false }, null, 1)
    mockSupabaseFrom({
      users,
      organizations: createChainMock({ slug: "s", nombre: "N" }, null),
    })
    await GET()
    expect(users.eq).toHaveBeenCalledWith("organization_id", "o1")
    expect(users.eq).toHaveBeenCalledWith("rol", "ADMIN")
    expect(users.is).toHaveBeenCalledWith("deleted_at", null)
    expect(users.neq).toHaveBeenCalledWith("id", "u1")
  })

  it("si falla el conteo de ADMIN responde 500 (no adivina isLastAdmin)", async () => {
    mockAuthSuccess({ userId: "u1", organizationId: "o1", role: "ADMIN" })
    const users = createChainMock({ password: "hash", totp_enabled: true }, { message: "boom" })
    // .single() (datos del usuario) anda; el conteo (await directo) falla.
    users.single = vi.fn().mockResolvedValue({ data: { password: "hash", totp_enabled: true }, error: null })
    mockSupabaseFrom({
      users,
      organizations: createChainMock({ slug: "s", nombre: "N" }, null),
    })
    vi.spyOn(console, "error").mockImplementation(() => {})
    const { status, body } = await parseResponse(await GET())
    expect(status).toBe(500)
    expect(body).not.toHaveProperty("isLastAdmin")
  })

  it("si falla la lectura del usuario responde 500", async () => {
    mockAuthSuccess({ userId: "u1", organizationId: "o1", role: "TECNICO" })
    const users = createChainMock(null, { message: "boom" })
    mockSupabaseFrom({
      users,
      organizations: createChainMock({ slug: "s", nombre: "N" }, null),
    })
    vi.spyOn(console, "error").mockImplementation(() => {})
    expect((await GET()).status).toBe(500)
  })

  it("usuario inexistente: 404", async () => {
    mockAuthSuccess({ userId: "u1", organizationId: "o1", role: "TECNICO" })
    mockSupabaseFrom({
      users: createChainMock(null, null),
      organizations: createChainMock({ slug: "s", nombre: "N" }, null),
    })
    expect((await GET()).status).toBe(404)
  })

  it("no expone secretos: hasPassword es booleano", async () => {
    mockAuthSuccess({ userId: "u1", organizationId: "o1", role: "TECNICO" })
    setup(0)
    const { body } = await parseResponse(await GET())
    expect(typeof body.hasPassword).toBe("boolean")
    expect(JSON.stringify(body)).not.toContain("hash")
  })
})
