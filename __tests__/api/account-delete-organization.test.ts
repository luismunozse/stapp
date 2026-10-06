// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth } from "@/lib/auth"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, createPostRequest, parseResponse } from "./helpers"

vi.mock("@/lib/account-deletion/reauth", () => ({ verifyReauth: vi.fn() }))
vi.mock("@/lib/account-deletion/cancel-subscriptions", () => ({ cancelOrganizationSubscriptions: vi.fn() }))
vi.mock("@/lib/account-deletion/emails", () => ({ notifyAdminsOrgDeleted: vi.fn().mockResolvedValue(undefined) }))

import { verifyReauth } from "@/lib/account-deletion/reauth"
import { cancelOrganizationSubscriptions } from "@/lib/account-deletion/cancel-subscriptions"
import { notifyAdminsOrgDeleted } from "@/lib/account-deletion/emails"
import { POST } from "@/app/api/account/delete-organization/route"

type Org = Record<string, unknown> | null

function setup(
  org: Org = { id: "o1", slug: "taller-uno", nombre: "Taller Uno", deleted_at: null, deletion_requested_at: null },
  opts: { subsError?: unknown } = {},
) {
  const orgChain = Object.assign(createChainMock(org, null), {
    update: vi.fn().mockReturnValue(createChainMock([{ id: "o1" }], null)),
  })
  const subs = createChainMock(null, opts.subsError ?? null)
  const audit = createChainMock(null, null)
  mockSupabaseFrom({ organizations: orgChain as never, subscriptions: subs, audit_logs: audit })
  return { orgChain, subs, audit }
}

const body = (over: Record<string, unknown> = {}) => createPostRequest({ confirmSlug: "taller-uno", password: "x", ...over })

describe("POST /api/account/delete-organization", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "error").mockImplementation(() => {})
    mockAuthSuccess({ userId: "u1", organizationId: "o1", role: "ADMIN" })
    vi.mocked(verifyReauth).mockResolvedValue({ ok: true })
    vi.mocked(cancelOrganizationSubscriptions).mockResolvedValue({ ok: true, canceled: ["MERCADOPAGO"], skipped: false })
  })

  it.each(["TECNICO", "VENDEDOR"])("un %s recibe 403", async (role) => {
    mockAuthSuccess({ userId: "u1", organizationId: "o1", role })
    setup()
    expect((await POST(body())).status).toBe(403)
  })

  it.each([{ isSuperadmin: true }, { isImpersonating: true }])("sesión %o: 403 antes de reautenticar", async (flag) => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: "u1", organizationId: "o1", role: "ADMIN", email: "test@test.com", ...flag },
      expires: new Date(Date.now() + 86400000).toISOString(),
    } as never)
    setup()
    expect((await POST(body())).status).toBe(403)
    expect(verifyReauth).not.toHaveBeenCalled()
    expect(cancelOrganizationSubscriptions).not.toHaveBeenCalled()
  })

  it("caso feliz: marca el taller, cancela, setea canceled_at, avisa y devuelve la fecha de borrado", async () => {
    const { orgChain, subs } = setup()
    const { status, body: b } = await parseResponse(await POST(body()))
    expect(status).toBe(200)
    expect(b.success).toBe(true)
    expect(new Date(b.deletionDate).getTime()).toBeGreaterThan(Date.now() + 29 * 86400000)

    const payload = orgChain.update.mock.calls[0][0]
    expect(payload).toMatchObject({
      deleted_by: "test@test.com",
      archived_reason: "user_requested_deletion",
    })
    expect(payload.deleted_at).toBeTruthy()
    expect(payload.deletion_requested_at).toBe(payload.deleted_at)
    expect(subs.update).toHaveBeenCalledWith({ canceled_at: payload.deleted_at })
    expect(notifyAdminsOrgDeleted).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "o1", orgNombre: "Taller Uno" }))
  })

  it("si falla la cancelación responde 502 con el mensaje del spec y NO cambia el estado de la org", async () => {
    const { orgChain, subs } = setup()
    vi.mocked(cancelOrganizationSubscriptions).mockResolvedValueOnce({ ok: false, failed: ["REBILL"], canceled: ["MERCADOPAGO"] })
    const { status, body: b } = await parseResponse(await POST(body()))
    expect(status).toBe(502)
    expect(b.error).toBe("No pudimos cancelar tu suscripción, reintentá o escribí a soporte")
    expect(b.providers).toEqual(["REBILL"])
    expect(orgChain.update).not.toHaveBeenCalled()
    expect(subs.update).not.toHaveBeenCalled()
    expect(notifyAdminsOrgDeleted).not.toHaveBeenCalled()
  })

  it("el subdominio tipeado tiene que coincidir (sin distinguir mayúsculas ni espacios)", async () => {
    const { orgChain } = setup()
    expect((await POST(body({ confirmSlug: "otro-taller" }))).status).toBe(400)
    expect(orgChain.update).not.toHaveBeenCalled()
    expect(cancelOrganizationSubscriptions).not.toHaveBeenCalled()
    expect((await POST(body({ confirmSlug: "  Taller-Uno " }))).status).toBe(200)
  })

  it("reautenticación fallida: 401 y no se cancela nada", async () => {
    setup()
    vi.mocked(verifyReauth).mockResolvedValueOnce({ ok: false, status: 401, code: "WRONG_CREDENTIAL", error: "Contraseña incorrecta" })
    expect((await POST(body())).status).toBe(401)
    expect(cancelOrganizationSubscriptions).not.toHaveBeenCalled()
  })

  it("cuenta bloqueada por intentos fallidos: 429", async () => {
    setup()
    vi.mocked(verifyReauth).mockResolvedValueOnce({ ok: false, status: 401, code: "ACCOUNT_LOCKED", error: "Cuenta bloqueada" })
    expect((await POST(body())).status).toBe(429)
    expect(cancelOrganizationSubscriptions).not.toHaveBeenCalled()
  })

  it("body inválido: 400", async () => {
    setup()
    expect((await POST(createPostRequest({ password: "x" }))).status).toBe(400)
  })

  it("taller ya en proceso de eliminación: 409; org del panel: 403", async () => {
    setup({ id: "o1", slug: "taller-uno", nombre: "T", deleted_at: "2026-10-01", deletion_requested_at: "2026-10-01" })
    expect((await POST(body())).status).toBe(409)
    setup({ id: "o1", slug: "superadmin", nombre: "Admin", deleted_at: null, deletion_requested_at: null })
    expect((await POST(body({ confirmSlug: "superadmin" }))).status).toBe(403)
  })

  it("si otra request lo archivó entre el chequeo y el UPDATE: 409 y sin avisos", async () => {
    const { orgChain } = setup()
    orgChain.update.mockReturnValueOnce(createChainMock([], null))
    orgChain.single
      .mockResolvedValueOnce({ data: { id: "o1", slug: "taller-uno", nombre: "T", deleted_at: null, deletion_requested_at: null }, error: null })
      .mockResolvedValueOnce({ data: { deleted_at: "2026-10-06" }, error: null })
    expect((await POST(body())).status).toBe(409)
    expect(notifyAdminsOrgDeleted).not.toHaveBeenCalled()
  })

  it("UPDATE con 0 filas y el taller NO está archivado: 500 (falla cerrada) y sin avisos", async () => {
    const { orgChain } = setup()
    orgChain.update.mockReturnValueOnce(createChainMock([], null))
    expect((await POST(body())).status).toBe(500)
    expect(notifyAdminsOrgDeleted).not.toHaveBeenCalled()
  })

  it("error en el UPDATE de organizations: 500 y sin avisos", async () => {
    const { orgChain } = setup()
    orgChain.update.mockReturnValueOnce(createChainMock(null, { message: "boom" }))
    expect((await POST(body())).status).toBe(500)
    expect(notifyAdminsOrgDeleted).not.toHaveBeenCalled()
  })

  it("error al setear canceled_at: 500, no archiva el taller ni avisa", async () => {
    const { orgChain } = setup(undefined, { subsError: { message: "boom" } })
    expect((await POST(body())).status).toBe(500)
    expect(orgChain.update).not.toHaveBeenCalled()
    expect(notifyAdminsOrgDeleted).not.toHaveBeenCalled()
  })

  it("un fallo del audit log no tumba la baja", async () => {
    const { audit } = setup()
    audit.insert.mockReturnValue(createChainMock(null, { message: "boom" }))
    expect((await POST(body())).status).toBe(200)
    expect(notifyAdminsOrgDeleted).toHaveBeenCalled()
  })
})
