import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { installPostgrestFake } from "./postgrest-fake"

vi.mock("@/lib/cron-auth", () => ({
  requireCronAuth: vi.fn(() => null),
}))

vi.mock("@/lib/emails/template-resolver", () => ({
  resolveTemplate: vi.fn(async () => null), // DRAFT: bloquea el envio, como en prod
}))

import { GET } from "@/app/api/cron/re-engagement/route"
import { resolveTemplate } from "@/lib/emails/template-resolver"

const NOW = "2026-10-09T12:00:00.000Z"
const daysAgo = (n: number) => new Date(new Date(NOW).getTime() - n * 86_400_000).toISOString()

const org = (id: string) => ({ id, nombre: `Taller ${id}`, slug: id, email: `${id}@test.local`, activo: true })
const admin = (orgId: string) => ({
  id: `admin-${orgId}`,
  nombre: "Ana",
  email: `ana@${orgId}.test`,
  organization_id: orgId,
  rol: "ADMIN",
  created_at: daysAgo(300),
})

const request = () => new Request("http://localhost/api/cron/re-engagement")

describe("GET /api/cron/re-engagement: actividad de ordenes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW))
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("una org con una orden de hace 3 dias (fecha_ingreso) cuenta como activa", async () => {
    installPostgrestFake({
      organizations: [org("o1")],
      users: [admin("o1")],
      ordenes_servicio: [{ organization_id: "o1", fecha_ingreso: daysAgo(3) }],
    })

    const body = await (await GET(request())).json()

    expect(body.results.skippedActive).toBe(1)
    expect(body.results.skippedDraft).toBe(0)
    expect(resolveTemplate).not.toHaveBeenCalled()
  })

  it("una org sin ninguna actividad reciente sigue siendo candidata", async () => {
    installPostgrestFake({
      organizations: [org("o1")],
      users: [admin("o1")],
      ordenes_servicio: [{ organization_id: "o1", fecha_ingreso: daysAgo(60) }],
    })

    const body = await (await GET(request())).json()

    expect(body.results.skippedActive).toBe(0)
    expect(body.results.skippedDraft).toBe(1)
  })

  it("no consulta columnas inexistentes de ordenes_servicio", async () => {
    const fake = installPostgrestFake({ organizations: [org("o1")], users: [admin("o1")] })

    await GET(request())

    const args = fake.queries
      .filter((q) => q.table === "ordenes_servicio")
      .flatMap((q) => q.ops)
      .flatMap((o) => o.args.filter((a): a is string => typeof a === "string"))
    expect(args.join(",")).not.toMatch(/created_at|updated_at/)
    expect(args.join(",")).toContain("fecha_ingreso")
  })

  it.each(["ordenes_servicio", "ventas", "clientes"])(
    "aborta con 500 y no registra nada si falla la consulta de %s",
    async (tabla) => {
      const fake = installPostgrestFake(
        { organizations: [org("o1")], users: [admin("o1")] },
        { failTables: { [tabla]: { code: "42703", message: "column does not exist" } } }
      )

      const res = await GET(request())

      expect(res.status).toBe(500)
      expect(resolveTemplate).not.toHaveBeenCalled()
      expect(fake.writes).toHaveLength(0)
    }
  )
})
