// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { mockSupabaseFrom, createChainMock } from "../../api/helpers"
import { eliminarPersonal } from "@/lib/usuarios/eliminar-personal"

function usersWithDelete(error: unknown) {
  const users = createChainMock(null, null)
  ;(users as any).then = (resolve: any, reject?: any) =>
    Promise.resolve({ data: null, error }).then(resolve, reject)
  return users
}

function setup(deleteError: unknown, rpcData: string | null = "OK", rpcError: unknown = null) {
  const users = usersWithDelete(deleteError)
  const push = createChainMock(null, null)
  const web = createChainMock(null, null)
  const audit = createChainMock(null, null)
  mockSupabaseFrom({ users, push_tokens: push, web_push_subscriptions: web, audit_logs: audit })
  vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: rpcData, error: rpcError } as never)
  return { users, push, web, audit }
}

const args = { id: "v1", organizationId: "o1", rol: "VENDEDOR" as const, actorId: "admin1" }

describe("eliminarPersonal", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  it("hard deletes when nothing references the user", async () => {
    const { users } = setup(null)
    const r = await eliminarPersonal(args)
    expect(r).toEqual({ ok: true, baja: false })
    expect(users.delete).toHaveBeenCalled()
    expect(users.eq).toHaveBeenCalledWith("organization_id", "o1")
    expect(users.eq).toHaveBeenCalledWith("rol", "VENDEDOR")
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
        changes: { by_admin: true, soft: true },
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
