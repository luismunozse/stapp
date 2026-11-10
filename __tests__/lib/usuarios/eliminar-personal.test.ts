// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { mockSupabaseFrom, createChainMock } from "../../api/helpers"
import { eliminarPersonal } from "@/lib/usuarios/eliminar-personal"

// users is touched three ways, each awaited on its own: delete() fails with the
// FK error, select().maybeSingle() reads the email, update() frees it.
function setup(
  deleteError: unknown,
  rpcData: string | null = "OK",
  rpcError: unknown = null,
  updateError: unknown = null,
  opts: { email?: string; updateRows?: unknown[] } = {}
) {
  const email = opts.email ?? "vendedor@taller.com"
  const deleteChain = createChainMock(null, deleteError)
  const readChain = createChainMock(null, null)
  readChain.maybeSingle = vi.fn().mockResolvedValue({ data: { email }, error: null })
  const emailUpdate = createChainMock(updateError ? null : (opts.updateRows ?? [{ id: "v1" }]), updateError)
  const users = {
    delete: vi.fn(() => deleteChain),
    select: vi.fn(() => readChain),
    update: vi.fn(() => emailUpdate),
  }
  const push = createChainMock(null, null)
  const web = createChainMock(null, null)
  const audit = createChainMock(null, null)
  mockSupabaseFrom({ users, push_tokens: push, web_push_subscriptions: web, audit_logs: audit })
  vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: rpcData, error: rpcError } as never)
  return { users, deleteChain, push, web, audit, emailUpdate }
}

const args = { id: "v1", organizationId: "o1", rol: "VENDEDOR" as const, actorId: "admin1" }

describe("eliminarPersonal", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  it("hard deletes when nothing references the user", async () => {
    const { users, deleteChain } = setup(null)
    const r = await eliminarPersonal(args)
    expect(r).toEqual({ ok: true, baja: false })
    expect(users.delete).toHaveBeenCalled()
    expect(deleteChain.eq).toHaveBeenCalledWith("organization_id", "o1")
    expect(deleteChain.eq).toHaveBeenCalledWith("rol", "VENDEDOR")
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("falls back to solicitar_baja_usuario on FK violation 23503", async () => {
    const { push, web, audit } = setup({ code: "23503", message: "fk" })
    const r = await eliminarPersonal(args)
    expect(r).toEqual({ ok: true, baja: true })
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("solicitar_baja_usuario", { p_user_id: "v1" })
    expect(push.delete).toHaveBeenCalled()
    expect(web.delete).toHaveBeenCalled()
    expect(audit.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: "o1",
        user_id: "admin1",
        action: "DELETE",
        entity: "users",
        entity_id: "v1",
        changes: { by_admin: true, soft: true, email_original: "vendedor@taller.com", email_liberado: true },
      })
    )
  })

  it("frees the email on baja and leaves the name alone", async () => {
    const { users, emailUpdate } = setup({ code: "23503", message: "fk" })
    await eliminarPersonal(args)
    expect(users.update).toHaveBeenCalledWith({ email: "baja+v1@baja.stapp.invalid" })
    expect(emailUpdate.eq).toHaveBeenCalledWith("id", "v1")
    expect(emailUpdate.eq).toHaveBeenCalledWith("organization_id", "o1")
    expect(emailUpdate.not).toHaveBeenCalledWith("deleted_at", "is", null)
  })

  it("retries freeing the email on ALREADY_DELETED and audits it", async () => {
    const { users, emailUpdate, audit, push } = setup({ code: "23503" }, "ALREADY_DELETED")
    expect(await eliminarPersonal(args)).toEqual({ ok: true, baja: true })
    expect(users.update).toHaveBeenCalledWith({ email: "baja+v1@baja.stapp.invalid" })
    expect(emailUpdate.not).toHaveBeenCalledWith("deleted_at", "is", null)
    expect(push.delete).not.toHaveBeenCalled()
    expect(audit.insert).toHaveBeenCalledTimes(1)
    expect(audit.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: { by_admin: true, soft: true, email_original: "vendedor@taller.com", email_liberado: true },
      })
    )
  })

  it("ALREADY_DELETED with the email already freed does nothing and writes no audit", async () => {
    const { users, audit } = setup({ code: "23503" }, "ALREADY_DELETED", null, null, {
      email: "baja+v1@baja.stapp.invalid",
    })
    await eliminarPersonal(args)
    expect(users.update).not.toHaveBeenCalled()
    expect(audit.insert).not.toHaveBeenCalled()
  })

  it("ALREADY_DELETED writes no audit when the email still could not be freed", async () => {
    const { audit } = setup({ code: "23503" }, "ALREADY_DELETED", null, { message: "down" })
    expect(await eliminarPersonal(args)).toEqual({ ok: true, baja: true })
    expect(audit.insert).not.toHaveBeenCalled()
  })

  it("records email_liberado false when the update matched no row", async () => {
    const { audit } = setup({ code: "23503" }, "OK", null, null, { updateRows: [] })
    expect(await eliminarPersonal(args)).toEqual({ ok: true, baja: true })
    expect(audit.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: { by_admin: true, soft: true, email_original: "vendedor@taller.com", email_liberado: false },
      })
    )
  })

  it("does not touch the email on a hard delete", async () => {
    const { users } = setup(null)
    await eliminarPersonal(args)
    expect(users.update).not.toHaveBeenCalled()
  })

  it("still reports the baja when freeing the email fails, and the audit says so", async () => {
    const { audit } = setup({ code: "23503" }, "OK", null, { message: "update down" })
    expect(await eliminarPersonal(args)).toEqual({ ok: true, baja: true })
    expect(audit.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: { by_admin: true, soft: true, email_original: "vendedor@taller.com", email_liberado: false },
      })
    )
  })

  it("returns a failure on any other delete error without calling the RPC", async () => {
    setup({ code: "XX000", message: "boom" })
    const r = await eliminarPersonal(args)
    expect(r).toEqual({ ok: false, status: 500 })
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("treats ALREADY_DELETED as baja done", async () => {
    setup({ code: "23503" }, "ALREADY_DELETED")
    expect(await eliminarPersonal(args)).toEqual({ ok: true, baja: true })
  })

  it("maps NOT_FOUND to 404", async () => {
    setup({ code: "23503" }, "NOT_FOUND")
    expect(await eliminarPersonal(args)).toEqual({ ok: false, status: 404 })
  })

  it("maps LAST_ADMIN to 409", async () => {
    setup({ code: "23503" }, "LAST_ADMIN")
    expect(await eliminarPersonal(args)).toEqual({ ok: false, status: 409 })
  })

  it("fails with 500 on RPC error or unexpected estado, without cleanup", async () => {
    const a = setup({ code: "23503" }, null, { message: "rpc down" })
    expect(await eliminarPersonal(args)).toEqual({ ok: false, status: 500 })
    expect(a.push.delete).not.toHaveBeenCalled()
    const b = setup({ code: "23503" }, "WHATEVER")
    expect(await eliminarPersonal(args)).toEqual({ ok: false, status: 500 })
    expect(b.audit.insert).not.toHaveBeenCalled()
  })

  it("still reports the baja when best-effort cleanup or audit fails", async () => {
    const { push, audit } = setup({ code: "23503" })
    push.then = (_r: any, reject?: any) => Promise.reject(new Error("x")).then(undefined, reject)
    audit.insert = vi.fn(() => {
      throw new Error("audit down")
    }) as never
    expect(await eliminarPersonal(args)).toEqual({ ok: true, baja: true })
  })
})
