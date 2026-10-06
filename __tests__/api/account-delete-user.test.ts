// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { isImpersonationWriteBlocked } from "@/lib/impersonation"
import { mockAuthSuccess, mockAuthError, mockSupabaseFrom, createChainMock, createPostRequest, parseResponse } from "./helpers"

vi.mock("@/lib/account-deletion/reauth", () => ({ verifyReauth: vi.fn() }))
vi.mock("@/lib/account-deletion/emails", () => ({ notifyAdminsUserDeleted: vi.fn().mockResolvedValue(undefined) }))

import { verifyReauth } from "@/lib/account-deletion/reauth"
import { notifyAdminsUserDeleted } from "@/lib/account-deletion/emails"
import { POST } from "@/app/api/account/delete-user/route"

function setup(rpcData: string = "OK", pushError: unknown = null) {
  const push = createChainMock(null, pushError)
  const web = createChainMock(null, null)
  mockSupabaseFrom({
    users: createChainMock({ nombre: "Pepe", email: "pepe@t.com", rol: "TECNICO" }, null),
    push_tokens: push,
    web_push_subscriptions: web,
    audit_logs: createChainMock(null, null),
  })
  vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: rpcData, error: null } as never)
  return { push, web }
}

describe("POST /api/account/delete-user", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.mocked(verifyReauth).mockResolvedValue({ ok: true })
  })

  it.each(["ADMIN", "TECNICO", "VENDEDOR"])("un %s puede eliminar su propio usuario", async (role) => {
    mockAuthSuccess({ userId: "u1", organizationId: "o1", role })
    const { push, web } = setup("OK")
    const { status, body } = await parseResponse(await POST(createPostRequest({ password: "x" })))
    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("solicitar_baja_usuario", { p_user_id: "u1" })
    expect(push.delete).toHaveBeenCalled()
    expect(web.delete).toHaveBeenCalled()
    expect(notifyAdminsUserDeleted).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "o1", userId: "u1" }))
  })

  it("sin sesión: 401", async () => {
    mockAuthError()
    expect((await POST(createPostRequest({}))).status).toBe(401)
  })

  it("body inválido: 400 y no se reautentica", async () => {
    mockAuthSuccess({ userId: "u1", role: "ADMIN" })
    setup()
    expect((await POST(createPostRequest({ password: 123 }))).status).toBe(400)
    expect(verifyReauth).not.toHaveBeenCalled()
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("reautenticación fallida: 401 con el code, y no se da de baja a nadie", async () => {
    mockAuthSuccess({ userId: "u1", role: "ADMIN" })
    setup()
    vi.mocked(verifyReauth).mockResolvedValueOnce({ ok: false, status: 401, code: "REQUIRES_2FA", error: "Ingresá tu código" })
    const { status, body } = await parseResponse(await POST(createPostRequest({ password: "x" })))
    expect(status).toBe(401)
    expect(body.code).toBe("REQUIRES_2FA")
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("cuenta bloqueada por intentos: 429 ACCOUNT_LOCKED", async () => {
    mockAuthSuccess({ userId: "u1", role: "ADMIN" })
    setup()
    vi.mocked(verifyReauth).mockResolvedValueOnce({ ok: false, status: 401, code: "ACCOUNT_LOCKED", error: "Demasiados intentos" })
    const { status, body } = await parseResponse(await POST(createPostRequest({ password: "x" })))
    expect(status).toBe(429)
    expect(body.code).toBe("ACCOUNT_LOCKED")
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("el último ADMIN recibe 409 LAST_ADMIN y no se tocan tokens ni se avisa a nadie", async () => {
    mockAuthSuccess({ userId: "u1", role: "ADMIN" })
    const { push } = setup("LAST_ADMIN")
    const { status, body } = await parseResponse(await POST(createPostRequest({ password: "x" })))
    expect(status).toBe(409)
    expect(body.code).toBe("LAST_ADMIN")
    expect(push.delete).not.toHaveBeenCalled()
    expect(notifyAdminsUserDeleted).not.toHaveBeenCalled()
  })

  it("el segundo de dos ADMIN simultáneos (la función ya vio al primero marcado) recibe 409", async () => {
    // La carrera real la serializa FOR UPDATE en SQL. Acá se fija que la ruta
    // traduce LAST_ADMIN a 409 sin importar quién llega segundo.
    mockAuthSuccess({ userId: "u2", role: "ADMIN" })
    setup("LAST_ADMIN")
    expect((await POST(createPostRequest({ password: "x" }))).status).toBe(409)
  })

  it("una sesión de impersonación no puede eliminar al usuario del tenant", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: "u1", organizationId: "o1", role: "ADMIN", email: "t@t.com", isImpersonating: true },
      expires: new Date(Date.now() + 86400000).toISOString(),
    } as never)
    setup()
    expect((await POST(createPostRequest({ password: "x" }))).status).toBe(403)
    expect(verifyReauth).not.toHaveBeenCalled()
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("el middleware ya bloquea el POST de una sesión impersonada a esta ruta", () => {
    expect(
      isImpersonationWriteBlocked({
        isImpersonating: true,
        method: "POST",
        pathname: "/api/account/delete-user",
        isServerAction: false,
      })
    ).toBe(true)
  })

  it("un superadmin no puede usar esta ruta (403 antes de reautenticar)", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: "u1", organizationId: "o1", role: "ADMIN", email: "sa@t.com", isSuperadmin: true },
      expires: new Date(Date.now() + 86400000).toISOString(),
    } as never)
    expect((await POST(createPostRequest({ password: "x" }))).status).toBe(403)
    expect(verifyReauth).not.toHaveBeenCalled()
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("ALREADY_DELETED es idempotente: 200 sin repetir avisos", async () => {
    mockAuthSuccess({ userId: "u1", role: "TECNICO" })
    setup("ALREADY_DELETED")
    expect((await POST(createPostRequest({ password: "x" }))).status).toBe(200)
    expect(notifyAdminsUserDeleted).not.toHaveBeenCalled()
  })

  it("NOT_FOUND: 404; error del RPC: 500", async () => {
    mockAuthSuccess({ userId: "u1", role: "TECNICO" })
    setup("NOT_FOUND")
    expect((await POST(createPostRequest({ password: "x" }))).status).toBe(404)
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: null, error: { message: "boom" } } as never)
    expect((await POST(createPostRequest({ password: "x" }))).status).toBe(500)
  })

  it("si falla limpiar los tokens, la baja igual responde 200, se loguea y se avisa", async () => {
    mockAuthSuccess({ userId: "u1", organizationId: "o1", role: "TECNICO" })
    setup("OK", { message: "push boom" })
    const { status } = await parseResponse(await POST(createPostRequest({ password: "x" })))
    expect(status).toBe(200)
    expect(console.error).toHaveBeenCalled()
    expect(notifyAdminsUserDeleted).toHaveBeenCalled()
  })
})
