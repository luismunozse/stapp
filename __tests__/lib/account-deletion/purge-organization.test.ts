// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { createChainMock, mockSupabaseFrom } from "../../api/helpers"

vi.mock("@/lib/account-deletion/cancel-subscriptions", () => ({ cancelOrganizationSubscriptions: vi.fn() }))
vi.mock("@/lib/account-deletion/storage", () => ({ storageTargets: vi.fn(), removePrefix: vi.fn() }))

import { cancelOrganizationSubscriptions } from "@/lib/account-deletion/cancel-subscriptions"
import { storageTargets, removePrefix } from "@/lib/account-deletion/storage"
import { purgeOrganization } from "@/lib/account-deletion/purge-organization"

const orden: string[] = []

function setup(opts: { cancel?: unknown; org?: unknown; deleteError?: unknown } = {}) {
  orden.length = 0
  vi.mocked(cancelOrganizationSubscriptions).mockImplementation(async () => {
    orden.push("cancel")
    return (opts.cancel ?? { ok: true, canceled: [], skipped: true }) as never
  })
  vi.mocked(storageTargets).mockResolvedValue([
    { bucket: "fotos-ordenes", prefix: "o1" },
    { bucket: "logos", prefix: "proveedores/o1" },
  ])
  vi.mocked(removePrefix).mockImplementation(async (bucket) => {
    orden.push(`storage:${bucket}`)
    return 2
  })
  const orgChain = createChainMock(opts.org === undefined ? { id: "o1", deleted_at: "2026-09-01", deletion_requested_at: "2026-09-01" } : opts.org, null)
  orgChain.delete = vi.fn(() => {
    orden.push("db")
    return createChainMock(null, opts.deleteError ?? null)
  }) as never
  mockSupabaseFrom({ organizations: orgChain })
  return orgChain
}

describe("purgeOrganization", () => {
  beforeEach(() => vi.clearAllMocks())

  it("ejecuta suscripciones, storage y fila de la org, en ese orden", async () => {
    setup()
    const r = await purgeOrganization("o1")
    expect(r).toEqual({ ok: true, removedFiles: 4 })
    expect(orden).toEqual(["cancel", "storage:fotos-ordenes", "storage:logos", "db"])
  })

  it("si falla la cancelación corta: no toca storage ni la fila", async () => {
    setup({ cancel: { ok: false, failed: ["REBILL"], canceled: [] } })
    const r = await purgeOrganization("o1")
    expect(r).toMatchObject({ ok: false, step: "subscriptions" })
    expect(removePrefix).not.toHaveBeenCalled()
    expect(orden).not.toContain("db")
  })

  it("si falla storage corta: la fila de la org sigue ahí para reintentar mañana", async () => {
    setup()
    vi.mocked(removePrefix).mockRejectedValueOnce(new Error("denied"))
    const r = await purgeOrganization("o1")
    expect(r).toMatchObject({ ok: false, step: "storage", error: expect.stringContaining("denied") })
    expect(orden).not.toContain("db")
  })

  it("si falla el delete de la fila lo informa como paso database", async () => {
    setup({ deleteError: { message: "fk" } })
    expect(await purgeOrganization("o1")).toMatchObject({ ok: false, step: "database" })
  })

  it("pasa el deadline a removePrefix", async () => {
    setup()
    await purgeOrganization("o1", { deadline: 123 })
    expect(vi.mocked(removePrefix).mock.calls[0][2]).toBe(123)
  })

  it("si un target de storage falla intenta los demas y NO borra la fila", async () => {
    setup()
    vi.mocked(removePrefix).mockRejectedValueOnce(new Error("denied"))
    const r = await purgeOrganization("o1")
    expect(r).toMatchObject({ ok: false, step: "storage", error: expect.stringContaining("fotos-ordenes") })
    expect(removePrefix).toHaveBeenCalledTimes(2)
    expect(orden).toEqual(["cancel", "storage:logos"])
  })

  it("si storageTargets tira lo informa como paso storage", async () => {
    setup()
    vi.mocked(storageTargets).mockRejectedValueOnce(new Error("support_tickets: boom"))
    expect(await purgeOrganization("o1")).toMatchObject({ ok: false, step: "storage" })
    expect(orden).not.toContain("db")
  })

  it.each(["", "   "])("orgId invalido %j falla sin tocar nada", async (id) => {
    setup()
    const r = await purgeOrganization(id)
    expect(r).toMatchObject({ ok: false, step: "precheck" })
    expect(cancelOrganizationSubscriptions).not.toHaveBeenCalled()
    expect(storageTargets).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  describe("expectArchived (lo usa el cron)", () => {
    it("no purga un taller que el superadmin restauró entre la selección y la purga", async () => {
      setup({ org: { id: "o1", deleted_at: null, deletion_requested_at: null } })
      const r = await purgeOrganization("o1", { expectArchived: true })
      expect(r).toEqual({ ok: true, removedFiles: 0, skipped: "not-archived" })
      expect(cancelOrganizationSubscriptions).not.toHaveBeenCalled()
      expect(removePrefix).not.toHaveBeenCalled()
    })

    it("un taller archivado por inactividad (sin deletion_requested_at) tampoco se purga", async () => {
      setup({ org: { id: "o1", deleted_at: "2026-01-01", deletion_requested_at: null } })
      expect(await purgeOrganization("o1", { expectArchived: true })).toMatchObject({ skipped: "not-archived" })
    })

    it("archivado por pedido: purga y el delete exige deleted_at no nulo", async () => {
      const chain = setup()
      const r = await purgeOrganization("o1", { expectArchived: true })
      expect(r).toEqual({ ok: true, removedFiles: 4 })
      expect(orden).toEqual(["cancel", "storage:fotos-ordenes", "storage:logos", "db"])
      expect(chain.delete).toHaveBeenCalledTimes(1)
      const delChain = vi.mocked(chain.delete).mock.results[0].value
      expect(delChain.eq).toHaveBeenCalledWith("id", "o1")
      expect(delChain.not).toHaveBeenCalledWith("deleted_at", "is", null)
    })

    it("si el precheck falla lo informa como paso precheck", async () => {
      const chain = setup()
      chain.maybeSingle = vi.fn().mockReturnValue(createChainMock(null, { message: "db down" })) as never
      expect(await purgeOrganization("o1", { expectArchived: true })).toMatchObject({ ok: false, step: "precheck" })
      expect(cancelOrganizationSubscriptions).not.toHaveBeenCalled()
    })

    it("un taller que ya no existe es éxito (idempotencia)", async () => {
      setup({ org: null })
      expect(await purgeOrganization("o1", { expectArchived: true })).toEqual({ ok: true, removedFiles: 0, skipped: "not-found" })
    })
  })
})
