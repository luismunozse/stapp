import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { installPostgrestFake } from "./postgrest-fake"

vi.mock("@/lib/cron-auth", () => ({
  requireCronAuth: vi.fn(() => null),
}))

vi.mock("@/lib/emails/template-resolver", () => ({
  resolveTemplate: vi.fn(async () => ({ subject: "s", html: "<p>h</p>", source: "hardcoded" })),
}))

import { GET } from "@/app/api/cron/trial-management/route"

const NOW = "2026-10-09T12:00:00.000Z"
const daysAgo = (n: number) => new Date(new Date(NOW).getTime() - n * 86_400_000).toISOString()

const sub = (orgId: string) => ({
  id: `sub-${orgId}`,
  organization_id: orgId,
  status: "TRIALING",
  trial_end: daysAgo(1), // vencido ayer
  organizations: { id: orgId, nombre: `Taller ${orgId}`, slug: orgId, activo: true },
})

const admin = (orgId: string) => ({
  id: `admin-${orgId}`,
  nombre: "Ana",
  email: `ana@${orgId}.test`,
  organization_id: orgId,
  rol: "ADMIN",
})

const request = () => new Request("http://localhost/api/cron/trial-management")

describe("GET /api/cron/trial-management: actividad reciente", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW))
    process.env.ENVIALOSIMPLE_API_KEY = "test-key"
    fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal("fetch", fetchMock)
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("no consulta columnas inexistentes de ordenes_servicio y manda la invitacion", async () => {
    const fake = installPostgrestFake({
      subscriptions: [sub("o1")],
      users: [admin("o1")],
      ordenes_servicio: [{ organization_id: "o1", fecha_ingreso: daysAgo(2) }],
    })

    const res = await GET(request())
    const body = await res.json()

    const args = fake.queries
      .filter((q) => q.table === "ordenes_servicio")
      .flatMap((q) => q.ops)
      .flatMap((o) => o.args.filter((a): a is string => typeof a === "string"))
    expect(res.status).toBe(200)
    expect(args.join(",")).not.toMatch(/created_at|updated_at/)
    expect(args.join(",")).toContain("fecha_ingreso")
    expect(body.results.lastChanceEmails).toBe(1)
  })

  it.each(["ordenes_servicio", "ventas", "clientes"])(
    "aborta con 500 y no manda mails si falla la consulta de %s",
    async (tabla) => {
      const fake = installPostgrestFake(
        { subscriptions: [sub("o1")], users: [admin("o1")] },
        { failTables: { [tabla]: { code: "42703", message: "column does not exist" } } }
      )

      const res = await GET(request())

      expect(res.status).toBe(500)
      expect(fetchMock).not.toHaveBeenCalled()
      expect(fake.writes).toHaveLength(0)
    }
  )
})
