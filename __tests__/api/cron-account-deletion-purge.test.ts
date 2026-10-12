// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createChainMock, mockSupabaseFrom, parseResponse } from "./helpers"

vi.mock("@/lib/account-deletion/purge-organization", () => ({ purgeOrganization: vi.fn() }))
vi.mock("@/lib/account-deletion/anonymize-user", () => ({ anonymizeUser: vi.fn() }))

import { purgeOrganization } from "@/lib/account-deletion/purge-organization"
import { anonymizeUser } from "@/lib/account-deletion/anonymize-user"
import { GET } from "@/app/api/cron/account-deletion-purge/route"

const NOW = new Date("2026-11-10T05:30:00.000Z")
const CUTOFF = "2026-10-11T05:30:00.000Z" // NOW - 30 días

const req = (auth = "Bearer s3cret") =>
  new Request("http://localhost/api/cron/account-deletion-purge", { headers: { authorization: auth } })

function setup(orgs: unknown[], users: unknown[]) {
  const organizations = createChainMock(orgs, null)
  const usersChain = createChainMock(users, null)
  const auditLogs = createChainMock(null, null)
  mockSupabaseFrom({ organizations, users: usersChain, audit_logs: auditLogs })
  return { organizations, usersChain, auditLogs }
}

describe("GET /api/cron/account-deletion-purge", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(NOW)
    vi.stubEnv("CRON_SECRET", "s3cret")
    vi.stubEnv("ACCOUNT_DELETION_PURGE_ENABLED", "")
    vi.spyOn(console, "log").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.mocked(purgeOrganization).mockResolvedValue({ ok: true, removedFiles: 3 })
    vi.mocked(anonymizeUser).mockResolvedValue({ ok: true, alreadyAnonymized: false })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it("exige CRON_SECRET", async () => {
    expect((await GET(req("Bearer otro"))).status).toBe(401)
    expect(purgeOrganization).not.toHaveBeenCalled()
  })

  it("por defecto es dry-run: informa candidatos y no borra nada", async () => {
    const { auditLogs } = setup([{ id: "o1", slug: "uno" }], [{ id: "u1" }])
    const { status, body } = await parseResponse(await GET(req()))
    expect(status).toBe(200)
    expect(body.results.dryRun).toBe(true)
    expect(body.results.orgs.candidates).toBe(1)
    expect(body.results.users.candidates).toBe(1)
    expect(purgeOrganization).not.toHaveBeenCalled()
    expect(anonymizeUser).not.toHaveBeenCalled()
    expect(auditLogs.insert).not.toHaveBeenCalled()
  })

  it("solo toma pedidos de eliminación vencidos y nunca los archivados por inactividad", async () => {
    const { organizations, usersChain } = setup([], [])
    await GET(req())
    expect(organizations.not).toHaveBeenCalledWith("deletion_requested_at", "is", null)
    expect(organizations.lt).toHaveBeenCalledWith("deletion_requested_at", CUTOFF)
    expect(organizations.not).toHaveBeenCalledWith("deleted_at", "is", null)
    expect(usersChain.lt).toHaveBeenCalledWith("deleted_at", CUTOFF)
    expect(usersChain.not).toHaveBeenCalledWith("email", "like", "%@deleted.stapp.invalid")
  })

  it("con ACCOUNT_DELETION_PURGE_ENABLED=true purga con expectArchived y anonimiza", async () => {
    vi.stubEnv("ACCOUNT_DELETION_PURGE_ENABLED", "true")
    setup([{ id: "o1", slug: "uno" }], [{ id: "u1" }])
    const { body } = await parseResponse(await GET(req()))
    expect(body.results.dryRun).toBe(false)
    expect(body.results.orgs.purged).toBe(1)
    expect(body.results.users.anonymized).toBe(1)
    expect(purgeOrganization).toHaveBeenCalledWith("o1", expect.objectContaining({ expectArchived: true, deadline: expect.any(Number) }))
    expect(anonymizeUser).toHaveBeenCalledWith("u1")
  })

  it("un taller restaurado en el medio se cuenta como saltado, no como purgado", async () => {
    vi.stubEnv("ACCOUNT_DELETION_PURGE_ENABLED", "true")
    const { auditLogs } = setup([{ id: "o1", slug: "uno" }], [])
    vi.mocked(purgeOrganization).mockResolvedValueOnce({ ok: true, removedFiles: 0, skipped: "not-archived" })
    const { body } = await parseResponse(await GET(req()))
    expect(body.results.orgs).toMatchObject({ purged: 0, skipped: 1 })
    expect(auditLogs.insert).not.toHaveBeenCalled()
  })

  it("un taller que falla no frena a los demás y queda registrado con su paso", async () => {
    vi.stubEnv("ACCOUNT_DELETION_PURGE_ENABLED", "true")
    setup([{ id: "o1", slug: "uno" }, { id: "o2", slug: "dos" }], [])
    vi.mocked(purgeOrganization)
      .mockResolvedValueOnce({ ok: false, step: "storage", error: "denied" })
      .mockResolvedValueOnce({ ok: true, removedFiles: 1 })
    const { body } = await parseResponse(await GET(req()))
    expect(body.results.orgs.purged).toBe(1)
    expect(body.results.orgs.failed).toEqual([{ id: "o1", step: "storage", error: "denied" }])
  })

  it("un taller restaurado a mitad de la purga (not-archived-anymore) se loguea como error para atención manual", async () => {
    vi.stubEnv("ACCOUNT_DELETION_PURGE_ENABLED", "true")
    setup([{ id: "o1", slug: "uno" }], [])
    vi.mocked(purgeOrganization).mockResolvedValueOnce({ ok: false, step: "delete", error: "not-archived-anymore: x" })
    const { body } = await parseResponse(await GET(req()))
    expect(body.results.orgs.failed).toEqual([{ id: "o1", step: "delete", error: "not-archived-anymore: x" }])
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("MANUAL ATTENTION"))
  })

  it("un usuario que falla no frena a los demás", async () => {
    vi.stubEnv("ACCOUNT_DELETION_PURGE_ENABLED", "true")
    setup([], [{ id: "u1" }, { id: "u2" }])
    vi.mocked(anonymizeUser)
      .mockResolvedValueOnce({ ok: false, error: "boom" })
      .mockResolvedValueOnce({ ok: true, alreadyAnonymized: false })
    const { body } = await parseResponse(await GET(req()))
    expect(body.results.users.anonymized).toBe(1)
    expect(body.results.users.failed).toEqual([{ id: "u1", error: "boom" }])
  })

  it("un error en la consulta de selección devuelve 500 y no purga nada", async () => {
    vi.stubEnv("ACCOUNT_DELETION_PURGE_ENABLED", "true")
    mockSupabaseFrom({
      organizations: createChainMock(null, { message: "db down" }),
      users: createChainMock([], null),
    })
    const res = await GET(req())
    expect(res.status).toBe(500)
    expect(purgeOrganization).not.toHaveBeenCalled()
    expect(anonymizeUser).not.toHaveBeenCalled()
  })
})
