// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, parseResponse } from "./helpers"

import { DELETE as deleteVendedor } from "@/app/api/vendedores/[id]/route"
import { DELETE as deleteTecnico } from "@/app/api/tecnicos/[id]/route"

const ctx = { params: Promise.resolve({ id: "p1" }) }
const req = new Request("http://localhost:3000/api/x/p1", { method: "DELETE" })

// users chain: .single() answers the existence lookup, awaiting the chain
// directly answers the DELETE.
function setup(opts: {
  lookup: unknown
  deleteError?: unknown
  rpc?: string | null
}) {
  const users = createChainMock(opts.lookup, opts.lookup ? null : { message: "not found" })
  ;(users as any).then = (resolve: any, reject?: any) =>
    Promise.resolve({ data: null, error: opts.deleteError ?? null }).then(resolve, reject)
  const push = createChainMock(null, null)
  const web = createChainMock(null, null)
  const audit = createChainMock(null, null)
  mockSupabaseFrom({ users, push_tokens: push, web_push_subscriptions: web, audit_logs: audit })
  vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: opts.rpc ?? "OK", error: null } as never)
  return { users, audit }
}

describe("DELETE /api/vendedores/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "error").mockImplementation(() => {})
    mockAuthSuccess({ userId: "admin1", organizationId: "o1", role: "ADMIN" })
  })

  it("hard deletes a seller with no history", async () => {
    const { users } = setup({ lookup: { id: "p1" } })
    const { status, body } = await parseResponse(await deleteVendedor(req, ctx))
    expect(status).toBe(200)
    expect(body.message).toBe("Vendedor eliminado correctamente")
    expect(body.baja).toBeUndefined()
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).not.toHaveBeenCalledWith("ventas")
    expect(users.is).toHaveBeenCalledWith("deleted_at", null)
  })

  it("gives the seller de baja when the delete hits a foreign key", async () => {
    setup({ lookup: { id: "p1" }, deleteError: { code: "23503" } })
    const { status, body } = await parseResponse(await deleteVendedor(req, ctx))
    expect(status).toBe(200)
    expect(body.baja).toBe(true)
    expect(body.message).toContain("dado de baja")
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("solicitar_baja_usuario", { p_user_id: "p1" })
  })

  it("returns 500 on a non-FK delete error", async () => {
    setup({ lookup: { id: "p1" }, deleteError: { code: "XX000" } })
    const { status, body } = await parseResponse(await deleteVendedor(req, ctx))
    expect(status).toBe(500)
    expect(body.error).toBe("Error al eliminar vendedor")
  })

  it("returns 404 when the seller does not exist or is already de baja", async () => {
    const { users } = setup({ lookup: null })
    const { status } = await parseResponse(await deleteVendedor(req, ctx))
    expect(status).toBe(404)
    expect(users.is).toHaveBeenCalledWith("deleted_at", null)
    expect(users.delete).not.toHaveBeenCalled()
  })
})

describe("DELETE /api/tecnicos/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "error").mockImplementation(() => {})
    mockAuthSuccess({ userId: "admin1", organizationId: "o1", role: "ADMIN" })
  })

  it("hard deletes a technician with no history", async () => {
    setup({ lookup: { id: "p1", ordenes_servicio: [] } })
    const { status, body } = await parseResponse(await deleteTecnico(req, ctx))
    expect(status).toBe(200)
    expect(body.message).toBe("Técnico eliminado correctamente")
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("still refuses a technician with active orders", async () => {
    setup({ lookup: { id: "p1", ordenes_servicio: [{ id: "x", estado: "EN_REPARACION" }] } })
    const { status } = await parseResponse(await deleteTecnico(req, ctx))
    expect(status).toBe(400)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("gives the technician de baja when completed orders reference them", async () => {
    setup({
      lookup: { id: "p1", ordenes_servicio: [{ id: "x", estado: "ENTREGADO" }] },
      deleteError: { code: "23503" },
    })
    const { status, body } = await parseResponse(await deleteTecnico(req, ctx))
    expect(status).toBe(200)
    expect(body.baja).toBe(true)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("solicitar_baja_usuario", { p_user_id: "p1" })
  })

  it("returns 500 on a non-FK delete error", async () => {
    setup({ lookup: { id: "p1", ordenes_servicio: [] }, deleteError: { code: "XX000" } })
    expect((await deleteTecnico(req, ctx)).status).toBe(500)
  })

  it("returns 404 when the technician does not exist or is already de baja", async () => {
    const { users } = setup({ lookup: null })
    expect((await deleteTecnico(req, ctx)).status).toBe(404)
    expect(users.is).toHaveBeenCalledWith("deleted_at", null)
  })
})
