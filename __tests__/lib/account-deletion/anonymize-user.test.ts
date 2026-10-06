// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { createChainMock, mockSupabaseFrom } from "../../api/helpers"
import { anonymizeUser } from "@/lib/account-deletion/anonymize-user"

function setup(userRow: unknown) {
  const users = createChainMock(userRow, null)
  const totp = createChainMock(null, null)
  const push = createChainMock(null, null)
  const web = createChainMock(null, null)
  const audit = createChainMock(null, null)
  mockSupabaseFrom({ users, totp_used_codes: totp, push_tokens: push, web_push_subscriptions: web, audit_logs: audit })
  const remove = vi.fn().mockResolvedValue({ data: null, error: null })
  const list = vi.fn().mockResolvedValue({ data: [{ name: "u1.png" }, { name: "u10.png" }], error: null })
  vi.mocked(supabaseAdmin.storage.from).mockReturnValue({ list, remove } as never)
  return { users, totp, push, web, audit, remove, list }
}

describe("anonymizeUser", () => {
  beforeEach(() => vi.clearAllMocks())

  it("anonimiza los datos personales y conserva la fila", async () => {
    const { users } = setup({ id: "u1", email: "juan@gmail.com", organization_id: "o1" })
    expect(await anonymizeUser("u1")).toEqual({ ok: true, alreadyAnonymized: false })
    expect(users.update).toHaveBeenCalledWith(expect.objectContaining({
      email: "deleted+u1@deleted.stapp.invalid",
      nombre: "Usuario eliminado",
      password: null,
      telefono: null,
      avatar_url: null,
      refresh_token: null,
      refresh_token_expires: null,
      reset_token: null,
      email_verification_token: null,
      totp_enabled: false,
      totp_secret: null,
      totp_backup_codes: null,
    }))
    expect(users.delete).not.toHaveBeenCalled()
  })

  it("borra el avatar de storage (solo el archivo exacto del usuario, no u10.png)", async () => {
    const { remove } = setup({ id: "u1", email: "juan@gmail.com", organization_id: "o1" })
    await anonymizeUser("u1")
    expect(remove).toHaveBeenCalledWith(["o1/u1.png"])
  })

  it("borra totp_used_codes y tokens push, y limpia ip/user-agent de la auditoría sin borrarla", async () => {
    const { totp, push, web, audit } = setup({ id: "u1", email: "juan@gmail.com", organization_id: "o1" })
    await anonymizeUser("u1")
    expect(totp.delete).toHaveBeenCalled()
    expect(push.delete).toHaveBeenCalled()
    expect(web.delete).toHaveBeenCalled()
    expect(audit.update).toHaveBeenCalledWith({ ip_address: null, user_agent: null })
    expect(audit.delete).not.toHaveBeenCalled()
  })

  it("el UPDATE de users va después de todas las limpiezas (para poder reintentar)", async () => {
    const { users, totp, push, web, audit } = setup({ id: "u1", email: "juan@gmail.com", organization_id: "o1" })
    await anonymizeUser("u1")
    const updateOrder = users.update.mock.invocationCallOrder[0]
    for (const previo of [totp.delete, push.delete, web.delete, audit.update]) {
      expect(previo.mock.invocationCallOrder[0]).toBeLessThan(updateOrder)
    }
  })

  it("es idempotente: si el email ya es el descartable no hace nada", async () => {
    const { users, remove } = setup({ id: "u1", email: "deleted+u1@deleted.stapp.invalid", organization_id: "o1" })
    expect(await anonymizeUser("u1")).toEqual({ ok: true, alreadyAnonymized: true })
    expect(users.update).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })

  it("si falla una limpieza devuelve el error y NO anonimiza el email", async () => {
    const { users, push } = setup({ id: "u1", email: "juan@gmail.com", organization_id: "o1" })
    push.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: "locked" } }).then(resolve)
    const r = await anonymizeUser("u1")
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("push_tokens") })
    expect(users.update).not.toHaveBeenCalled()
  })

  it.each(["", "   ", "a/b", "../x"])("rechaza un userId inválido (%j) sin tocar nada", async (bad) => {
    const { users } = setup({ id: "u1", email: "juan@gmail.com", organization_id: "o1" })
    const r = await anonymizeUser(bad)
    expect(r).toMatchObject({ ok: false })
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
    expect(supabaseAdmin.storage.from).not.toHaveBeenCalled()
    expect(users.update).not.toHaveBeenCalled()
  })

  it("devuelve el error si falla la lectura del usuario", async () => {
    const users = createChainMock(null, { message: "boom" })
    mockSupabaseFrom({ users })
    expect(await anonymizeUser("u1")).toEqual({ ok: false, error: "boom" })
  })

  it("si falla el update final de users devuelve el error", async () => {
    const { users } = setup({ id: "u1", email: "juan@gmail.com", organization_id: "o1" })
    users.update.mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: null, error: { message: "cannot update" } }),
    })
    expect(await anonymizeUser("u1")).toMatchObject({ ok: false, error: expect.stringContaining("users") })
  })

  it("un organization_id inseguro no llega a storage y aborta antes de anonimizar", async () => {
    const { users, list, remove } = setup({ id: "u1", email: "juan@gmail.com", organization_id: "../o1" })
    expect(await anonymizeUser("u1")).toMatchObject({ ok: false })
    expect(list).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
    expect(users.update).not.toHaveBeenCalled()
  })

  it("si falla el listado del avatar devuelve el error y no anonimiza", async () => {
    const { users, list } = setup({ id: "u1", email: "juan@gmail.com", organization_id: "o1" })
    list.mockResolvedValue({ data: null, error: { message: "denied" } })
    expect(await anonymizeUser("u1")).toMatchObject({ ok: false, error: expect.stringContaining("avatar") })
    expect(users.update).not.toHaveBeenCalled()
  })
})
