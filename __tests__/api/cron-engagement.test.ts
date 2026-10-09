import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { installPostgrestFake } from "./postgrest-fake"

vi.mock("@/lib/cron-auth", () => ({
  requireCronAuth: vi.fn(() => null),
}))

import { GET } from "@/app/api/cron/engagement/route"

// El cron mide "ayer" (UTC). Hoy = 2026-10-09 -> ayer = 2026-10-08.
const NOW = "2026-10-09T12:00:00.000Z"
const AYER = "2026-10-08T15:00:00.000Z"
const ANTEAYER = "2026-10-07T15:00:00.000Z"

const org = (id: string) => ({ id, activo: true, slug: id })
const request = () => new Request("http://localhost/api/cron/engagement")

const upserts = (fake: ReturnType<typeof installPostgrestFake>) =>
  fake.writes.filter((w) => w.table === "organization_engagement" && w.op === "upsert")

describe("GET /api/cron/engagement: ordenes de ayer", () => {
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

  it("cuenta las ordenes creadas ayer por fecha_ingreso", async () => {
    const fake = installPostgrestFake({
      organizations: [org("o1")],
      ordenes_servicio: [
        { organization_id: "o1", estado: "PENDIENTE", fecha_ingreso: AYER },
        { organization_id: "o1", estado: "PENDIENTE", fecha_ingreso: AYER },
        { organization_id: "o1", estado: "PENDIENTE", fecha_ingreso: ANTEAYER },
      ],
    })

    const res = await GET(request())

    expect(res.status).toBe(200)
    expect(upserts(fake)).toHaveLength(1)
    expect(upserts(fake)[0].payload).toMatchObject({ organization_id: "o1", ordenes_creadas: 2 })
  })

  it("cuenta como completadas las ENTREGADO con fecha_entrega de ayer", async () => {
    const fake = installPostgrestFake({
      organizations: [org("o1")],
      ordenes_servicio: [
        { organization_id: "o1", estado: "ENTREGADO", fecha_ingreso: ANTEAYER, fecha_entrega: AYER },
        { organization_id: "o1", estado: "ENTREGADO", fecha_ingreso: ANTEAYER, fecha_entrega: ANTEAYER },
        { organization_id: "o1", estado: "PENDIENTE", fecha_ingreso: ANTEAYER, fecha_entrega: null },
      ],
    })

    await GET(request())

    expect(upserts(fake)[0].payload).toMatchObject({ ordenes_creadas: 0, ordenes_completadas: 1 })
  })

  it("no consulta columnas inexistentes de ordenes_servicio", async () => {
    const fake = installPostgrestFake({ organizations: [org("o1")] })

    await GET(request())

    const args = fake.queries
      .filter((q) => q.table === "ordenes_servicio")
      .flatMap((q) => q.ops)
      .flatMap((o) => o.args.filter((a): a is string => typeof a === "string"))
    expect(args.join(",")).not.toMatch(/created_at|updated_at/)
  })

  it.each(["ordenes_servicio", "ventas", "clientes"])(
    "aborta con 500 y no guarda un score en cero si falla la consulta de %s",
    async (tabla) => {
      const fake = installPostgrestFake(
        { organizations: [org("o1")] },
        { failTables: { [tabla]: { code: "42703", message: "column does not exist" } } }
      )

      const res = await GET(request())

      expect(res.status).toBe(500)
      expect(upserts(fake)).toHaveLength(0)
    }
  )
})
